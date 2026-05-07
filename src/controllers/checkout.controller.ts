import { Request, Response } from 'express';
import { prisma } from '../config/prisma.js';
import { CreateSessionSchema, FinalizeSessionSchema } from '../schemas/checkout.schema.js';

export const initSession = async (req: Request, res: Response): Promise<void> => {
  try {
    const validatedData = CreateSessionSchema.parse(req.body);
    const { items, currency } = validatedData;

    // Calculate total amount based on price, quantity and optional discount
    const totalAmount = items.reduce((acc, item) => {
      const price = item.price;
      const discount = item.discount || 0;
      return acc + (price - discount) * item.quantity;
    }, 0);

    // Create the session in the database
    const session = await prisma.checkoutSession.create({
      data: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        items: items as any, // Snapshot of items at the time of checkout
        totalAmount,
        currency,
        status: 'PENDING_AUTH',
      },
    });

    res.status(201).json({
      success: true,
      message: 'Checkout session initialized',
      data: {
        sessionId: session.id,
        totalAmount: session.totalAmount,
        currency: session.currency,
        status: session.status,
      },
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'ZodError') {
      res.status(400).json({
        success: false,
        errors: (error as unknown as { errors: unknown }).errors,
      });
      return;
    }
    console.error('Error initializing checkout session:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getSessionSummary = async (req: Request, res: Response): Promise<void> => {
  try {
    const { sessionId } = req.params;

    if (typeof sessionId !== 'string') {
      res.status(400).json({ success: false, message: 'Invalid session ID' });
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const session = await (prisma.checkoutSession as any).findUnique({
      where: { id: sessionId },
      include: { user: true },
    });

    if (!session) {
      res.status(404).json({ success: false, message: 'Session not found' });
      return;
    }

    res.status(200).json({
      success: true,
      data: {
        id: session.id,
        items: session.items,
        totalAmount: session.totalAmount,
        currency: session.currency,
        status: session.status,
        user: session.user
          ? {
              phone: session.user.phone,
              firstName: session.user.firstName,
              lastName: session.user.lastName,
              address: session.user.address,
              city: session.user.city,
              state: session.user.state,
              pincode: session.user.pincode,
            }
          : null,
      },
    });
  } catch (error: unknown) {
    console.error('Error fetching session summary:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const finalizeSession = async (req: Request, res: Response): Promise<void> => {
  try {
    const validatedData = FinalizeSessionSchema.parse(req.body);
    const { sessionId, paymentMethod } = validatedData;

    // 1. Check if session exists and is in correct state
    const session = await prisma.checkoutSession.findUnique({
      where: { id: sessionId as string },
    });

    if (!session) {
      res.status(404).json({ success: false, message: 'Session not found' });
      return;
    }

    if (session.status !== 'ADDRESS_CONFIRMED' && session.status !== 'AUTHENTICATED') {
      res.status(400).json({
        success: false,
        message: 'Session is not in a valid state for finalization',
      });
      return;
    }

    // 2. Transition to PAYMENT_PENDING
    const updatedSession = await prisma.checkoutSession.update({
      where: { id: sessionId as string },
      data: {
        status: 'PAYMENT_PENDING',
      },
    });

    // 3. In a real app, here you would create an Order in your DB
    // and a Payment Intent in Razorpay/Stripe.
    res.status(200).json({
      success: true,
      message: `Checkout finalized with ${paymentMethod}`,
      sessionId: updatedSession.id,
      status: updatedSession.status,
      paymentMethod,
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'ZodError') {
      res.status(400).json({
        success: false,
        errors: (error as unknown as { errors: unknown }).errors,
      });
      return;
    }
    console.error('Error finalizing session:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
