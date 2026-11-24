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
import { getGameConfig } from '../../config/config.store.js';
import { createTransaction, getBalance, lockUser } from '../../wallet/wallet.service.js';

/**
 * Dice (High/Low) — one roll of 1–100, the player calls the side.
 *
 *   HIGH wins when roll > 50   (51–100 → 50 numbers)
 *   LOW  wins when roll < 50   (1–49   → 49 numbers)
 *   50 loses for both sides (the house number)
 *
 * A win pays DICE_PAYTABLE.multiplier (1.95×) of the stake; a loss pays 0.
 *
 * --- house edge ------------------------------------------------------------
 * The multiplier is the same for both sides, but the win ranges are not:
 *
 *   HIGH: 50/100 × 1.95 = 97.50% RTP → 2.50% edge
 *   LOW : 49/100 × 1.95 = 95.55% RTP → 4.45% edge
 *
 * That asymmetry comes from 50 being a loss for both sides. `diceRtp()` reports
 * both numbers; if you want LOW to match HIGH, pay it 1.99× (0.49 × 1.99 =
 * 97.51%) or make 50 a push.
 */

export type DicePrediction = 'high' | 'low';

/** Inclusive range of the roll. */
export const DICE_FACES = 100;

/** The losing middle number. */
export const DICE_HOUSE_NUMBER = 50;

export const DICE_PAYTABLE = {
  multiplier: 1.95,
} as const;

/** Win multiplier: admin-configurable (`dice` row), falling back to the built-in table. */
function diceMultiplier(): number {
  return getGameConfig<{ multiplier: number }>('dice')?.multiplier ?? DICE_PAYTABLE.multiplier;
}

export type DiceResult = {
  /** The rolled number, 1–100. */
  roll: number;
  prediction: DicePrediction;
  won: boolean;
  multiplier: number;
  payout: number;
  betAmount: number;
  balanceAfter: number;
  serverSeedHash: string;
  roundId: string;
};

/** Table config for clients: multipliers + the winning ranges. */
export function diceConfig(): {
  faces: number;
  min: number;
  max: number;
  multiplier: number;
  houseNumber: number;
  high: { min: number; max: number };
  low: { min: number; max: number };
} {
  return {
    faces: DICE_FACES,
    min: 1,
    max: DICE_FACES,
    multiplier: diceMultiplier(),
    houseNumber: DICE_HOUSE_NUMBER,
    high: { min: DICE_HOUSE_NUMBER + 1, max: DICE_FACES },
    low: { min: 1, max: DICE_HOUSE_NUMBER - 1 },
  };
}

/**
 * Theoretical return-to-player for one side. Server-side only — never part of a
 * player-facing response.
 */
export function diceRtp(prediction: DicePrediction, multiplier: number = diceMultiplier()): number {
  const winningNumbers =
    prediction === 'high' ? DICE_FACES - DICE_HOUSE_NUMBER : DICE_HOUSE_NUMBER - 1;

  return (winningNumbers / DICE_FACES) * multiplier;
}

/** Win condition + multiplier for a roll. */
export function evaluateRoll(
  roll: number,
  prediction: DicePrediction,
): { won: boolean; multiplier: number } {
  const won =
    prediction === 'high' ? roll > DICE_HOUSE_NUMBER : roll < DICE_HOUSE_NUMBER;

  return { won, multiplier: won ? diceMultiplier() : 0 };
}

/** Spin the dice once. */
export async function playDice(
  userId: string,
  betAmount: number,
  prediction: DicePrediction,
): Promise<DiceResult> {
  const stake = assertBetAmount(betAmount);
  const side = assertPrediction(prediction);

  // 1. Roll (pure computation, nothing written yet).
  const serverSeed = generateServerSeed();
  const clientSeed = generateClientSeed();
  const serverSeedHash = hashServerSeed(serverSeed);

  // Index over the 100 faces → roll = 1…100, uniform.
  const roll = generateProvablyFairIndex(serverSeed, clientSeed, NONCE, DICE_FACES) + 1;

  const { won, multiplier } = evaluateRoll(roll, side);
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
      prediction: side,
      roll,
      multiplier,
      payout,
      serverSeedHash,
    });

    return roundMoney(balance - stake + payout);
  });

  return {
    roll,
    prediction: side,
    won,
    multiplier,
    payout,
    betAmount: stake,
    balanceAfter,
    serverSeedHash,
    roundId,
  };
}

/** Fixed per-round nonce for the MVP (same convention as the other games). */
const NONCE = 1;

type RoundData = {
  roundId: string;
  userId: string;
  betAmount: number;
  prediction: DicePrediction;
  roll: number;
  multiplier: number;
  payout: number;
  serverSeedHash: string;
};

/** Persists the round audit row (ledger rows are written by the wallet service). */
async function insertRound(client: PoolClient, data: RoundData): Promise<void> {
  await client.query(
    `INSERT INTO game_rounds
       (id, user_id, bet_amount, bet_type, bet_value, result, payout, multiplier, server_seed_hash)
     VALUES ($1, $2, $3, 'dice', $4, $5, $6, $7, $8)`,
    [
      data.roundId,
      data.userId,
      moneyString(data.betAmount),
      data.prediction,
      String(data.roll),
      moneyString(data.payout),
      moneyString(data.multiplier),
      data.serverSeedHash,
    ],
  );
}

function assertPrediction(prediction: unknown): DicePrediction {
  if (prediction !== 'high' && prediction !== 'low') {
    throw new AppError(
      'VALIDATION_ERROR',
      400,
      "prediction: Must be 'high' or 'low'",
    );
  }

  return prediction;
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

