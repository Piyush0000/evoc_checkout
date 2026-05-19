import { z } from 'zod';

export const SendOtpSchema = z.object({
  phone: z.string().regex(/^\+?[1-9]\d{1,14}$/, 'Invalid phone number format'),
  sessionId: z.string().uuid('Invalid session ID'),
});

export const VerifyOtpSchema = z.object({
  phone: z.string().regex(/^\+?[1-9]\d{1,14}$/, 'Invalid phone number format'),
  code: z.string().min(4, 'OTP must be at least 4 digits').max(6, 'OTP must be at most 6 digits'),
  sessionId: z.string().uuid('Invalid session ID'),
});

export type SendOtpInput = z.infer<typeof SendOtpSchema>;
export type VerifyOtpInput = z.infer<typeof VerifyOtpSchema>;
