import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../../../common/utils/AppError.js';
import { requireUserId } from '../../../common/utils/requireUser.js';
import { getActiveGame, hit, stand, startGame } from './blackjack.service.js';

/** POST /api/game/blackjack/start  body: { betAmount } */
export async function start(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = requireUserId(req);
    const betAmount = readNumber(req, 'betAmount');

    const state = await startGame(userId, betAmount);

    res.status(201).json(state);
  } catch (error) {
    next(error);
  }
}

/** POST /api/game/blackjack/hit  body: { gameId } */
export async function hitCard(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = requireUserId(req);
    const gameId = readString(req, 'gameId');

    const state = await hit(userId, gameId);

    res.status(200).json(state);
  } catch (error) {
    next(error);
  }
}

/** POST /api/game/blackjack/stand  body: { gameId } */
export async function standHand(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = requireUserId(req);
    const gameId = readString(req, 'gameId');

    const state = await stand(userId, gameId);

    res.status(200).json(state);
  } catch (error) {
    next(error);
  }
}

/** GET /api/game/blackjack/current — the hand to resume, if any. */
export async function current(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = requireUserId(_req);
    const game = await getActiveGame(userId);

    res.status(200).json({ game });
  } catch (error) {
    next(error);
  }
}

function readNumber(req: Request, field: string): number {
  const raw = (req.body as Record<string, unknown> | undefined)?.[field];
  const value = typeof raw === 'string' ? Number(raw) : raw;

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new AppError('VALIDATION_ERROR', 400, `${field}: ${field} is required and must be a number`);
  }

  return value;
}

function readString(req: Request, field: string): string {
  const raw = (req.body as Record<string, unknown> | undefined)?.[field];

  if (typeof raw !== 'string' || raw.length === 0) {
    throw new AppError('VALIDATION_ERROR', 400, `${field}: ${field} is required`);
  }

  return raw;
}
