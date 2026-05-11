import { Request, Response } from 'express';
import { z, ZodError } from 'zod';
import { safePrisma } from '../config/database.js';
import { prisma } from '../config/prisma.js';
import { Prisma } from '../generated/prisma/client.js';
import { CreateSessionSchema, FinalizeSessionSchema } from '../schemas/checkout.schema.js';
import { MerchantService } from '../services/merchant.service.js';
import { PaymentService } from '../services/payment.service.js';

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
    const customer = {
      firstName: session.address.firstName,
      lastName: session.address.lastName,
      email: session.user.email,
      phone: session.user.phone || session.address.receiversPhone,
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

    res.status(200).json({
      success: true,
      message: `Checkout finalized and ${gatewayConfig.name} intent created`,
      data: {
        sessionId: updatedSession.id,
        status: updatedSession.status,
        paymentGateway: gatewayConfig.name,
        gatewayTransactionId: intent.id,
        gatewayClientSecret: intent.clientSecret,
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
