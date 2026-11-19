import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../../common/utils/AppError.js';
import { requireUserId } from '../../common/utils/requireUser.js';
import {
  approvePayment as approvePaymentRequest,
  getPendingPayments as fetchPendingPayments,
  getStats as fetchStats,
  getTransactions as fetchTransactions,
  getUsers as fetchUsers,
  rejectPayment as rejectPaymentRequest,
} from './admin.service.js';
import {
  getGameConfigSummary,
  listGameConfigs,
  setGameConfig,
} from '../config/config.service.js';

/**
 * Admin read endpoints. Every handler is behind `authGuard` + `adminGuard`,
 * so `req.user.role === 'admin'` has already been verified.
 */

/** GET /api/admin/stats */
export async function getStats(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.status(200).json(await fetchStats());
  } catch (error) {
    next(error);
  }
}

/** GET /api/admin/users */
export async function getUsers(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const users = await fetchUsers();
    res.status(200).json({ users });
  } catch (error) {
    next(error);
  }
}

/** GET /api/admin/transactions */
export async function getTransactions(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const transactions = await fetchTransactions();
    res.status(200).json({ transactions });
  } catch (error) {
    next(error);
  }
}

/** GET /api/admin/payments */
export async function getPayments(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const payments = await fetchPendingPayments();
    res.status(200).json({ payments });
  } catch (error) {
    next(error);
  }
}

/** POST /api/admin/payments/:id/approve */
export async function approvePayment(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const adminId = requireUserId(req);
    const payment = await approvePaymentRequest(readPaymentId(req), adminId);
    res.status(200).json({ payment });
  } catch (error) {
    next(error);
  }
}

/** POST /api/admin/payments/:id/reject */
export async function rejectPayment(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const adminId = requireUserId(req);
    const payment = await rejectPaymentRequest(readPaymentId(req), adminId);
    res.status(200).json({ payment });
  } catch (error) {
    next(error);
  }
}

function readPaymentId(req: Request): string {
  // Express 5 types route params as `string | string[]` (wildcards).
  const raw = req.params.id;
  const id = Array.isArray(raw) ? raw[0] : raw;

  if (!id) {
    throw new AppError('PAYMENT_NOT_FOUND', 404, 'Payment request not found');
  }

  return id;
}

/** GET /api/admin/games — list every game config + derived RTP/edge. */
export async function listGames(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.status(200).json({ games: listGameConfigs() });
  } catch (error) {
    next(error);
  }
}

/** GET /api/admin/games/:id/config */
export async function getGameConfig(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const game = getGameConfigSummary(readGameId(req));
    if (!game) {
      throw new AppError('GAME_CONFIG_NOT_FOUND', 404, 'No configuration for this game');
    }

    res.status(200).json({ game });
  } catch (error) {
    next(error);
  }
}

/** PUT /api/admin/games/:id/config */
export async function updateGameConfig(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const adminId = requireUserId(req);
    const id = readGameId(req);
    const rawConfig = (req.body as { config?: unknown } | undefined)?.config;

    await setGameConfig(id, rawConfig, adminId);

    const game = getGameConfigSummary(id);
    if (!game) {
      throw new AppError('GAME_CONFIG_NOT_FOUND', 404, 'No configuration for this game');
    }

    res.status(200).json({ game });
  } catch (error) {
    next(error);
  }
}

function readGameId(req: Request): string {
  const raw = req.params.id;
  const id = Array.isArray(raw) ? raw[0] : raw;

  if (!id) {
    throw new AppError('UNKNOWN_GAME', 404, 'Game id is required');
  }

  return id;
}

