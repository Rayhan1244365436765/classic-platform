import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../../../common/utils/AppError.js';
import { requireUserId } from '../../../common/utils/requireUser.js';
import { plinkoConfig, playPlinko } from './plinko.service.js';

/**
 * POST /api/game/plinko/play
 * body: { betAmount: number, rows?: 8 }
 */
export async function play(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = requireUserId(req);
    const body = (req.body ?? {}) as { betAmount?: unknown; rows?: unknown };

    const betAmount = readNumber(body.betAmount, 'betAmount');
    const rows = body.rows === undefined ? undefined : readNumber(body.rows, 'rows');

    const result = await playPlinko(userId, betAmount, rows);

    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

/** GET /api/game/plinko/config — board size, pay table and RTP. */
export function getConfig(_req: Request, res: Response): void {
  res.status(200).json(plinkoConfig());
}

function readNumber(raw: unknown, field: string): number {
  const value = typeof raw === 'string' ? Number(raw) : raw;

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new AppError(
      'VALIDATION_ERROR',
      400,
      `${field}: ${field} is required and must be a number`,
    );
  }

  return value;
}
