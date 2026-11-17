import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../../../common/utils/AppError.js';
import { requireUserId } from '../../../common/utils/requireUser.js';
import { playSpin, wheelConfig } from './roulette.service.js';

/**
 * POST /api/game/roulette/play
 * body: { betAmount: number } — the wheel picks the multiplier, so there is no
 * bet type to choose. `betType`/`betValue` from older clients are ignored.
 */
export async function play(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = requireUserId(req);
    const betAmount = readBetAmount(req);

    const result = await playSpin(userId, betAmount);

    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/game/roulette/segments
 * Publishes the wheel layout, per-multiplier odds and the RTP so clients draw
 * exactly the table the server settles on.
 */
export function getSegments(_req: Request, res: Response): void {
  res.status(200).json(wheelConfig());
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
