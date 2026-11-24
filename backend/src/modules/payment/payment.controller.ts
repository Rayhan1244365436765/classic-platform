import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../../common/utils/AppError.js';
import { requireUserId } from '../../common/utils/requireUser.js';
import { depositSchema } from './payment.schema.js';
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

/** POST /api/payment/withdraw  body: { amount } */
export async function withdraw(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const amount = readAmount(req);
    const payment = await createWithdrawRequest(userId, amount);
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

/** Numbers are accepted as-is; numeric strings are coerced. */
function readAmount(req: Request): number {
  const raw = (req.body as { amount?: unknown } | undefined)?.amount;
  const amount = typeof raw === 'string' ? Number(raw) : raw;

  if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    throw new AppError(
      'VALIDATION_ERROR',
      400,
      'amount: Amount is required and must be a number',
    );
  }

  return amount;
}
