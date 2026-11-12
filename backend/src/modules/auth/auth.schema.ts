import { z } from 'zod';

/**
 * Auth input validation.
 *
 * Deliberately minimal for the MVP: a phone number is any string of at least 10
 * characters, a password is at least 6 characters. Normalisation of the phone
 * (E.164) is handled by the caller/client for now.
 */
export const registerSchema = z.object({
  phone: z
    .string()
    .trim()
    .min(10, 'Phone must be at least 10 characters'),
  password: z
    .string()
    .min(6, 'Password must be at least 6 characters'),
});

export const loginSchema = z.object({
  phone: z
    .string()
    .trim()
    .min(10, 'Phone must be at least 10 characters'),
  password: z
    .string()
    .min(6, 'Password must be at least 6 characters'),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
