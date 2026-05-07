import { z } from 'zod';

export const UpdateProfileSchema = z.object({
  sessionId: z.string().uuid('Invalid session ID'),
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().optional(),
  address: z.string().min(5, 'Address must be at least 5 characters'),
  city: z.string().min(1, 'City is required'),
  state: z.string().min(1, 'State is required'),
  landmark: z.string().optional(),
  pincode: z.string().regex(/^\d{6}$/, 'Pincode must be 6 digits'),
  email: z.string().email('Invalid email address').optional(),
});

export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>;
