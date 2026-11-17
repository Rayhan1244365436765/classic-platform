import crypto from 'node:crypto';

import type { PoolClient } from 'pg';

import {
  generateClientSeed,
  generateProvablyFairIndex,
  generateServerSeed,
  hashServerSeed,
} from '../../../common/provably-fair/index.js';
import { AppError } from '../../../common/utils/AppError.js';
import { withTransaction } from '../../../config/db.js';
import { createTransaction, getBalance, lockUser } from '../../wallet/wallet.service.js';

/**
 * Plinko — an 8-row board: the ball takes 8 left/right steps and lands in one
 * of 9 slots. Each step is an independent 50/50, so the landing slot follows
 * Binomial(8, ½): P(slot k) = C(8,k) / 256.
 *
 * Pay table (centre → edges), tuned for a **3% house edge**:
 *
 *   multipliers = [5.49, 2.05, 1.08, 0.98, 0.49, 0.98, 1.08, 2.05, 5.49]
 *
 *   Σ C(8,k)·m_k = 5.49 + 8·2.05 + 28·1.08 + 56·0.98 + 70·0.49 + …
 *                = 248.32
 *   RTP = 248.32 / 256 = 0.9700   → exactly 97.00%
 *
 * (The common 99% table `[5.6, 2.1, 1.1, 1, 0.5, …]` only reaches 98.91%.)
 *
 * The path comes from one digest: an index over all 2⁸ = 256 routes, whose bits
 * are the left/right steps — every route is equally likely, so the slot
 * distribution is exactly binomial and the slot is just the number of “right”s.
 */

export const PLINKO_ROWS = 8;
export const PLINKO_SLOTS = PLINKO_ROWS + 1;

export const PLINKO_MULTIPLIERS: readonly number[] = [
  5.49, 2.05, 1.08, 0.98, 0.49, 0.98, 1.08, 2.05, 5.49,
];

/** Binomial route count for slot `index` (C(rows, index)). */
function routesTo(index: number): number {
  let value = 1;
  for (let step = 0; step < index; step += 1) {
    value = (value * (PLINKO_ROWS - step)) / (step + 1);
  }
  return value;
}

/** Theoretical return-to-player of the table (server-side only). */
export function plinkoRtp(): number {
  const weighted = PLINKO_MULTIPLIERS.reduce(
    (sum, multiplier, index) => sum + multiplier * routesTo(index),
    0,
  );

  return weighted / 2 ** PLINKO_ROWS;
}

/** Board layout + odds, exposed so the client draws the real table. */
export function plinkoConfig(): {
  rows: number;
  slots: number;
  multipliers: readonly number[];
  rtp: number;
} {
  return {
    rows: PLINKO_ROWS,
    slots: PLINKO_SLOTS,
    multipliers: PLINKO_MULTIPLIERS,
    rtp: plinkoRtp(),
  };
}

export type PlinkoStep = 'L' | 'R';

export type PlinkoResult = {
  rows: number;
  /** One entry per row: the route the ball took. */
  path: PlinkoStep[];
  /** Landing slot, 0 (far left) … 8 (far right). */
  slot: number;
  multiplier: number;
  payout: number;
  betAmount: number;
  balanceAfter: number;
  serverSeedHash: string;
  roundId: string;
};

/** Fixed per-round nonce for the MVP (same convention as the other games). */
const NONCE = 1;

/** Drop one ball. */
export async function playPlinko(
  userId: string,
  betAmount: number,
  rows: number = PLINKO_ROWS,
): Promise<PlinkoResult> {
  const stake = assertBetAmount(betAmount);
  assertRows(rows);

  // 1. Draw the route (pure computation, nothing written yet).
  const serverSeed = generateServerSeed();
  const clientSeed = generateClientSeed();
  const serverSeedHash = hashServerSeed(serverSeed);

  // One digest → index over all 2⁸ routes; the bits are the L/R steps.
  const roll = generateProvablyFairIndex(serverSeed, clientSeed, NONCE, 2 ** rows);
  const path: PlinkoStep[] = Array.from({ length: rows }, (_, step) =>
    ((roll >> (rows - 1 - step)) & 1) === 1 ? 'R' : 'L',
  );
  const slot = path.reduce((count, step) => (step === 'R' ? count + 1 : count), 0);
  const multiplier = PLINKO_MULTIPLIERS[slot]!;
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

    // Every slot pays something (the centre is 0.49×), so this always credits.
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
      rows,
      path,
      multiplier,
      payout,
      serverSeedHash,
    });

    return roundMoney(balance - stake + payout);
  });

  return {
    rows,
    path,
    slot,
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
  rows: number;
  path: PlinkoStep[];
  multiplier: number;
  payout: number;
  serverSeedHash: string;
};

/** Persists the round audit row (ledger rows are written by the wallet service). */
async function insertRound(client: PoolClient, data: RoundData): Promise<void> {
  await client.query(
    `INSERT INTO game_rounds
       (id, user_id, bet_amount, bet_type, bet_value, result, payout, multiplier, server_seed_hash)
     VALUES ($1, $2, $3, 'plinko', $4, $5, $6, $7, $8)`,
    [
      data.roundId,
      data.userId,
      moneyString(data.betAmount),
      String(data.rows),
      data.path.join(''),
      moneyString(data.payout),
      moneyString(data.multiplier),
      data.serverSeedHash,
    ],
  );
}

function assertRows(rows: number): void {
  if (rows !== PLINKO_ROWS) {
    throw new AppError(
      'INVALID_ROWS',
      400,
      `Only the ${PLINKO_ROWS}-row board is available right now`,
    );
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

function moneyString(amount: number): string {
  return roundMoney(amount).toFixed(2);
}

