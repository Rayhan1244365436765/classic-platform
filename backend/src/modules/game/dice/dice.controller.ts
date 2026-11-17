import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../../../common/utils/AppError.js';
import { requireUserId } from '../../../common/utils/requireUser.js';
import { diceConfig, playDice, type DicePrediction } from './dice.service.js';

/**
 * POST /api/game/dice/play
 * body: { betAmount: number, prediction: 'high' | 'low' }
 */
export async function play(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = requireUserId(req);
    const betAmount = readBetAmount(req);
    const prediction = readPrediction(req);

    const result = await playDice(userId, betAmount, prediction);

    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/game/dice/config
 * Publishes the payout multiplier and the winning ranges so the table renders
 * the same rules the server settles on. No odds are exposed.
 */
export function getConfig(_req: Request, res: Response): void {
  res.status(200).json(diceConfig());
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

function readPrediction(req: Request): DicePrediction {
  const raw = (req.body as { prediction?: unknown } | undefined)?.prediction;

  if (raw !== 'high' && raw !== 'low') {
    throw new AppError('VALIDATION_ERROR', 400, "prediction: Must be 'high' or 'low'");
  }

  return raw;
}
