import { z } from 'zod';

/** Mobile-money providers the operator accepts deposits through. */
export const PAYMENT_METHODS = ['bkash', 'nagad'] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Bangladeshi mobile number in local form: 01[3-9] + 8 digits. */
const BD_MOBILE = /^01[3-9]\d{8}$/;

/** bKash / Nagad transaction ids are short alphanumeric codes. */
const TRX_ID = /^[A-Z0-9]{6,20}$/;

/** Removes spaces and dashes, and a +88 / 88 country prefix: "+880 1972-227996" → "01972227996". */
function normalisePhone(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  return value.replace(/[\s-]/g, '').replace(/^\+?88(?=01)/, '');
}

/** Trims and upper-cases so "8n7a6d5e4c" and "8N7A6D5E4C" count as the same id. */
function normaliseTrxId(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().toUpperCase() : value;
}

/**
 * POST /api/payment/deposit body.
 *
 * `amount` also accepts a numeric string (the web form sends what was typed).
 */
export const depositSchema = z.object({
  amount: z.coerce
    .number({ error: 'Amount is required and must be a number' })
    .positive('Amount must be greater than 0'),
  paymentMethod: z
    .enum(PAYMENT_METHODS, { error: 'Payment method must be bkash or nagad' })
    .default('bkash'),
  senderNumber: z.preprocess(
    normalisePhone,
    z
      .string({ error: 'Sender number is required' })
      .regex(BD_MOBILE, 'Sender number must be a valid Bangladeshi mobile number'),
  ),
  trxId: z.preprocess(
    normaliseTrxId,
    z
      .string({ error: 'Transaction ID is required' })
      .regex(TRX_ID, 'Transaction ID must be 6-20 letters or digits'),
  ),
});

export type DepositInput = z.infer<typeof depositSchema>;
