import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../../common/utils/AppError.js';
import { requireUserId } from '../../common/utils/requireUser.js';
import { deposit as depositFunds, getBalance, withdraw as withdrawFunds } from './wallet.service.js';

/**
 * Wallet HTTP handlers.
 *
 * All three routes sit behind `authGuard`, so the caller's identity comes from
 * the verified JWT (`req.user.id`) — never from the request body.
 */

/** GET /api/wallet/balance */
export async function getMyBalance(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const balance = await getBalance(userId);
    res.status(200).json({ balance });
  } catch (error) {
    next(error);
  }
}

/** POST /api/wallet/deposit  body: { amount } */
export async function deposit(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const amount = readAmount(req);
    const transaction = await depositFunds(userId, amount);
    res.status(201).json({ transaction });
  } catch (error) {
    next(error);
  }
}

/** POST /api/wallet/withdraw  body: { amount } */
export async function withdraw(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const amount = readAmount(req);
    const transaction = await withdrawFunds(userId, amount);
    res.status(201).json({ transaction });
  } catch (error) {
    next(error);
  }
}

/**
 * Reads `amount` from the body. Numbers are accepted as-is and numeric strings
 * are coerced; sign and 2-decimal rounding are enforced by the service.
 * (Direct amounts are temporary — a payment gateway will replace this.)
 */
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
