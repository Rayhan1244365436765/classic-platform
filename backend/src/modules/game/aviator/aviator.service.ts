import crypto from 'node:crypto';

import type { PoolClient } from 'pg';

import {
  generateClientSeed,
  generateProvablyFairFloat,
  generateServerSeed,
  hashServerSeed,
} from '../../../common/provably-fair/index.js';
import { AppError } from '../../../common/utils/AppError.js';
import { withTransaction } from '../../../config/db.js';
import { createTransaction, getBalance, lockUser } from '../../wallet/wallet.service.js';

/**
 * Aviator — a crash round with one player per round.
 *
 * Lifecycle:
 *   1. `startRound()` generates the hidden crash point, debits the stake and
 *      stores the round as `pending` with `started_at` taken from Postgres.
 *   2. The multiplier is a pure function of elapsed time:
 *        multiplier(t) = e^(t / GROWTH_TAU_MS)
 *      so `flightMs = GROWTH_TAU_MS · ln(crashPoint)` is when it bursts.
 *   3. `cashOut()` re-derives the elapsed time **on the server** and settles:
 *      too late → the round is recorded as `crashed` (loses), otherwise the
 *      player is paid min(client claim, server multiplier).
 *
 * --- house edge ------------------------------------------------------------
 *      crashPoint = max(1, (100 / (100 − u)) × 0.95),  u ∈ [0, 100)
 *   ⇒  P(crash ≥ m) = 0.95 / m   for every m > 1
 *   ⇒  EV(cash out at m) = m · P − 1 = −5%
 * The edge is therefore 5% independent of the cash-out multiplier. Rounding the
 * point down to 2dp and capping it at CRASH_CAP only ever moves money *to* the
 * house (the cap removes the fat tail without touching P(crash ≥ m) ≤ 100).
 *
 * --- why the client gets `durationMs` --------------------------------------
 * The API returns when the round will burst so the UI can animate the crash.
 * That is not an exploit because `cashOut()` never trusts the client: the
 * elapsed time comes from `now() − started_at` and a late cash-out is recorded
 * as a loss, so knowing the crash time cannot be turned into a win.
 */

/** Time constant of the exponential climb: e^(t/τ). 1.2× ≈ 1.0s, 2× ≈ 3.8s. */
export const GROWTH_TAU_MS = 5500;

/** Highest multiplier a round can reach (protects the tail). */
export const CRASH_CAP = 100;

/** Lowest multiplier that can be cashed out (1.00 would be a free round). */
export const MIN_CASHOUT = 1.01;

/** Round state stored in `game_rounds.status`. */
export type AviatorStatus = 'pending' | 'cashed_out' | 'crashed';

export type StartResult = {
  roundId: string;
  serverSeedHash: string;
  /** Server timestamp of the round start (ISO). */
  startedAt: string;
  /** How long the plane flies before bursting (ms). */
  durationMs: number;
  betAmount: number;
  balanceAfter: number;
  /** Growth constant so the client animates the same curve. */
  growthTauMs: number;
  minCashout: number;
};

export type CashoutResult =
  | {
      roundId: string;
      status: 'cashed_out';
      /** Multiplier actually paid (≤ the server multiplier). */
      multiplier: number;
      payout: number;
      crashPoint: number;
      betAmount: number;
      balanceAfter: number;
    }
  | {
      roundId: string;
      status: 'crashed';
      multiplier: 0;
      payout: 0;
      crashPoint: number;
      betAmount: number;
      balanceAfter: number;
    };

/** Table config for clients (no crash odds, no house edge). */
export function aviatorConfig(): {
  growthTauMs: number;
  crashCap: number;
  minCashout: number;
} {
  return { growthTauMs: GROWTH_TAU_MS, crashCap: CRASH_CAP, minCashout: MIN_CASHOUT };
}

/** Crash point from a uniform roll in `[0, 100)`. */
export function computeCrashPoint(roll: number): number {
  const raw = (100 / (100 - roll)) * 0.95;

  // Never below 1.00, never above the cap, and rounded *down* to 2 decimals.
  return Math.max(1, floor2(Math.min(CRASH_CAP, raw)));
}

/** Multiplier after `elapsedMs` of flight. */
export function multiplierAt(elapsedMs: number): number {
  return Math.exp(Math.max(0, elapsedMs) / GROWTH_TAU_MS);
}

/** How long the plane flies for a given crash point. */
export function flightMs(crashPoint: number): number {
  return Math.round(GROWTH_TAU_MS * Math.log(Math.max(1, crashPoint)));
}

/** Fixed per-round nonce for the MVP (same convention as the other games). */
const NONCE = 1;

type RoundRow = {
  id: string;
  bet_amount: string | number;
  crash_point: string | number;
  status: AviatorStatus;
  elapsed_ms: string | number;
  started_at: Date;
};

/** Open a round: debit the stake, commit a seed, hide the crash point. */
export async function startRound(userId: string, betAmount: number): Promise<StartResult> {
  const stake = assertBetAmount(betAmount);

  // 1. Commit + draw the crash point (nothing written yet).
  const serverSeed = generateServerSeed();
  const clientSeed = generateClientSeed();
  const serverSeedHash = hashServerSeed(serverSeed);
  const roll = generateProvablyFairFloat(serverSeed, clientSeed, NONCE) * 100;
  const crashPoint = computeCrashPoint(roll);
  const roundId = crypto.randomUUID();

  // 2. One transaction: close stale rounds, debit the stake, store the round.
  const { startedAt, balanceAfter } = await withTransaction(async (client) => {
    await lockUser(client, userId);

    const balance = await getBalance(userId, client);
    if (balance < stake) {
      throw new AppError(
        'INSUFFICIENT_FUNDS',
        400,
        `Insufficient funds: balance is ${balance.toFixed(2)}, bet is ${stake.toFixed(2)}`,
      );
    }

    await settleAbandonedRounds(client, userId);

    const live = await client.query<{ id: string }>(
      `SELECT id FROM game_rounds
        WHERE user_id = $1 AND bet_type = 'aviator' AND status = 'pending'
        LIMIT 1`,
      [userId],
    );

    if ((live.rowCount ?? 0) > 0) {
      throw new AppError(
        'ROUND_IN_PROGRESS',
        409,
        'A round is still flying — cash out before starting another one',
      );
    }

    await createTransaction(client, {
      userId,
      type: 'bet',
      amount: -stake,
      referenceId: roundId,
    });

    const inserted = await client.query<{ started_at: Date }>(
      `INSERT INTO game_rounds
         (id, user_id, bet_amount, bet_type, bet_value, result, payout, multiplier,
          crash_point, status, started_at, server_seed_hash)
       VALUES ($1, $2, $3, 'aviator', NULL, NULL, 0, 0, $4, 'pending', now(), $5)
       RETURNING started_at`,
      [roundId, userId, moneyString(stake), crashPoint.toFixed(2), serverSeedHash],
    );

    return {
      startedAt: inserted.rows[0]?.started_at ?? new Date(),
      balanceAfter: roundMoney(balance - stake),
    };
  });

  return {
    roundId,
    serverSeedHash,
    startedAt: new Date(startedAt).toISOString(),
    durationMs: flightMs(crashPoint),
    betAmount: stake,
    balanceAfter,
    growthTauMs: GROWTH_TAU_MS,
    minCashout: MIN_CASHOUT,
  };
}

/**
 * Cash out a flying round.
 *
 * The payout multiplier is `min(client claim, server multiplier)` where the
 * server multiplier comes from `now() − started_at`. A player who cashes out
 * after the burst gets `status: 'crashed'` and loses the stake, no matter what
 * multiplier they posted.
 */
export async function cashOut(
  userId: string,
  roundId: string,
  claimedMultiplier: number | undefined,
): Promise<CashoutResult> {
  if (claimedMultiplier !== undefined) {
    assertMultiplier(claimedMultiplier);
  }

  return withTransaction(async (client) => {
    await lockUser(client, userId);

    const result = await client.query<RoundRow>(
      `SELECT id, bet_amount, crash_point, status, started_at,
              EXTRACT(EPOCH FROM (now() - started_at)) * 1000 AS elapsed_ms
         FROM game_rounds
        WHERE id = $1 AND user_id = $2 AND bet_type = 'aviator'
        FOR UPDATE`,
      [roundId, userId],
    );

    const round = result.rows[0];
    if (!round) {
      throw new AppError('ROUND_NOT_FOUND', 404, 'Round does not exist');
    }

    if (round.status !== 'pending') {
      throw new AppError(
        'ROUND_ALREADY_SETTLED',
        409,
        `Round already settled (${round.status})`,
      );
    }

    const stake = roundMoney(Number(round.bet_amount));
    const crashPoint = roundMoney(Number(round.crash_point));
    const elapsedMs = Number(round.elapsed_ms);

    // Too late: record the burst, no payout.
    if (elapsedMs >= flightMs(crashPoint)) {
      await settleCrash(client, roundId, crashPoint);
      const balance = await getBalance(userId, client);

      return {
        roundId,
        status: 'crashed',
        multiplier: 0,
        payout: 0,
        crashPoint,
        betAmount: stake,
        balanceAfter: balance,
      };
    }

    const serverMultiplier = floor2(multiplierAt(elapsedMs));
    if (serverMultiplier < MIN_CASHOUT) {
      throw new AppError(
        'CASHOUT_TOO_EARLY',
        409,
        `Cash out at ${MIN_CASHOUT.toFixed(2)}× or higher`,
      );
    }

    // Never pay more than the plane actually flew, never below the minimum.
    const paidMultiplier = Math.min(
      Math.max(claimedMultiplier ?? serverMultiplier, MIN_CASHOUT),
      serverMultiplier,
    );
    const payout = roundMoney(stake * paidMultiplier);

    await createTransaction(client, {
      userId,
      type: 'win',
      amount: payout,
      referenceId: roundId,
    });

    await client.query(
      `UPDATE game_rounds
          SET status = 'cashed_out',
              multiplier = $2,
              payout = $3,
              result = $4,
              settled_at = now()
        WHERE id = $1`,
      [roundId, paidMultiplier.toFixed(2), moneyString(payout), crashPoint.toFixed(2)],
    );

    const balance = await getBalance(userId, client);

    return {
      roundId,
      status: 'cashed_out',
      multiplier: paidMultiplier,
      payout,
      crashPoint,
      betAmount: stake,
      balanceAfter: balance,
    };
  });
}

/**
 * Close a round as burst without paying — called by the client once its own
 * flight timer expires, so the audit row is settled immediately.
 *
 * Safe to call at any time: forfeiting a flying round just loses the stake,
 * and a round that is already settled returns its final state.
 */
export async function crashRound(userId: string, roundId: string): Promise<CashoutResult> {
  return withTransaction(async (client) => {
    await lockUser(client, userId);

    const result = await client.query<RoundRow>(
      `SELECT id, bet_amount, crash_point, status, started_at,
              EXTRACT(EPOCH FROM (now() - started_at)) * 1000 AS elapsed_ms
         FROM game_rounds
        WHERE id = $1 AND user_id = $2 AND bet_type = 'aviator'
        FOR UPDATE`,
      [roundId, userId],
    );

    const round = result.rows[0];
    if (!round) {
      throw new AppError('ROUND_NOT_FOUND', 404, 'Round does not exist');
    }

    const stake = roundMoney(Number(round.bet_amount));
    const crashPoint = roundMoney(Number(round.crash_point));

    if (round.status === 'pending') {
      await settleCrash(client, roundId, crashPoint);
    }

    const balance = await getBalance(userId, client);

    return {
      roundId,
      status: 'crashed',
      multiplier: 0,
      payout: 0,
      crashPoint,
      betAmount: stake,
      balanceAfter: balance,
    };
  });
}

/** Marks a round as burst (no payout) — used on a late cash-out and cleanup. */
async function settleCrash(client: PoolClient, roundId: string, crashPoint: number): Promise<void> {
  await client.query(
    `UPDATE game_rounds
        SET status = 'crashed',
            multiplier = 0,
            payout = 0,
            result = $2,
            settled_at = now()
      WHERE id = $1 AND status = 'pending'`,
    [roundId, crashPoint.toFixed(2)],
  );
}

/**
 * Closes rounds the player abandoned (closed the tab, lost connection). The
 * stake was already debited at `start`, so this only fixes the audit trail.
 */
async function settleAbandonedRounds(client: PoolClient, userId: string): Promise<void> {
  const pending = await client.query<{ id: string; crash_point: string | number; elapsed_ms: string | number }>(
    `SELECT id, crash_point,
            EXTRACT(EPOCH FROM (now() - started_at)) * 1000 AS elapsed_ms
       FROM game_rounds
      WHERE user_id = $1 AND bet_type = 'aviator' AND status = 'pending'`,
    [userId],
  );

  for (const row of pending.rows) {
    const crashPoint = roundMoney(Number(row.crash_point));
    if (Number(row.elapsed_ms) >= flightMs(crashPoint)) {
      await settleCrash(client, row.id, crashPoint);
    }
  }
}

function assertMultiplier(multiplier: number): void {
  if (typeof multiplier !== 'number' || !Number.isFinite(multiplier)) {
    throw new AppError('VALIDATION_ERROR', 400, 'multiplier: Must be a finite number');
  }

  if (multiplier <= 1) {
    throw new AppError('VALIDATION_ERROR', 400, 'multiplier: Must be greater than 1');
  }
}

function assertBetAmount(betAmount: number): number {
  if (typeof betAmount !== 'number' || !Number.isFinite(betAmount)) {
    throw new AppError('INVALID_BET_AMOUNT', 400, 'Bet amount must be a finite number');
  }

  const stake = roundMoney(betAmount);
  if (stake <= 0) {
    throw new AppError('INVALID_BET_AMOUNT', 400, 'Bet amount must be greater than 0');
  }

  return stake;
}

function roundMoney(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/** Rounds down to 2 decimals (never pays a fraction above the intended value). */
function floor2(amount: number): number {
  return Math.floor(amount * 100) / 100;
}

function moneyString(amount: number): string {
  return roundMoney(amount).toFixed(2);
}


