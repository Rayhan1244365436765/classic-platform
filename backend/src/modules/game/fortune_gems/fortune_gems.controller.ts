import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../../../common/utils/AppError.js';
import { requireUserId } from '../../../common/utils/requireUser.js';
import { fortuneGemsConfig, playFortuneGems } from './fortune_gems.service.js';

/**
 * POST /api/game/fortune_gems/play
 * body: { betAmount: number } — the reels decide the outcome.
 */
export async function play(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = requireUserId(req);
    const betAmount = readBetAmount(req);

    const result = await playFortuneGems(userId, betAmount);

    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/game/fortune_gems/config
 * Symbols, the 4×3 board, the cluster paytable (shipped + as briefed) and the
 * measured odds, so the cabinet draws the same game the server settles.
 */
export function getConfig(_req: Request, res: Response): void {
  res.status(200).json(fortuneGemsConfig());
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
