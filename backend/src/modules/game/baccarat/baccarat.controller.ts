import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../../../common/utils/AppError.js';
import { requireUserId } from '../../../common/utils/requireUser.js';
import { baccaratConfig, playBaccarat, type BaccaratBet } from './baccarat.service.js';

/**
 * POST /api/game/baccarat/play
 * body: { betAmount: number, betOn: 'player' | 'banker' | 'tie' }
 */
export async function play(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = requireUserId(req);
    const betAmount = readBetAmount(req);
    const betOn = readBetOn(req);

    const result = await playBaccarat(userId, betAmount, betOn);

    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/game/baccarat/config
 * Payouts, the third-card rules and the exact win/tie odds, so the table can
 * print the same numbers the server settles on.
 */
export function getConfig(_req: Request, res: Response): void {
  res.status(200).json(baccaratConfig());
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

function readBetOn(req: Request): BaccaratBet {
  const raw = (req.body as { betOn?: unknown } | undefined)?.betOn;

  if (raw !== 'player' && raw !== 'banker' && raw !== 'tie') {
    throw new AppError('VALIDATION_ERROR', 400, "betOn: Must be 'player', 'banker' or 'tie'");
  }

  return raw;
}
