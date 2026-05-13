import { Request, Response } from 'express';
import { ZodError } from 'zod';
import { safePrisma } from '../config/database.js';
import { prisma } from '../config/prisma.js';
import { SendOtpSchema, VerifyOtpSchema } from '../schemas/auth.schema.js';
import { OtpService } from '../services/otp.service.js';

export const sendOtp = async (req: Request, res: Response): Promise<void> => {
  try {
    const validatedData = SendOtpSchema.parse(req.body);
    const { phone, sessionId } = validatedData;
    const storeId = req.headers['x-store-id'] as string;

    if (!storeId) {
      res.status(400).json({ success: false, message: 'x-store-id header is required' });
      return;
    }

    const session = await safePrisma(() =>
      prisma.checkoutSession.findUnique({
        where: { id: sessionId },
      })
    );

    if (!session) {
      res.status(404).json({ success: false, message: 'Checkout session not found' });
      return;
    }

    // P2 FIX: Expiry Check
    if (session.expiresAt < new Date()) {
      res.status(410).json({
        success: false,
        message: 'Checkout session has expired. Please start over.',
      });
      return;
    }

    // Tenant Isolation Check
    if (session.storeId !== storeId) {
      res.status(403).json({ success: false, message: 'Unauthorized access to session' });
      return;
    }

    // 1. Call 2Factor API
    const providerSessionId = await OtpService.sendOtp(phone);
    // Use the central sanitization for DB consistency
    const dbPhone = OtpService.sanitizePhone(phone);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes expiry

    // 2. Save the external session ID to our DB
    console.info(
      `[DEBUG] Saving OTP verification: phone=${dbPhone}, sessionId=${sessionId}, providerSessionId=${providerSessionId}`
    );
    await safePrisma(() =>
      prisma.otpVerification.create({
        data: {
          phone: dbPhone,
          providerSessionId,
          sessionId,
          expiresAt,
        },
      })
    );

    res.status(200).json({
      success: true,
      message: 'OTP sent successfully',
    });
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      res.status(400).json({ success: false, errors: error.issues });
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
    const storeId = req.headers['x-store-id'] as string;

    if (!storeId) {
      res.status(400).json({ success: false, message: 'x-store-id header is required' });
      return;
    }

    const session = await safePrisma(() =>
      prisma.checkoutSession.findUnique({
        where: { id: sessionId },
      })
    );

    if (!session) {
      res.status(404).json({ success: false, message: 'Checkout session not found' });
      return;
    }

    // P2 FIX: Expiry Check
    if (session.expiresAt < new Date()) {
      res.status(410).json({
        success: false,
        message: 'Checkout session has expired. Please start over.',
      });
      return;
    }

    // Tenant Isolation Check
    if (session.storeId !== storeId) {
      res.status(403).json({ success: false, message: 'Unauthorized access to session' });
      return;
    }

    // 1. Find the OTP record to get the providerSessionId
    const dbPhone = OtpService.sanitizePhone(phone);
    console.info(`[DEBUG] Finding OTP record for phone: ${dbPhone}, sessionId: ${sessionId}`);
    const otpRecord = await safePrisma(() =>
      prisma.otpVerification.findFirst({
        where: {
          phone: dbPhone,
          sessionId,
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: 'desc' },
      })
    );

    if (!otpRecord) {
      console.warn(
        `[DEBUG] OTP record not found or expired for phone: ${dbPhone}, sessionId: ${sessionId}`
      );
      res.status(400).json({ success: false, message: 'OTP request not found or expired' });
      return;
    }

    // 2. Verify with 2Factor API using the phone number method
    console.info(`[DEBUG] Verifying OTP with phone: ${dbPhone}, code: ${code}`);
    const isVerified = await OtpService.verifyOtp(dbPhone, code);

    if (!isVerified) {
      res.status(400).json({ success: false, message: 'Invalid or expired OTP' });
      return;
    }

    const user = await safePrisma(() =>
      prisma.user.upsert({
        where: { phone: dbPhone },
        update: {},
        create: { phone: dbPhone },
      })
    );

    // Smart Status Update: Only transition to AUTHENTICATED if currently PENDING_AUTH
    const newStatus = session.status === 'PENDING_AUTH' ? 'AUTHENTICATED' : session.status;

    const updatedSession = await safePrisma(() =>
      prisma.checkoutSession.update({
        where: { id: sessionId },
        data: {
          userId: user.id,
          status: newStatus,
        },
      })
    );

    await safePrisma(() =>
      prisma.otpVerification.delete({
        where: { id: otpRecord.id },
      })
    );

    res.status(200).json({
      success: true,
      message: 'Authentication successful',
      user: {
        id: user.id,
        phone: user.phone,
        firstName: user.firstName,
        lastName: user.lastName,
      },
      sessionStatus: updatedSession.status,
    });
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      res.status(400).json({ success: false, errors: error.issues });
      return;
    }
    console.error('Error verifying OTP:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
