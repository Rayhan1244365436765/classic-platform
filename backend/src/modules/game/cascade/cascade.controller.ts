import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../../../common/utils/AppError.js';
import { requireUserId } from '../../../common/utils/requireUser.js';
import { cascadeConfig, playCascade } from './cascade.service.js';

/**
 * POST /api/game/cascade/play
 * body: { betAmount: number }
 */
export async function play(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = requireUserId(req);
    const betAmount = readBetAmount(req);

    const result = await playCascade(userId, betAmount);

    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/game/cascade/config
 * Symbols, geometry, the cascade multipliers, the pay table and the measured
 * RTP — everything the cabinet prints.
 */
export function getConfig(_req: Request, res: Response): void {
  res.status(200).json(cascadeConfig());
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
