import { Request, Response } from 'express';
import { z, ZodError } from 'zod';
import { safePrisma } from '../config/database.js';
import { prisma } from '../config/prisma.js';
import { Prisma } from '../generated/prisma/client.js';
import { CreateSessionSchema, FinalizeSessionSchema } from '../schemas/checkout.schema.js';
import { MerchantService } from '../services/merchant.service.js';
import { PaymentService, PayUGateway } from '../services/payment.service.js';

/**
 * Initializes the checkout session.
 * Focus: Setting up the initial state and verifying store availability.
 */
export const initSession = async (req: Request, res: Response): Promise<void> => {
  try {
    // 1. Identify the Tenant (Strictly via Header)
    const storeId = req.headers['x-store-id'] as string;

    if (!storeId) {
      res.status(400).json({
        success: false,
        message: 'Store Identity Required: Please provide x-store-id in headers',
      });
      return;
    }

    // 2. Fetch Merchant Config from External Specific Backend
    const storeConfig = await MerchantService.getStoreConfig(storeId);

    if (!storeConfig || !storeConfig.isActive) {
      res.status(403).json({ success: false, message: 'Store is not active' });
      return;
    }

    const validatedData = CreateSessionSchema.parse(req.body);
    const { items } = validatedData;

    // 3. Server-side Price Recalculation
    const totalAmount = items.reduce((acc, item) => {
      return acc + item.price * item.quantity;
    }, 0);

    // 4. Create the Session Linked to Store ID
    const session = await safePrisma(() =>
      prisma.checkoutSession.create({
        data: {
          storeId: storeConfig.id,
          items: items as Prisma.InputJsonValue,
          totalAmount,
          currency: storeConfig.currency || 'INR',
          status: 'PENDING_AUTH',
          expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes expiry
        },
      })
    );

    res.status(201).json({
      success: true,
      message: 'Checkout session initialized',
      data: {
        sessionId: session.id,
        merchantName: storeConfig.name,
        totalAmount: session.totalAmount,
        currency: session.currency,
        status: session.status,
      },
    });
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      res.status(400).json({
        success: false,
        errors: error.issues,
      });
      return;
    }
    console.error('Checkout Init Error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * The "State of the Union" endpoint.
 * Returns everything the frontend needs to render the current step.
 */
export const getSessionSummary = async (req: Request, res: Response): Promise<void> => {
  try {
    const { sessionId } = req.params;
    const storeIdFromHeader = req.headers['x-store-id'] as string;

    if (!storeIdFromHeader) {
      res.status(400).json({ success: false, message: 'x-store-id header is required' });
      return;
    }

    // Strict UUID validation for sessionId
    const sessionIdSchema = z.string().uuid('Invalid session ID format');
    const validationResult = sessionIdSchema.safeParse(sessionId);

    if (!validationResult.success) {
      res.status(400).json({
        success: false,
        message: validationResult.error.issues?.[0]?.message || 'Invalid session ID format',
      });
      return;
    }
    const session = await safePrisma(() =>
      prisma.checkoutSession.findUnique({
        where: { id: validationResult.data },
        include: {
          user: { include: { addresses: true } },
          address: true,
          transaction: true,
        },
      })
    );

    if (!session) {
      res.status(404).json({ success: false, message: 'Session not found' });
      return;
    }

    // Tenant Isolation Check
    if (session.storeId !== storeIdFromHeader) {
      res.status(403).json({ success: false, message: 'Unauthorized' });
      return;
    }

    // Fetch full config for providers and brand name
    const storeConfig = await MerchantService.getStoreConfig(session.storeId);

    res.status(200).json({
      success: true,
      data: {
        id: session.id,
        merchantName: storeConfig.name,
        items: session.items,
        totalAmount: session.totalAmount,
        currency: session.currency,
        status: session.status,
        paymentProviders: storeConfig.enabledGateways, // Providing the full list for user choice
        user: session.user
          ? {
              id: session.user.id,
              phone: session.user.phone,
              firstName: session.user.firstName,
              lastName: session.user.lastName,
              addresses: session.user.addresses,
            }
          : null,
        selectedAddress: session.address,
        transaction: session.transaction,
      },
    });
  } catch (error: unknown) {
    console.error('Error fetching Session Summary Error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const finalizeSession = async (req: Request, res: Response): Promise<void> => {
  try {
    const validatedData = FinalizeSessionSchema.parse(req.body);
    const { sessionId, paymentMethod } = validatedData;
    const storeIdFromHeader = req.headers['x-store-id'] as string;

    if (!storeIdFromHeader) {
      res.status(400).json({ success: false, message: 'x-store-id header is required' });
      return;
    }

    // 1. Fetch session with user and address
    const session = await safePrisma(() =>
      prisma.checkoutSession.findUnique({
        where: { id: sessionId as string },
        include: {
          user: true,
          address: true,
        },
      })
    );

    if (!session) {
      res.status(404).json({ success: false, message: 'Session not found' });
      return;
    }

    // 2. Tenant Isolation Check
    if (session.storeId !== storeIdFromHeader) {
      res.status(403).json({ success: false, message: 'Unauthorized access to session' });
      return;
    }

    // 3. Session Expiry Check (Fix D)
    // Only block if the session is not already finalized
    const isFinalized = session.status === 'COMPLETED' || session.status === 'PLACED';
    if (!isFinalized && session.expiresAt < new Date()) {
      res.status(410).json({
        success: false,
        message: 'Checkout session has expired. Please start over.',
      });
      return;
    }

    if (session.status !== 'ADDRESS_CONFIRMED') {
      res.status(400).json({
        success: false,
        message: 'Shipping address must be confirmed before proceeding to payment',
      });
      return;
    }

    if (!session.addressId || !session.address || !session.user) {
      res.status(400).json({
        success: false,
        message: 'Customer information or address is incomplete',
      });
      return;
    }

    // 4. Fetch latest Merchant Config to get Gateway Strategy
    const storeConfig = await MerchantService.getStoreConfig(session.storeId);

    // Find the specific gateway config or fallback
    const gatewayConfig =
      storeConfig.enabledGateways.find(
        (g) => g.name.toUpperCase() === paymentMethod.toUpperCase()
      ) || storeConfig.enabledGateways[0];

    if (!gatewayConfig) {
      res.status(400).json({
        success: false,
        message: 'No payment gateways are currently enabled for this store',
      });
      return;
    }

    // 5. Prepare metadata for Gateway
    const customer = {
      firstName: session.address.firstName,
      lastName: session.address.lastName,
      email: session.user.email as string, // Validated non-null below
      phone: session.user.phone || session.address.receiversPhone,
    };

    if (!customer.email || !customer.phone) {
      res.status(400).json({
        success: false,
        message: 'Customer email and phone are required for payment processing',
      });
      return;
    }

    // --- COD GUARDRAILS START ---
    if (paymentMethod.toUpperCase() === 'COD') {
      // 1. Address Sanity Check (Pincode & Phone)
      const indianPincodeRegex = /^[1-9][0-9]{5}$/;
      if (!indianPincodeRegex.test(session.address.pincode)) {
        res.status(400).json({
          success: false,
          message: 'Invalid Pincode: COD requires a valid 6-digit Indian pincode for logistics.',
        });
        return;
      }

      const receiverPhoneDigits = session.address.receiversPhone.replace(/\D/g, '');
      if (receiverPhoneDigits.length < 10) {
        res.status(400).json({
          success: false,
          message:
            'Invalid Receiver Phone: A valid 10-digit phone number is required for COD delivery.',
        });
        return;
      }

      // 2. Max COD Amount Cap
      // Rationale: High-value orders have higher RTO (Return to Origin) costs.
      const MAX_COD_AMOUNT = Number(process.env.MAX_COD_AMOUNT) || 5000;
      if (session.totalAmount > MAX_COD_AMOUNT) {
        res.status(400).json({
          success: false,
          message: `COD is not available for orders above ₹${MAX_COD_AMOUNT}. Please use an online payment method.`,
        });
        return;
      }

      // 3. RTO Risk Filter (Placeholder for Future Use)
      /* 
      // This block requires historical transaction data to be effective.
      // Logic: If a user has more than 2 'FAILED' COD transactions in the last 30 days, block COD.
      const failedCodCount = await prisma.transaction.count({
        where: {
          userId: session.userId,
          paymentMethod: 'COD',
          status: 'FAILED',
          createdAt: { gt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
        }
      });
      if (failedCodCount >= 2) {
        res.status(403).json({
          success: false,
          message: 'COD is currently disabled for your account due to previous delivery failures.'
        });
        return;
      }
      */
    }
    // --- COD GUARDRAILS END ---

    interface CartItem {
      name: string;
      price: number;
      quantity: number;
      sku?: string;
    }

    // Create a simple product description from items
    const items = session.items as unknown as CartItem[];
    const productInfo = items
      .map((i) => i.name)
      .join(', ')
      .substring(0, 100);

    // 6. Atomically claim the session for finalization (race-condition guard).
    // Two parallel finalize calls would otherwise both call the gateway and
    // create duplicate transactions. updateMany returns count=1 only for the
    // winner; the loser sees count=0 and aborts before any gateway side-effects.
    const claim = await safePrisma(() =>
      prisma.checkoutSession.updateMany({
        where: { id: sessionId as string, status: 'ADDRESS_CONFIRMED' },
        data: { status: 'PAYMENT_PENDING', paymentGateway: gatewayConfig.name },
      })
    );

    if (claim.count === 0) {
      res.status(409).json({
        success: false,
        message: 'Session is already being finalized or is no longer in a finalizable state',
      });
      return;
    }

    // 7. Create the Payment Intent. If this throws, roll the session back so
    // the user can retry without being stuck in PAYMENT_PENDING.
    const gateway = PaymentService.getGateway(gatewayConfig.name);
    let intent;
    try {
      intent = await gateway.createIntent(
        session.totalAmount,
        session.currency,
        customer,
        productInfo,
        paymentMethod
      );
    } catch (gatewayError) {
      await safePrisma(() =>
        prisma.checkoutSession.update({
          where: { id: sessionId as string },
          data: { status: 'ADDRESS_CONFIRMED', paymentGateway: null },
        })
      );
      throw gatewayError;
    }

    // 8. Branch: COD (immediate completion) vs Online Gateways (pending payment)
    if (intent.status === 'succeeded') {
      // COD path — no external payment page, no callback. Order is confirmed immediately.
      const updatedSession = await safePrisma(() =>
        prisma.$transaction(async (tx) => {
          const sessionUpdate = await tx.checkoutSession.update({
            where: { id: sessionId as string },
            data: {
              status: 'PLACED', // COD orders are "PLACED", not immediately "COMPLETED" (paid)
              gatewayTransactionId: intent.id,
            },
          });

          // Record the transaction in the permanent log
          await tx.transaction.create({
            data: {
              sessionId: sessionUpdate.id,
              storeId: sessionUpdate.storeId,
              userId: sessionUpdate.userId,
              amount: sessionUpdate.totalAmount,
              currency: sessionUpdate.currency,
              status: 'PENDING', // COD payment is pending until delivery
              paymentMethod: 'COD',
              paymentGateway: gatewayConfig.name,
              gatewayTransactionId: intent.id,
            },
          });

          return sessionUpdate;
        })
      );

      res.status(200).json({
        success: true,
        message: 'Order placed successfully — Cash on Delivery',
        data: {
          sessionId: updatedSession.id,
          status: updatedSession.status,
          paymentGateway: gatewayConfig.name,
          gatewayTransactionId: intent.id,
          paymentMethod: 'COD',
        },
      });
      return;
    }

    // Online gateway path — record gateway IDs and create a PENDING transaction record
    const updatedSession = await safePrisma(() =>
      prisma.$transaction(async (tx) => {
        const sessionUpdate = await tx.checkoutSession.update({
          where: { id: sessionId as string },
          data: {
            gatewayTransactionId: intent.id,
            gatewayClientSecret: intent.clientSecret ?? null,
          },
        });

        await tx.transaction.upsert({
          where: { sessionId: sessionUpdate.id },
          update: {
            status: 'PENDING',
            gatewayTransactionId: intent.id,
          },
          create: {
            sessionId: sessionUpdate.id,
            storeId: sessionUpdate.storeId,
            userId: sessionUpdate.userId,
            amount: sessionUpdate.totalAmount,
            currency: sessionUpdate.currency,
            status: 'PENDING',
            paymentMethod: 'ONLINE',
            paymentGateway: gatewayConfig.name,
            gatewayTransactionId: intent.id,
          },
        });

        return sessionUpdate;
      })
    );

    let debugCallbackPayload;
    if (process.env.NODE_ENV !== 'production' && gateway instanceof PayUGateway) {
      debugCallbackPayload = gateway.getDebugCallbackPayload({
        txnid: intent.id,
        amount: session.totalAmount.toFixed(2),
        productinfo: productInfo,
        firstname: session.address.firstName,
        email: session.user.email as string,
        status: 'success',
      });
    }

    res.status(200).json({
      success: true,
      message: `Checkout finalized and ${gatewayConfig.name} intent created`,
      data: {
        sessionId: updatedSession.id,
        status: updatedSession.status,
        paymentGateway: gatewayConfig.name,
        gatewayTransactionId: intent.id,
        gatewayClientSecret: intent.clientSecret,
        paymentUrl: intent.paymentUrl,
        additionalParams: intent.additionalParams,
        debugCallbackPayload, // Exposed for manual testing
      },
    });
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      res.status(400).json({ success: false, errors: error.issues });
      return;
    }
    console.error('Error finalizing session:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * Handler for PayU Success/Failure callbacks (surl/furl)
 * Supports both POST (standard) and GET (mobile/3DS fallback) methods.
 */
export const handlePayUCallback = async (req: Request, res: Response): Promise<void> => {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  let gateway: PayUGateway;

  try {
    gateway = new PayUGateway();
  } catch (initError) {
    console.error('[PAYU_CALLBACK] Failed to initialize gateway:', initError);
    res.redirect(`${frontendUrl}/checkout/failure?reason=config_error`);
    return;
  }

  try {
    // Merge query params and body to support both GET and POST callbacks
    const payload = { ...req.query, ...req.body };
    const { txnid, status } = payload;

    console.info(
      `[PAYU_CALLBACK] Received ${req.method} callback for TXN: ${txnid}, Status: ${status}`
    );

    // 1. Verify Reverse Hash
    const isHashValid = gateway.verifyResponseHash(payload);
    if (!isHashValid) {
      console.error(`[PAYU_CALLBACK] Hash mismatch for TXN: ${txnid}`);
      res.redirect(`${frontendUrl}/checkout/failure?reason=hash_mismatch`);
      return;
    }

    // 2. Atomic check-and-update in a transaction (Fix C — race condition)
    const result = await safePrisma(() =>
      prisma.$transaction(async (tx) => {
        const session = await tx.checkoutSession.findFirst({
          where: { gatewayTransactionId: txnid },
        });

        if (!session) {
          return { error: 'session_not_found' as const };
        }

        // Idempotency Check: Don't process if already in a final state
        if (
          session.status === 'COMPLETED' ||
          session.status === 'FAILED' ||
          session.status === 'PLACED'
        ) {
          return { alreadyProcessed: true, session };
        }

        // Amount Tampering Protection
        const receivedAmount = parseFloat(payload.amount);
        const expectedAmount = session.totalAmount;

        if (Math.abs(receivedAmount - expectedAmount) > 0.01) {
          console.error(
            `[PAYU_CALLBACK] Amount mismatch for TXN: ${txnid}. Expected ${expectedAmount}, received ${receivedAmount}`
          );
          const updated = await tx.checkoutSession.update({
            where: { id: session.id },
            data: { status: 'FAILED' },
          });
          return { amountMismatch: true, session: updated };
        }

        // Reconciliation API check
        let reconciliationStatus = status;
        try {
          const reconData = await gateway.verifyPaymentReconciliation(txnid);
          if (reconData.status === 1 && reconData.transaction_details?.[txnid]) {
            const actualStatus = reconData.transaction_details[txnid].status;
            console.info(`[PAYU_CALLBACK] Reconciliation Status: ${actualStatus}`);
            if (actualStatus.toLowerCase() === 'success') {
              reconciliationStatus = 'success';
            } else if (actualStatus.toLowerCase() === 'failure') {
              reconciliationStatus = 'failure';
            }
          }
        } catch (reconError) {
          // Fix J: In production, treat reconciliation failure as non-success
          if (process.env.NODE_ENV === 'production') {
            console.error(
              `[PAYU_CALLBACK] Reconciliation failed in PRODUCTION for TXN ${txnid}. Marking as FAILED for safety.`,
              reconError
            );
            reconciliationStatus = 'failure';
          } else {
            console.warn(
              `[PAYU_CALLBACK] Reconciliation failed (using raw status in non-prod):`,
              reconError
            );
          }
        }

        const finalStatus = reconciliationStatus === 'success' ? 'COMPLETED' : 'FAILED';
        const finalTxnStatus = reconciliationStatus === 'success' ? 'SUCCESS' : 'FAILED';

        // Update session
        const updated = await tx.checkoutSession.update({
          where: { id: session.id },
          data: {
            status: finalStatus as any,
            gatewayPaymentId: (payload.mihpayid as string) || session.gatewayPaymentId,
          },
        });

        // Update permanent transaction log
        await tx.transaction.update({
          where: { sessionId: session.id },
          data: {
            status: finalTxnStatus as any,
            gatewayPaymentId: (payload.mihpayid as string) || session.gatewayPaymentId,
            metadata: payload as Prisma.InputJsonValue,
          },
        });

        return { session: updated, finalStatus, reconciliationStatus };
      })
    );

    // Handle transaction results with redirects
    if ('error' in result && result.error === 'session_not_found') {
      console.error(`[PAYU_CALLBACK] Session not found for TXN: ${txnid}`);
      res.redirect(`${frontendUrl}/checkout/failure?reason=session_not_found`);
      return;
    }

    if ('alreadyProcessed' in result && result.alreadyProcessed) {
      console.warn(
        `[PAYU_CALLBACK] TXN ${txnid} already processed with status ${result.session.status}`
      );
      const url =
        result.session.status === 'COMPLETED'
          ? `${frontendUrl}/checkout/success?sessionId=${result.session.id}`
          : `${frontendUrl}/checkout/failure?sessionId=${result.session.id}`;
      res.redirect(url);
      return;
    }

    if ('amountMismatch' in result && result.amountMismatch) {
      res.redirect(`${frontendUrl}/checkout/failure?reason=amount_mismatch`);
      return;
    }

    // Normal completion
    const {
      session: updatedSession,
      finalStatus,
      reconciliationStatus,
    } = result as {
      session: { id: string };
      finalStatus: string;
      reconciliationStatus: string;
    };

    if (finalStatus === 'COMPLETED') {
      console.info(
        `[PAYU_CALLBACK] ✅ Transaction ${txnid} COMPLETED. Redirecting to success page.`
      );
    } else {
      console.warn(
        `[PAYU_CALLBACK] ❌ Transaction ${txnid} FAILED (${reconciliationStatus || status}). Redirecting to failure page.`
      );
    }

    const redirectUrl =
      finalStatus === 'COMPLETED'
        ? `${frontendUrl}/checkout/success?sessionId=${updatedSession.id}`
        : `${frontendUrl}/checkout/failure?sessionId=${updatedSession.id}&reason=${reconciliationStatus || status}`;

    res.redirect(redirectUrl);
  } catch (error) {
    console.error('[PAYU_CALLBACK] Error processing callback:', error);
    res.redirect(`${frontendUrl}/checkout/failure?reason=internal_error`);
  }
};
