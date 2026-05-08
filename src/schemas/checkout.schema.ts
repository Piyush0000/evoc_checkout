import { z } from 'zod';

export const CreateSessionSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string(), // ID from the external product service
        variantId: z.string().optional(),
        sku: z.string(),
        name: z.string(),
        variantName: z.string().optional(),
        price: z.number().positive(),
        compareAtPrice: z.number().positive().optional(),
        quantity: z.number().int().positive(),
        image: z.string().url().optional(),
        options: z.record(z.string(), z.string()).optional(),
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
