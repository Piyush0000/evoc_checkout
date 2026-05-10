import { Request, Response } from 'express';
import { ZodError } from 'zod';
import { safePrisma } from '../config/database.js';
import { prisma } from '../config/prisma.js';
import { UpdateProfileSchema } from '../schemas/user.schema.js';

/**
 * Updates the user profile and selects/creates a shipping address.
 * Simplified: Focuses strictly on profile and address management.
 */
export const updateProfile = async (req: Request, res: Response): Promise<void> => {
  try {
    const validatedData = UpdateProfileSchema.parse(req.body);
    const { sessionId, addressId, newAddress, email } = validatedData;
    const storeIdFromHeader = req.headers['x-store-id'] as string;

    if (!storeIdFromHeader) {
      res.status(400).json({ success: false, message: 'x-store-id header is required' });
      return;
    }

    // 1. Find the session and user
    const session = await safePrisma(() =>
      prisma.checkoutSession.findUnique({
        where: { id: sessionId },
        include: { user: { include: { addresses: true } } },
      })
    );

    if (!session || !session.userId) {
      res.status(404).json({
        success: false,
        message: 'Session not found or user not authenticated',
      });
      return;
    }

    // 2. Tenant Isolation Check
    if (session.storeId !== storeIdFromHeader) {
      res.status(403).json({ success: false, message: 'Unauthorized' });
      return;
    }

    let selectedAddressId = addressId;

    // 3. Handle Address Logic (New vs Existing)
    if (newAddress) {
      const createdAddress = await safePrisma(() =>
        prisma.address.create({
          data: {
            ...newAddress,
            landmark: newAddress.landmark ?? null,
            userId: session.userId as string,
          },
        })
      );
      selectedAddressId = createdAddress.id;

      // Bonus: If the user doesn't have a name saved globally, use the shipping name
      if (!session.user?.firstName || !session.user?.lastName) {
        await safePrisma(() =>
          prisma.user.update({
            where: { id: session.userId as string },
            data: {
              firstName: session.user?.firstName || newAddress.firstName,
              lastName: session.user?.lastName || newAddress.lastName,
            },
          })
        );
      }
    } else if (addressId) {
      // Security Check: Verify that the addressId belongs to the user
      const userAddresses = session.user?.addresses || [];
      const belongsToUser = userAddresses.some((addr) => addr.id === addressId);

      if (!belongsToUser) {
        res.status(403).json({ success: false, message: 'Invalid address selection' });
        return;
      }
    } else {
      res.status(400).json({ success: false, message: 'Address is required' });
      return;
    }

    // 4. Update Global User Profile (Email)
    if (email) {
      await safePrisma(() =>
        prisma.user.update({
          where: { id: session.userId as string },
          data: { email },
        })
      );
    }

    // 5. Link Address to Session and Update Status
    const updatedSession = await safePrisma(() =>
      prisma.checkoutSession.update({
        where: { id: sessionId },
        data: {
          addressId: selectedAddressId ?? null,
          status: 'ADDRESS_CONFIRMED',
        },
      })
    );

    res.status(200).json({
      success: true,
      message: 'Profile and address updated successfully',
      data: {
        sessionStatus: updatedSession.status,
      },
    });
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      res.status(400).json({ success: false, errors: error.issues });
      return;
    }

    console.error('Update Profile Error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
