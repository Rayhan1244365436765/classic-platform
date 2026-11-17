import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../../../common/utils/AppError.js';
import { requireUserId } from '../../../common/utils/requireUser.js';
import { playSlots, slotsConfig } from './slots.service.js';

/**
 * POST /api/game/slots/play
 * body: { betAmount: number } — the reels decide the outcome.
 */
export async function play(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = requireUserId(req);
    const betAmount = readBetAmount(req);

    const result = await playSlots(userId, betAmount);

    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/game/slots/config
 * Publishes the symbol set and the paytable so the cabinet renders the same
 * rules the server settles on (no probabilities are exposed).
 */
export function getConfig(_req: Request, res: Response): void {
  res.status(200).json(slotsConfig());
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
