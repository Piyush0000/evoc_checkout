import { z } from 'zod';

export const CreateSessionSchema = z.object({
  items: z
    .array(
      z.object({
        sku: z.string(),
        name: z.string(),
        price: z.number().positive(),
        quantity: z.number().int().positive(),
        imageUrl: z.string().url().optional(),
        discount: z.number().min(0).optional(),
      })
    )
    .min(1, 'At least one item is required'),
  currency: z.string().default('INR'),
});

export const FinalizeSessionSchema = z.object({
  sessionId: z.string().uuid('Invalid session ID'),
  paymentMethod: z.enum(['CARD', 'UPI', 'NET_BANKING', 'COD', 'WALLET']),
});

export type CreateSessionInput = z.infer<typeof CreateSessionSchema>;
export type FinalizeSessionInput = z.infer<typeof FinalizeSessionSchema>;
