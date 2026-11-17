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
 * Keno — the player picks 1–10 numbers from a 1–80 board; the house draws 20.
 *
 * If the player picks `n` numbers and `k` of them are drawn, `k` follows a
 * hypergeometric distribution (20 draws out of 80, without replacement):
 *
 *   P(k | n) = C(20, k) · C(60, n − k) / C(80, n)
 *
 * --- the pay table ---------------------------------------------------------
 * The task's example table for 10 picks (…5→1×, 6→2×, 7→5×, 8→20×, 9→50×,
 * 10→100×) returns only **8.55%** RTP — a 91.45% house edge — because P(4 of 10)
 * is 14.7% and most of the money has to come back through the low catches. To
 * hold a 3% edge the multipliers must be far larger (10 of 10 is a 1-in-8.9
 * million event).
 *
 * So the ladder is *derived* from the exact probabilities instead of hard-coded,
 * one per pick count (`KENO_TARGET_RTP = 0.97`):
 *
 *   1. walk the catch levels up from 1 and take the most generous threshold `t`
 *      whose lowest prize still returns at least the stake
 *      (`KENO_MIN_LOWEST`) — no "win" that pays 6 cents on the dollar;
 *   2. spread the remaining RTP geometrically, `w(k) = 3^(k − t)`, so every
 *      extra catch is worth 3× the one below it;
 *   3. scale so that Σ P(k)·m(k) = target, then floor to 2 decimals — rounding
 *      can only ever move the edge towards the house.
 *
 * Resulting ladders (verified by `backend/scripts/verify-keno.cjs`):
 *
 *   picks  1 | 1→3.88                                          | 97.00%
 *   picks  5 | 2→1.49  3→4.48  4→13.46  5→40.38                | 96.78%
 *   picks 10 | 4→2.10  5→6.31  6→18.93  7→56.81  8→170.45
 *            | 9→511.35  10→1534.05                           | 96.91%
 *
 * --- provable fairness -----------------------------------------------------
 * The 20 numbers come from a partial Fisher–Yates shuffle of the 1–80 board:
 * for each of the 20 draws one digest keyed `${clientSeed}:${nonce}` picks an
 * element from the remaining pool. Every ordered 20-subset is therefore equally
 * likely, and the whole draw is reproducible from the revealed server seed.
 */

/** Numbers on the board. */
export const KENO_POOL = 80;

/** Numbers drawn each round. */
export const KENO_DRAWN = 20;

/** Fewest / most numbers a player may pick. */
export const KENO_MIN_PICKS = 1;
export const KENO_MAX_PICKS = 10;

/** Theoretical return-to-player every ladder is built to hit. */
const KENO_TARGET_RTP = 0.97;

/** Each additional catch is worth this much more than the one below it. */
const KENO_WEIGHT_RATIO = 3;

/** The lowest winning tier must at least return the stake. */
const KENO_MIN_LOWEST = 1;

export type KenoResult = {
  /** The numbers the player picked, ascending. */
  picked: number[];
  /** The 20 numbers the house drew, ascending. */
  drawn: number[];
  /** Picks that were drawn — the winning numbers. */
  matches: number[];
  hits: number;
  multiplier: number;
  payout: number;
  betAmount: number;
  balanceAfter: number;
  serverSeedHash: string;
  roundId: string;
};

/** One ladder: `multipliers[hits]` pays for `hits` catches. */
export type KenoPayTable = {
  picks: number;
  /** Index = number of catches (0 … picks). */
  multipliers: number[];
  /** First catch level that pays anything. */
  minHits: number;
  rtp: number;
};

/** C(n, k) as an exact integer — C(80,10) ≈ 1.6e12 is well inside 2⁵³. */
function combinations(n: number, k: number): number {
  if (k < 0 || k > n) return 0;

  let value = 1;
  for (let step = 0; step < k; step += 1) {
    value = (value * (n - step)) / (step + 1);
  }

  return Math.round(value);
}

/** P(k of n picked are drawn) — hypergeometric, no replacement. */
export function kenoProbability(picks: number, hits: number): number {
  return (
    (combinations(KENO_DRAWN, hits) * combinations(KENO_POOL - KENO_DRAWN, picks - hits)) /
    combinations(KENO_POOL, picks)
  );
}

/**
 * Builds the prize ladder for `picks` numbers: geometric weights over the catch
 * levels, scaled to the target RTP, floored to 2 decimals.
 */
function buildPayTable(picks: number): KenoPayTable {
  const probabilities = Array.from({ length: picks + 1 }, (_, hits) =>
    kenoProbability(picks, hits),
  );

  const ladder = (threshold: number): number[] => {
    const weight = (hits: number): number => KENO_WEIGHT_RATIO ** (hits - threshold);

    let weightedProbability = 0;
    for (let hits = threshold; hits <= picks; hits += 1) {
      weightedProbability += probabilities[hits]! * weight(hits);
    }

    const scale = KENO_TARGET_RTP / weightedProbability;

    return Array.from({ length: picks + 1 }, (_, hits) =>
      hits < threshold ? 0 : floor2(scale * weight(hits)),
    );
  };

  // Most generous threshold whose lowest prize still returns at least the stake.
  for (let threshold = 1; threshold <= picks; threshold += 1) {
    const multipliers = ladder(threshold);

    if (threshold === picks || multipliers[threshold]! >= KENO_MIN_LOWEST) {
      return {
        picks,
        multipliers,
        minHits: threshold,
        rtp: multipliers.reduce(
          (sum, multiplier, hits) => sum + probabilities[hits]! * multiplier,
          0,
        ),
      };
    }
  }

  throw new Error(`unreachable: no keno ladder for ${picks} picks`);
}

/** Ladders are pure maths — build each one once. */
const payTables = new Map<number, KenoPayTable>();

/** Prize ladder for a pick count (memoised). */
export function kenoPayTable(picks: number): KenoPayTable {
  const cached = payTables.get(picks);
  if (cached) return cached;

  const table = buildPayTable(picks);
  payTables.set(picks, table);

  return table;
}

/** Every ladder, for the client's pay-table panel. */
export function kenoPayTables(): KenoPayTable[] {
  return Array.from({ length: KENO_MAX_PICKS }, (_, index) => kenoPayTable(index + 1));
}

/** Theoretical RTP of one ladder (server-side only). */
export function kenoRtp(picks: number): number {
  return kenoPayTable(picks).rtp;
}

/** Board size, pick limits, and the real pay tables — no other odds exposed. */
export function kenoConfig(): {
  pool: number;
  drawn: number;
  minPicks: number;
  maxPicks: number;
  payTables: KenoPayTable[];
} {
  return {
    pool: KENO_POOL,
    drawn: KENO_DRAWN,
    minPicks: KENO_MIN_PICKS,
    maxPicks: KENO_MAX_PICKS,
    payTables: kenoPayTables(),
  };
}

/** Multiplier owed for `hits` catches when `picks` numbers were picked. */
export function kenoMultiplier(picks: number, hits: number): number {
  return kenoPayTable(picks).multipliers[hits] ?? 0;
}

/** Fixed per-round nonce base for the MVP (one digest per drawn number). */
const NONCE_BASE = 1;

/**
 * Draw 20 unique numbers from the 1–80 board.
 *
 * Partial Fisher–Yates: `index` walks the first 20 slots, the digest picks a
 * partner from the untouched tail (`index … 79`), and the two are swapped. The
 * span shrinks each step, so no number can repeat, and every ordered 20-subset
 * is equally likely.
 */
export function drawNumbers(serverSeed: string, clientSeed: string): number[] {
  const pool = Array.from({ length: KENO_POOL }, (_, index) => index + 1);

  for (let index = 0; index < KENO_DRAWN; index += 1) {
    const remaining = KENO_POOL - index;
    const fraction = generateProvablyFairFloat(serverSeed, clientSeed, NONCE_BASE + index);
    const partner = index + Math.min(Math.floor(fraction * remaining), remaining - 1);

    [pool[index], pool[partner]] = [pool[partner]!, pool[index]!];
  }

  return pool.slice(0, KENO_DRAWN).sort((a, b) => a - b);
}

/** Play one Keno round. */
export async function playKeno(
  userId: string,
  betAmount: number,
  selectedNumbers: number[],
): Promise<KenoResult> {
  const stake = assertBetAmount(betAmount);
  const picked = assertSelectedNumbers(selectedNumbers);

  // 1. Draw (pure computation, nothing written yet).
  const serverSeed = generateServerSeed();
  const clientSeed = generateClientSeed();
  const serverSeedHash = hashServerSeed(serverSeed);

  const drawn = drawNumbers(serverSeed, clientSeed);
  const drawnSet = new Set(drawn);
  const matches = picked.filter((number) => drawnSet.has(number));
  const hits = matches.length;

  const multiplier = kenoMultiplier(picked.length, hits);
  const payout = roundMoney(stake * multiplier);
  const roundId = crypto.randomUUID();

  // 2. One transaction: debit stake → credit payout → record the round.
  const balanceAfter = await withTransaction(async (client) => {
    await lockUser(client, userId);

    const balance = await getBalance(userId, client);
    if (balance < stake) {
      throw new AppError(
        'INSUFFICIENT_FUNDS',
        400,
        `Insufficient funds: balance is ${balance.toFixed(2)}, bet is ${stake.toFixed(2)}`,
      );
    }

    await createTransaction(client, {
      userId,
      type: 'bet',
      amount: -stake,
      referenceId: roundId,
    });

    if (payout > 0) {
      await createTransaction(client, {
        userId,
        type: 'win',
        amount: payout,
        referenceId: roundId,
      });
    }

    await insertRound(client, {
      roundId,
      userId,
      betAmount: stake,
      picked,
      drawn,
      multiplier,
      payout,
      serverSeedHash,
    });

    return roundMoney(balance - stake + payout);
  });

  return {
    picked,
    drawn,
    matches,
    hits,
    multiplier,
    payout,
    betAmount: stake,
    balanceAfter,
    serverSeedHash,
    roundId,
  };
}

type RoundData = {
  roundId: string;
  userId: string;
  betAmount: number;
  picked: number[];
  drawn: number[];
  multiplier: number;
  payout: number;
  serverSeedHash: string;
};

/**
 * Persists the round audit row (ledger rows are written by the wallet service).
 * `bet_value` keeps the picks, `result` keeps the 20 drawn numbers; both fit
 * their 64-character columns after `011_keno.sql`.
 */
async function insertRound(client: PoolClient, data: RoundData): Promise<void> {
  await client.query(
    `INSERT INTO game_rounds
       (id, user_id, bet_amount, bet_type, bet_value, result, payout, multiplier, server_seed_hash)
     VALUES ($1, $2, $3, 'keno', $4, $5, $6, $7, $8)`,
    [
      data.roundId,
      data.userId,
      moneyString(data.betAmount),
      data.picked.join(','),
      data.drawn.join(','),
      moneyString(data.payout),
      moneyString(data.multiplier),
      data.serverSeedHash,
    ],
  );
}

/** 1–10 unique integers, each 1–80. Returns them ascending. */
function assertSelectedNumbers(selectedNumbers: unknown): number[] {
  if (!Array.isArray(selectedNumbers)) {
    throw new AppError('VALIDATION_ERROR', 400, 'selectedNumbers: Must be an array of numbers');
  }

  if (selectedNumbers.length < KENO_MIN_PICKS || selectedNumbers.length > KENO_MAX_PICKS) {
    throw new AppError(
      'VALIDATION_ERROR',
      400,
      `selectedNumbers: Pick between ${KENO_MIN_PICKS} and ${KENO_MAX_PICKS} numbers (got ${selectedNumbers.length})`,
    );
  }

  const picked = selectedNumbers.map((entry) => {
    const value = typeof entry === 'string' ? Number(entry) : entry;

    if (
      typeof value !== 'number' ||
      !Number.isInteger(value) ||
      value < 1 ||
      value > KENO_POOL
    ) {
      throw new AppError(
        'VALIDATION_ERROR',
        400,
        `selectedNumbers: Every number must be an integer between 1 and ${KENO_POOL}`,
      );
    }

    return value;
  });

  if (new Set(picked).size !== picked.length) {
    throw new AppError('VALIDATION_ERROR', 400, 'selectedNumbers: Numbers must be unique');
  }

  return [...picked].sort((a, b) => a - b);
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

/** Two-decimal floor — rounding can only ever move the edge towards the house. */
function floor2(amount: number): number {
  return Math.floor(amount * 100) / 100;
}

function moneyString(amount: number): string {
  return roundMoney(amount).toFixed(2);
}
