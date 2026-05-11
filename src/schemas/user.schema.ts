import { z } from 'zod';

export const UpdateProfileSchema = z.object({
  sessionId: z.string().uuid('Invalid session ID'),
  addressId: z.string().uuid().optional(), // Use existing address
  newAddress: z
    .object({
      type: z.enum(['HOME', 'WORK', 'OTHER']).default('HOME'),
      firstName: z.string().min(1, 'First name is required'),
      lastName: z.string().min(1, 'Last name is required'),
      flatHouse: z.string().min(1, 'Flat/House is required'),
      areaStreet: z.string().min(1, 'Street/Area is required'),
      city: z.string().min(1, 'City is required'),
      state: z.string().min(1, 'State is required'),
      landmark: z.string().optional(),
      receiversPhone: z.string().min(10, 'Receiver phone must be at least 10 digits'),
      pincode: z.string().regex(/^\d{6}$/, 'Pincode must be 6 digits'),
    })
    .optional(),
  email: z.string().email('Invalid email address'),
});

export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>;
