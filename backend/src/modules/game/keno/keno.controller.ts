import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../../../common/utils/AppError.js';
import { requireUserId } from '../../../common/utils/requireUser.js';
import { kenoConfig, playKeno } from './keno.service.js';

/**
 * POST /api/game/keno/play
 * body: { betAmount: number, selectedNumbers: number[] }   // 1–10 picks, 1–80
 */
export async function play(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = requireUserId(req);
    const betAmount = readBetAmount(req);
    const selectedNumbers = readSelectedNumbers(req);

    const result = await playKeno(userId, betAmount, selectedNumbers);

    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/game/keno/config
 * Board size, pick limits and the real pay tables, so the client renders the
 * same ladders the server settles on.
 */
export function getConfig(_req: Request, res: Response): void {
  res.status(200).json(kenoConfig());
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

/** Keeps the raw shape check in the controller; ranges/duplicates live in the service. */
function readSelectedNumbers(req: Request): number[] {
  const raw = (req.body as { selectedNumbers?: unknown } | undefined)?.selectedNumbers;

  if (!Array.isArray(raw)) {
    throw new AppError(
      'VALIDATION_ERROR',
      400,
      'selectedNumbers: Must be an array of 1 to 10 numbers between 1 and 80',
    );
  }

  return raw as number[];
}
