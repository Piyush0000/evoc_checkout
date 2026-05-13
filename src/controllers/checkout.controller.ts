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

    // Allow re-finalizing if already in PAYMENT_PENDING (to support retries)
    if (session.status !== 'ADDRESS_CONFIRMED' && session.status !== 'PAYMENT_PENDING') {
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

    // 3. Fetch latest Merchant Config to get Gateway Strategy
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

    // 4. Prepare metadata for Gateway
    const customerEmail = session.user.email ?? '';
    const customerPhone = session.user.phone || session.address.receiversPhone;
    const customer = {
      firstName: session.address.firstName,
      lastName: session.address.lastName,
      email: customerEmail,
      phone: customerPhone,
    };

    if (!customer.email || !customer.phone) {
      res.status(400).json({
        success: false,
        message: 'Customer email and phone are required for payment processing',
      });
      return;
    }

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

    // 5. Create the Payment Intent
    const gateway = PaymentService.getGateway(gatewayConfig.name);
    
    // Add UPI Intent support if specifically requested
    if (paymentMethod.toUpperCase() === 'PAYU_INTENT') {
      // In PayU, UPI Intent is often triggered by passing specific bankcode/pg
      // For now, we'll just log that it's an intent flow.
      console.info(`[CHECKOUT] Preparing PayU UPI Intent flow for TXN`);
    }

    const intent = await gateway.createIntent(
      session.totalAmount,
      session.currency,
      customer,
      productInfo
    );

    // 5. Update Session and Transition Status
    const updatedSession = await safePrisma(() =>
      prisma.checkoutSession.update({
        where: { id: sessionId as string },
        data: {
          status: 'PAYMENT_PENDING',
          paymentGateway: gatewayConfig.name,
          gatewayTransactionId: intent.id,
          gatewayClientSecret: intent.clientSecret ?? null,
        },
      })
    );

    let debugCallbackPayload;
    if (process.env.NODE_ENV !== 'production' && gateway instanceof PayUGateway) {
      debugCallbackPayload = gateway.getDebugCallbackPayload({
        txnid: intent.id,
        amount: session.totalAmount.toFixed(2),
        productinfo: productInfo,
        firstname: session.address.firstName,
        email: customerEmail, // Using customerEmail directly for safety
        status: 'success',
      });
      console.info(`[CHECKOUT] Created PayU Intent: ${intent.id}. Debug callback payload generated.`);
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
 */
export const handlePayUCallback = async (req: Request, res: Response): Promise<void> => {
  const frontendBaseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  try {
    const getString = (value: unknown): string => {
      if (Array.isArray(value)) return String(value[0] ?? '');
      return value == null ? '' : String(value);
    };
    const payload = {
      ...(req.query as Record<string, unknown>),
      ...(req.body as Record<string, unknown>),
    };
    const txnid = getString(payload.txnid).trim();
    const status = getString(payload.status);
    payload.txnid = txnid;
    payload.status = status;

    console.info(`[PAYU_CALLBACK] Received callback. Status: ${status}, TXN: "${txnid}"`);

    if (!txnid) {
      console.error('[PAYU_CALLBACK] Missing txnid in callback payload');
      res.redirect(`${frontendBaseUrl}/checkout/failure?reason=missing_txnid`);
      return;
    }

    const gateway = new PayUGateway();

    // 1. Verify Reverse Hash
    const isHashValid = gateway.verifyResponseHash(payload);
    if (!isHashValid) {
      console.error(`[PAYU_CALLBACK] Hash mismatch for TXN: ${txnid}`);
      res.redirect(`${frontendBaseUrl}/checkout/failure?reason=hash_mismatch`);
      return;
    }

    // 2. Find the session in our DB
    const session = await safePrisma(() =>
      prisma.checkoutSession.findFirst({
        where: { gatewayTransactionId: txnid },
      })
    );

    if (!session) {
      console.error(`[PAYU_CALLBACK] Session not found for TXN: ${txnid}`);
      res.redirect(`${frontendBaseUrl}/checkout/failure?reason=session_not_found`);
      return;
    }

    // Idempotency Check: Don't process if already in a final state
    if (session.status === 'COMPLETED' || session.status === 'FAILED') {
      console.warn(`[PAYU_CALLBACK] TXN ${txnid} already processed with status ${session.status}`);
      const redirectPath = session.status === 'COMPLETED' ? 'success' : 'failure';
      res.redirect(`${frontendBaseUrl}/checkout/${redirectPath}?sessionId=${session.id}`);
      return;
    }

    // 3. Amount Tampering Protection
    const receivedAmount = parseFloat(getString(payload.amount));
    const expectedAmount = session.totalAmount;

    if (Math.abs(receivedAmount - expectedAmount) > 0.01) {
      console.error(`[PAYU_CALLBACK] Amount mismatch for TXN: ${txnid}. Expected ${expectedAmount}, received ${receivedAmount}`);
      await safePrisma(() =>
        prisma.checkoutSession.update({
          where: { id: session.id },
          data: { status: 'FAILED' },
        })
      );
      res.redirect(`${frontendBaseUrl}/checkout/failure?reason=amount_mismatch`);
      return;
    }

    // 4. Optional Reconciliation (Step 1.6)
    let reconciliationStatus = status;
    try {
      const reconData = await gateway.verifyPaymentReconciliation(txnid);
      if (reconData.status === 1 && reconData.transaction_details?.[txnid]) {
        const actualStatus = reconData.transaction_details[txnid].status.toLowerCase();
        console.info(`[PAYU_CALLBACK] Reconciliation Status: ${actualStatus}`);
        
        // PayU reconciliation can return 'success' or 'captured' for completed payments
        if (actualStatus === 'success' || actualStatus === 'captured') {
          reconciliationStatus = 'success';
        } else if (actualStatus === 'failure' || actualStatus === 'failed') {
          reconciliationStatus = 'failure';
        }
      }
    } catch (reconError) {
      console.warn(`[PAYU_CALLBACK] Reconciliation failed (ignoring):`, reconError);
    }

    // 4. Update Session Status
    const finalStatus = reconciliationStatus === 'success' ? 'COMPLETED' : 'FAILED';

    await safePrisma(() =>
      prisma.checkoutSession.update({
        where: { id: session.id },
        data: {
          status: finalStatus,
          // Store mihpayid or other reference if needed
          gatewayClientSecret: payload.mihpayid || session.gatewayClientSecret,
        },
      })
    );

    // 5. Redirect User or return JSON for API clients
    const isJsonRequested = req.headers.accept?.includes('application/json');

    if (isJsonRequested) {
      res.status(finalStatus === 'COMPLETED' ? 200 : 400).json({
        success: finalStatus === 'COMPLETED',
        status: finalStatus,
        sessionId: session.id,
        reason: finalStatus === 'FAILED' ? status : undefined,
      });
      return;
    }

    const redirectUrl =
      finalStatus === 'COMPLETED'
        ? `${frontendBaseUrl}/checkout/success?sessionId=${session.id}`
        : `${frontendBaseUrl}/checkout/failure?sessionId=${session.id}&reason=${status}`;

    res.redirect(redirectUrl);
  } catch (error) {
    console.error('[PAYU_CALLBACK] Error processing callback:', error);
    res.redirect(`${frontendBaseUrl}/checkout/failure?reason=internal_error`);
  }
};
