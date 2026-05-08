import { randomInt } from 'node:crypto';
import { Request, Response } from 'express';
import { prisma } from '../config/prisma.js';
import { SendOtpSchema, VerifyOtpSchema } from '../schemas/auth.schema.js';

export const sendOtp = async (req: Request, res: Response): Promise<void> => {
  try {
    const validatedData = SendOtpSchema.parse(req.body);
    const { phone, sessionId } = validatedData;

    const session = await prisma.checkoutSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      res.status(404).json({ success: false, message: 'Checkout session not found' });
      return;
    }

    const otpCode = randomInt(100000, 999999).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await prisma.otpVerification.create({
      data: {
        phone,
        code: otpCode,
        sessionId,
        expiresAt,
      },
    });

    // Only log the OTP in development for testing purposes.
    // In production, this would be sent via SMS/Email and never logged.
    if (process.env.NODE_ENV !== 'production') {
      console.info(`[AUTH] OTP for ${phone} (Session: ${sessionId}): ${otpCode}`);
    }

    res.status(200).json({
      success: true,
      message: 'OTP sent successfully',
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'ZodError') {
      res
        .status(400)
        .json({ success: false, errors: (error as unknown as { errors: unknown }).errors });
      return;
    }
    console.error('Error sending OTP:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const verifyOtp = async (req: Request, res: Response): Promise<void> => {
  try {
    const validatedData = VerifyOtpSchema.parse(req.body);
    const { phone, code, sessionId } = validatedData;

    const otpRecord = await prisma.otpVerification.findFirst({
      where: {
        phone,
        code,
        sessionId,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!otpRecord) {
      res.status(400).json({ success: false, message: 'Invalid or expired OTP' });
      return;
    }

    const user = await prisma.user.upsert({
      where: { phone },
      update: {},
      create: { phone },
    });

    const updatedSession = await prisma.checkoutSession.update({
      where: { id: sessionId },
      data: {
        userId: user.id,
        status: 'AUTHENTICATED',
      },
    });

    await prisma.otpVerification.delete({
      where: { id: otpRecord.id },
    });

    res.status(200).json({
      success: true,
      message: 'Authentication successful',
      user: {
        id: user.id,
        phone: user.phone,
        firstName: user.firstName,
        lastName: user.lastName,
        address: user.address,
        city: user.city,
        state: user.state,
        landmark: user.landmark,
        pincode: user.pincode,
      },
      sessionStatus: updatedSession.status,
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'ZodError') {
      res
        .status(400)
        .json({ success: false, errors: (error as unknown as { errors: unknown }).errors });
      return;
    }
    console.error('Error verifying OTP:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
