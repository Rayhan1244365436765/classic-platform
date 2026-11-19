import type { NextFunction, Request, Response } from 'express';

import { requireUserId } from '../../../common/utils/requireUser.js';
import { listGameHistory } from './history.service.js';

/** GET /api/game/history?limit=&offset= — the player's unified bet history. */
export async function getHistory(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const limit = readInt(req.query.limit, 20);
    const offset = readInt(req.query.offset, 0);

    const result = await listGameHistory(userId, limit, offset);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

function readInt(raw: unknown, fallback: number): number {
  if (typeof raw === 'string' && raw.trim() !== '') {
    const value = Number(raw);
    if (Number.isFinite(value)) return value;
  }
  return fallback;
}