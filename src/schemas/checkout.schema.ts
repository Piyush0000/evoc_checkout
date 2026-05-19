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
        image: z.string().optional(),
        options: z.record(z.string(), z.string()).optional(),
      })
    )
    .min(1, 'At least one item is required'),
  currency: z.enum(['INR', 'USD']),
  successUrl: z.string().url('Invalid success URL').optional(),
  cancelUrl: z.string().url('Invalid cancel URL').optional(),
});

export const FinalizeSessionSchema = z.object({
  sessionId: z.string().uuid('Invalid session ID'),
  paymentMethod: z.string().min(1, 'Payment method is required'),
});

export type CreateSessionInput = z.infer<typeof CreateSessionSchema>;
export type FinalizeSessionInput = z.infer<typeof FinalizeSessionSchema>;
