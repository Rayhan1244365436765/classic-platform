import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../../../common/utils/AppError.js';
import { requireUserId } from '../../../common/utils/requireUser.js';
import { dice3dConfig, playDice3d } from './dice3d.service.js';

/**
 * POST /api/game/dice3d/play
 * body: { betAmount: number, betType: 'high' | 'low' | 3…18 }
 *
 * `betType` is passed through untouched so the service owns the rule for what a
 * legal bet is (and produces one consistent 400 message).
 */
export async function play(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = requireUserId(req);
    const body = (req.body ?? {}) as { betAmount?: unknown; betType?: unknown };
    const betAmount = readBetAmount(body.betAmount);

    const result = await playDice3d(userId, betAmount, body.betType);

    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/game/dice3d/config
 * The paytable and exact odds, so the felt can print the same numbers the
 * server settles on.
 */
export function getConfig(_req: Request, res: Response): void {
  res.status(200).json(dice3dConfig());
}

function readBetAmount(raw: unknown): number {
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
