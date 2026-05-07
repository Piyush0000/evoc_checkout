import { Request, Response } from 'express';
import { prisma } from '../config/prisma.js';
import { UpdateProfileSchema } from '../schemas/user.schema.js';

export const updateProfile = async (req: Request, res: Response): Promise<void> => {
  try {
    const validatedData = UpdateProfileSchema.parse(req.body);
    const { sessionId, ...profileData } = validatedData;

    // 1. Find the session to get the associated user
    const session = await prisma.checkoutSession.findUnique({
      where: { id: sessionId },
      include: { user: true },
    });

    if (!session || !session.userId) {
      res.status(404).json({
        success: false,
        message: 'Session not found or user not authenticated',
      });
      return;
    }

    // 2. Update the User profile (Permanent storage)
    const updatedUser = await prisma.user.update({
      where: { id: session.userId as string },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: profileData as any,
    });

    // 3. Update Session Status
    const updatedSession = await prisma.checkoutSession.update({
      where: { id: sessionId as string },
      data: {
        status: 'ADDRESS_CONFIRMED',
      },
    });

    res.status(200).json({
      success: true,
      message: 'Profile updated and address confirmed',
      user: updatedUser,
      sessionStatus: updatedSession.status,
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'ZodError') {
      res.status(400).json({
        success: false,
        errors: (error as unknown as { errors: unknown }).errors,
      });
      return;
    }

    // Handle Prisma unique constraint violations (duplicate email)
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
      res.status(400).json({
        success: false,
        message: 'This email is already associated with another account',
      });
      return;
    }

    console.error('Error updating profile:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
