import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../../../common/utils/AppError.js';
import { requireUserId } from '../../../common/utils/requireUser.js';
import { cashOut, getActiveGame, minesTable, revealTile, startGame } from './mines.service.js';

/** POST /api/game/mines/start  body: { betAmount, minesCount } */
export async function start(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = requireUserId(req);
    const betAmount = readNumber(req, 'betAmount');
    const minesCount = readNumber(req, 'minesCount');

    const game = await startGame(userId, betAmount, minesCount);

    res.status(201).json(game);
  } catch (error) {
    next(error);
  }
}

/** POST /api/game/mines/reveal  body: { gameId, tileIndex } */
export async function reveal(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = requireUserId(req);
    const gameId = readString(req, 'gameId');
    const tileIndex = readNumber(req, 'tileIndex');

    const state = await revealTile(userId, gameId, tileIndex);

    res.status(200).json(state);
  } catch (error) {
    next(error);
  }
}

/** POST /api/game/mines/cashout  body: { gameId } */
export async function cashout(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = requireUserId(req);
    const gameId = readString(req, 'gameId');

    const result = await cashOut(userId, gameId);

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

/** GET /api/game/mines/current — the board the player can resume. */
export async function current(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = requireUserId(req);
    const game = await getActiveGame(userId);

    res.status(200).json({ game });
  } catch (error) {
    next(error);
  }
}

/** GET /api/game/mines/table?mines=3 — multipliers for each reveal count. */
export function getTable(req: Request, res: Response, next: NextFunction): void {
  try {
    const raw = req.query.mines;
    const first = Array.isArray(raw) ? raw[0] : raw;
    const mines = first === undefined ? 3 : Number(first);

    if (!Number.isInteger(mines) || mines < 1 || mines > 24) {
      throw new AppError('INVALID_MINES_COUNT', 400, 'Mines must be between 1 and 24');
    }

    res.status(200).json({ minesCount: mines, multipliers: minesTable(mines) });
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
