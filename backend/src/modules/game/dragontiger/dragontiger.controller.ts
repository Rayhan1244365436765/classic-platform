import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../../../common/utils/AppError.js';
import { requireUserId } from '../../../common/utils/requireUser.js';
import {
  dragonTigerConfig,
  playDragonTiger,
  type DragonTigerBet,
} from './dragontiger.service.js';

/**
 * POST /api/game/dragontiger/play
 * body: { betAmount: number, betOn: 'dragon' | 'tiger' | 'tie' }
 */
export async function play(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = requireUserId(req);
    const betAmount = readBetAmount(req);
    const betOn = readBetOn(req);

    const result = await playDragonTiger(userId, betAmount, betOn);

    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/game/dragontiger/config
 * Shoe size, payouts and the exact odds, so the table prints the same numbers
 * the server settles on.
 */
export function getConfig(_req: Request, res: Response): void {
  res.status(200).json(dragonTigerConfig());
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

function readBetOn(req: Request): DragonTigerBet {
  const raw = (req.body as { betOn?: unknown } | undefined)?.betOn;

  if (raw !== 'dragon' && raw !== 'tiger' && raw !== 'tie') {
    throw new AppError('VALIDATION_ERROR', 400, "betOn: Must be 'dragon', 'tiger' or 'tie'");
  }

  return raw;
}
