import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../../../common/utils/AppError';
import { requireUserId } from '../../../common/utils/requireUser';
import { BET_TYPES, playRoulette, type BetType } from './roulette.service';

/**
 * POST /api/game/roulette/play
 * body: { betAmount: number, betType: 'red'|'black'|'green'|'number', betValue?: string }
 */
export async function play(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { betAmount, betType, betValue } = readBetBody(req);

    const result = await playRoulette(userId, betAmount, betType, betValue);

    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

type BetBody = {
  betAmount: number;
  betType: BetType;
  betValue: string | null;
};

/**
 * Shape/type checks only (400 VALIDATION_ERROR); business rules such as the
 * pocket range and the funds check are enforced by the service.
 */
function readBetBody(req: Request): BetBody {
  const body = (req.body ?? {}) as {
    betAmount?: unknown;
    betType?: unknown;
    betValue?: unknown;
  };

  const rawAmount = typeof body.betAmount === 'string' ? Number(body.betAmount) : body.betAmount;
  if (typeof rawAmount !== 'number' || !Number.isFinite(rawAmount)) {
    throw new AppError(
      'VALIDATION_ERROR',
      400,
      'betAmount: Bet amount is required and must be a number',
    );
  }

  if (typeof body.betType !== 'string' || !(BET_TYPES as readonly string[]).includes(body.betType)) {
    throw new AppError(
      'VALIDATION_ERROR',
      400,
      `betType: Bet type must be one of: ${BET_TYPES.join(', ')}`,
    );
  }

  const betValue =
    body.betValue === undefined || body.betValue === null ? null : String(body.betValue);

  return { betAmount: rawAmount, betType: body.betType as BetType, betValue };
}
