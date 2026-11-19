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
 * "Spin to Win" lucky wheel.
 *
 * 20 segments; the multiplier is the only bet decision, so the house edge is a
 * property of this table, not of the player's choice:
 *
 *   RTP = Σ(segment multipliers) / segment count = 18 / 20 = 0.90
 *   House edge = 10%
 *
 * Payout rules:
 *   * 0x   → the whole stake is lost.
 *   * > 0x → the player is credited `stake × multiplier` (0.5x returns half the
 *            stake, 1x returns the stake, 10x pays ten times the stake).
 *
 * Every spin is atomic: debit the stake, credit the payout, write the round row.
 */

/** Keep this in sync with the wheel drawn by the clients. */
export const WHEEL_SEGMENTS: readonly number[] = [
  10, 3, 2, 1, 0.5, 0.5, 0.5, 0.5, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
];

export const SEGMENT_COUNT = WHEEL_SEGMENTS.length;

export type SegmentColor = 'gold' | 'green' | 'blue' | 'gray';

export type SpinResult = {
  /** Index of the segment the wheel stopped on (0-based). */
  segmentIndex: number;
  multiplier: number;
  segmentColor: SegmentColor;
  won: boolean;
  /** Multiplier × stake, already rounded to 2 decimals. */
  payout: number;
  betAmount: number;
  balanceAfter: number;
  serverSeedHash: string;
  roundId: string;
  /**
   * Legacy aliases kept so older clients keep rendering:
   * `resultNumber` is the segment index, `resultColor` the colour key.
   */
  resultNumber: number;
  resultColor: string;
};

/** Colour language used by both web and mobile clients. */
export function segmentColor(multiplier: number): SegmentColor {
  if (multiplier >= 10) {
    return 'gold';
  }
  if (multiplier >= 2) {
    return 'green';
  }
  if (multiplier > 0) {
    return 'blue';
  }
  return 'gray';
}

/** Theoretical return-to-player for this wheel (0.90 = 90%). */
export function wheelRtp(): number {
  const total = WHEEL_SEGMENTS.reduce((sum, value) => sum + value, 0);
  return total / SEGMENT_COUNT;
}

/** Wheel layout + odds, exposed so clients never hard-code a different table. */
export function wheelConfig(): {
  segments: readonly number[];
  segmentCount: number;
  rtp: number;
  payouts: Array<{ multiplier: number; color: SegmentColor; chance: number }>;
} {
  const counts = new Map<number, number>();
  for (const segment of WHEEL_SEGMENTS) {
    counts.set(segment, (counts.get(segment) ?? 0) + 1);
  }

  const payouts = [...counts.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([multiplier, count]) => ({
      multiplier,
      color: segmentColor(multiplier),
      chance: count / SEGMENT_COUNT,
    }));

  return {
    segments: WHEEL_SEGMENTS,
    segmentCount: SEGMENT_COUNT,
    rtp: wheelRtp(),
    payouts,
  };
}

/** Fixed per-round nonce for the MVP; becomes per-client once seed history exists. */
const NONCE = 1;
/** Spin the wheel once. */
export async function playSpin(userId: string, betAmount: number): Promise<SpinResult> {
  const stake = assertBetAmount(betAmount);

  // 1. Commit + spin (pure computation, no DB writes yet).
  const serverSeed = generateServerSeed();
  const clientSeed = generateClientSeed();
  const serverSeedHash = hashServerSeed(serverSeed);
  const segmentIndex = generateProvablyFairIndex(
    serverSeed,
    clientSeed,
    NONCE,
    SEGMENT_COUNT,
  );
  const multiplier = WHEEL_SEGMENTS[segmentIndex] ?? 0;
  const payout = roundMoney(stake * multiplier);
  const won = multiplier > 0;
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
      multiplier,
      payout,
      serverSeedHash,
    });

    return roundMoney(balance - stake + payout);
  });

  const color = segmentColor(multiplier);

  return {
    segmentIndex,
    multiplier,
    segmentColor: color,
    won,
    payout,
    betAmount: stake,
    balanceAfter,
    serverSeedHash,
    roundId,
    resultNumber: segmentIndex,
    resultColor: color,
  };
}

type RoundData = {
  roundId: string;
  userId: string;
  betAmount: number;
  multiplier: number;
  payout: number;
  serverSeedHash: string;
};

/** Persists the round audit row (ledger rows are written by the wallet service). */
async function insertRound(client: PoolClient, data: RoundData): Promise<void> {
  await client.query(
    `INSERT INTO game_rounds
       (id, user_id, bet_amount, bet_type, bet_value, result, payout, multiplier, server_seed_hash)
     VALUES ($1, $2, $3, 'spin', NULL, $4, $5, $6, $7)`,
    [
      data.roundId,
      data.userId,
      moneyString(data.betAmount),
      String(data.multiplier),
      moneyString(data.payout),
      moneyString(data.multiplier),
      data.serverSeedHash,
    ],
  );
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

