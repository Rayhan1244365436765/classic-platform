import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../../common/utils/AppError.js';
import { requireUserId } from '../../common/utils/requireUser.js';
import { depositSchema, withdrawSchema } from './payment.schema.js';
import {
  createDepositRequest,
  createWithdrawRequest,
  listUserPayments,
} from './payment.service.js';

/**
 * Player payment endpoints. All sit behind `authGuard`; the owner comes from the
 * verified JWT, never from the body.
 */

/**
 * POST /api/payment/deposit
 * body: { amount, paymentMethod: 'bkash' | 'nagad', senderNumber, trxId }
 */
export async function deposit(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const input = depositSchema.parse(req.body);
    const payment = await createDepositRequest(userId, input);
    res.status(201).json({ payment });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/payment/withdraw
 * body: { amount, paymentMethod: 'bkash' | 'nagad', receiverNumber }
 *
 * Validation messages are Bangla (the web cashier shows them verbatim), so only
 * the messages are returned — not the English `field:` prefix the global
 * handler adds for other endpoints.
 */
export async function withdraw(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUserId(req);

    const parsed = withdrawSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new AppError(
        'VALIDATION_ERROR',
        400,
        parsed.error.issues.map((issue) => issue.message).join('; '),
      );
    }

    const payment = await createWithdrawRequest(userId, parsed.data);
    res.status(201).json({ payment });
  } catch (error) {
    next(error);
  }
}

/** GET /api/payment/mine — the player's own request history. */
export async function myPayments(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const payments = await listUserPayments(userId);
    res.status(200).json({ payments });
  } catch (error) {
    next(error);
  }
}

