import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../../../common/utils/AppError.js';
import { requireUserId } from '../../../common/utils/requireUser.js';
import { classicRouletteConfig, playRoulette } from './classic_roulette.service.js';

/**
 * POST /api/game/classic_roulette/play
 * body: { betAmount: number, betType: string, betValue?: number }
 *   betType: 'number' | 'red' | 'black' | 'even' | 'odd' | 'low' | 'high'
 *   betValue: required (0–36) for a straight number bet, ignored otherwise
 */
export async function play(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = requireUserId(req);
    const betAmount = readBetAmount(req);
    const betType = readBetType(req);
    const betValue = (req.body as { betValue?: unknown } | undefined)?.betValue;

    const result = await playRoulette(userId, betAmount, betType, betValue);

    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/game/classic_roulette/config
 * Pocket layout, colours, payouts and exact odds, so the client draws the same
 * table the server settles on.
 */
export function getConfig(_req: Request, res: Response): void {
  res.status(200).json(classicRouletteConfig());
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

function readBetType(req: Request): string {
  const raw = (req.body as { betType?: unknown } | undefined)?.betType;

  if (typeof raw !== 'string') {
    throw new AppError(
      'VALIDATION_ERROR',
      400,
      "betType: Must be 'number', 'red', 'black', 'even', 'odd', 'low' or 'high'",
    );
  }

  return raw;
}
