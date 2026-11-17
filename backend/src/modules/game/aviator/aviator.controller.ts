import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../../../common/utils/AppError.js';
import { requireUserId } from '../../../common/utils/requireUser.js';
import { aviatorConfig, cashOut, crashRound, startRound } from './aviator.service.js';

/**
 * POST /api/game/aviator/start
 * body: { betAmount } → debits the stake and opens a hidden-crash-point round.
 */
export async function start(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = requireUserId(req);
    const betAmount = readBetAmount(req);

    const round = await startRound(userId, betAmount);

    res.status(201).json(round);
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/game/aviator/cashout
 * body: { roundId, multiplier? }
 *
 * `multiplier` is the value the client displayed; the server pays
 * `min(claim, server multiplier)` so a late or inflated claim can never win.
 */
export async function cashout(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = requireUserId(req);
    const roundId = readRoundId(req);
    const multiplier = readOptionalMultiplier(req);

    const outcome = await cashOut(userId, roundId, multiplier);

    res.status(200).json(outcome);
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/game/aviator/crash
 * body: { roundId } — forfeits a flying round (the client calls this when its
 * own flight timer expires, so the round is not left `pending`).
 */
export async function crash(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = requireUserId(req);
    const roundId = readRoundId(req);

    const outcome = await crashRound(userId, roundId);

    res.status(200).json(outcome);
  } catch (error) {
    next(error);
  }
}

/** GET /api/game/aviator/config — growth curve constants for the client. */
export function getConfig(_req: Request, res: Response): void {
  res.status(200).json(aviatorConfig());
}

function readBetAmount(req: Request): number {
  const raw = (req.body ?? {})?.betAmount;
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

function readRoundId(req: Request): string {
  const raw = (req.body as { roundId?: unknown } | undefined)?.roundId;

  if (typeof raw !== 'string' || raw.length === 0) {
    throw new AppError('VALIDATION_ERROR', 400, 'roundId: roundId is required');
  }

  return raw;
}

function readOptionalMultiplier(req: Request): number | undefined {
  const raw = (req.body as { multiplier?: unknown } | undefined)?.multiplier;

  if (raw === undefined || raw === null) {
    return undefined;
  }

  const value = typeof raw === 'string' ? Number(raw) : raw;

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new AppError('VALIDATION_ERROR', 400, 'multiplier: Must be a finite number');
  }

  return value;
}
