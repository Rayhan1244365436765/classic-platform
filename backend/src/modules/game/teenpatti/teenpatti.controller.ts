import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../../../common/utils/AppError.js';
import { requireUserId } from '../../../common/utils/requireUser.js';
import { playTeenPatti, teenPattiConfig } from './teenpatti.service.js';

/**
 * POST /api/game/teenpatti/play
 * body: { betAmount: number }  — one hand against the dealer, no side to pick
 */
export async function play(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = requireUserId(req);
    const betAmount = readBetAmount(req);

    const result = await playTeenPatti(userId, betAmount);

    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/game/teenpatti/config
 * Ranking, payouts and the exact odds (from the deck, not a constant), so the
 * table prints the same numbers the server settles on.
 */
export function getConfig(_req: Request, res: Response): void {
  res.status(200).json(teenPattiConfig());
}

function readBetAmount(req: Request): number {
  const body = (req.body ?? {}) as { betAmount?: unknown };
  const raw = body.betAmount;
  const amount = typeof raw === 'string' ? Number(raw) : raw;

  if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    throw new AppError(
      'VALIDATION_ERROR',
      400,
      'betAmount: Bet amount is required and must be a number',
    );
  }

  return amount;
}
