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
 * 3D Dice — three dice, one bet on the total.
 *
 * The player backs **high** (11–18), **low** (3–10) or an exact **total** (3–18).
 * Three dice have 6³ = 216 equally likely outcomes, and the totals are not flat:
 *
 *   total  3   4   5   6   7   8   9  10  11  12  13  14  15  16  17  18
 *   combos 1   3   6  10  15  21  25  27  27  25  21  15  10   6   3   1
 *
 * --- the rule that makes high/low fair --------------------------------------
 * The two halves hold 108 combos each — exactly 50% — so paying 2× would be a
 * **100% RTP** free bet. Sic Bo's answer is used here: **a triple loses high and
 * low** (a triple is never "big" or "small"). Each half then wins on 105 of 216
 * rolls:
 *
 *   high/low RTP = 2 × 105/216 = 210/216 = 35/36 = 97.22%
 *
 * The rule only touches high/low: a triple that matches a total bet (e.g. 333 on
 * "9") still pays that total normally.
 *
 * --- totals are priced individually ----------------------------------------
 * A flat multiplier on every total cannot work: 12× would return 150% on 10/11
 * (27 combos) and 5.6% on 3/18 (1 combo). Each total pays 210/combos instead, so
 * every square returns 210/216 = 97.22% — except 10/11, which take the nearest
 * round number (7.8× → 97.5%):
 *
 *   total      3/18   4/17   5/16   6/15   7/14   8/13   9/12   10/11
 *   pays       210×    70×    35×    21×    14×    10×    8.4×    7.8×
 *   RTP       97.22%  97.22% 97.22% 97.22% 97.22% 97.22% 97.22%  97.50%
 *
 * Best case: 210× the stake on a triple-fixed total of 3 or 18 (1 in 216).
 */

export const DICE_COUNT = 3;
export const DIE_FACES = 6;
/** 6³ — every roll is one of these. */
export const ROLL_OUTCOMES = DIE_FACES ** DICE_COUNT;

/** Sums where the three dice match, i.e. where a triple can land. */
export const TRIPLE_SUMS: readonly number[] = [3, 6, 9, 12, 15, 18];

export type Dice3dBetKind = 'high' | 'low' | 'sum';
export type Dice3dBet = { kind: 'high' | 'low' } | { kind: 'sum'; sum: number };

/** Both halves of the board pay double. */
export const HIGH_LOW_PAY = 2;

/** Payout per total, as a multiple of the stake. */
export const SUM_PAYS: Readonly<Record<number, number>> = {
  3: 210,
  4: 70,
  5: 35,
  6: 21,
  7: 14,
  8: 10,
  9: 8.4,
  10: 7.8,
  11: 7.8,
  12: 8.4,
  13: 10,
  14: 14,
  15: 21,
  16: 35,
  17: 70,
  18: 210,
};

/**
 * Admin-configurable 3D Dice settings (`dice3d` row): `highLowPay` (default 2) and
 * `sumPays` (a pay for each total 3–18; defaults to `SUM_PAYS`).
 */
export type Dice3dGameConfig = {
  highLowPay: number;
  sumPays: Record<string, number>;
};

export function highLowPay(): number {
  return getGameConfig<Dice3dGameConfig>('dice3d')?.highLowPay ?? HIGH_LOW_PAY;
}

/** Pay for an exact total (config value, else the shipped table). */
export function sumPay(sum: number): number {
  return getGameConfig<Dice3dGameConfig>('dice3d')?.sumPays?.[String(sum)] ?? SUM_PAYS[sum]!;
}

/** How many of the 216 rolls produce each total. */
export const SUM_COMBOS: Readonly<Record<number, number>> = {
  3: 1,
  4: 3,
  5: 6,
  6: 10,
  7: 15,
  8: 21,
  9: 25,
  10: 27,
  11: 27,
  12: 25,
  13: 21,
  14: 15,
  15: 10,
  16: 6,
  17: 3,
  18: 1,
};

export type Dice3dResult = {
  /** The three dice, 1–6 each. */
  dice: number[];
  /** Their total, 3–18. */
  sum: number;
  triple: boolean;
  /** The bet as the server normalised it: `'high'`, `'low'` or the total. */
  betType: string;
  /** The total that was backed, or `null` for high/low. */
  betSum: number | null;
  won: boolean;
  multiplier: number;
  payout: number;
  betAmount: number;
  balanceAfter: number;
  /** A triple wiped out a high/low bet that would otherwise have won. */
  tripleVoided: boolean;
  serverSeedHash: string;
  roundId: string;
};

/** Theoretical RTP of a bet, from the outcome table above. */
export function dice3dRtp(bet: Dice3dBet): number {
  if (bet.kind === 'sum') {
    return (SUM_COMBOS[bet.sum]! * sumPay(bet.sum)) / ROLL_OUTCOMES;
  }

  // 108 combos per half, minus the three triples that fall inside it.
  return ((108 - 3) * highLowPay()) / ROLL_OUTCOMES;
}

/** Table, paytable and exact odds — everything the client renders. */
export function dice3dConfig(): {
  dice: number;
  faces: number;
  outcomes: number;
  triplesLoseHighLow: boolean;
  high: { from: number; to: number; pay: number; chance: number; rtp: number };
  low: { from: number; to: number; pay: number; chance: number; rtp: number };
  sums: Array<{ sum: number; combos: number; pay: number; chance: number; rtp: number }>;
} {
  const highChance = (108 - 3) / ROLL_OUTCOMES;
  const hlPay = highLowPay();

  return {
    dice: DICE_COUNT,
    faces: DIE_FACES,
    outcomes: ROLL_OUTCOMES,
    triplesLoseHighLow: true,
    high: { from: 11, to: 18, pay: hlPay, chance: highChance, rtp: highChance * hlPay },
    low: { from: 3, to: 10, pay: hlPay, chance: highChance, rtp: highChance * hlPay },
    sums: Object.keys(SUM_COMBOS).map((key) => {
      const sum = Number(key);
      const combos = SUM_COMBOS[sum]!;
      const pay = sumPay(sum);

      return { sum, combos, pay, chance: combos / ROLL_OUTCOMES, rtp: (combos * pay) / ROLL_OUTCOMES };
    }),
  };
}

/** Score a settled roll against the bet. */
export function evaluateDice3d(
  dice: readonly number[],
  bet: Dice3dBet,
): { sum: number; triple: boolean; won: boolean; multiplier: number; tripleVoided: boolean } {
  const sum = dice.reduce((total, die) => total + die, 0);
  const triple = dice.every((die) => die === dice[0]);

  if (bet.kind === 'sum') {
    const won = sum === bet.sum;

    return { sum, triple, won, multiplier: won ? sumPay(bet.sum) : 0, tripleVoided: false };
  }

  const inRange = bet.kind === 'high' ? sum >= 11 : sum <= 10;

  // A triple is neither big nor small: the bet loses even if the total was in range.
  if (triple) {
    return { sum, triple, won: false, multiplier: 0, tripleVoided: inRange };
  }

  return {
    sum,
    triple,
    won: inRange,
    multiplier: inRange ? highLowPay() : 0,
    tripleVoided: false,
  };
}

/** Fixed per-round nonce base; die `i` is drawn with `NONCE + i`. */
const NONCE = 1;

/** Roll three dice and settle the bet. */
export async function playDice3d(
  userId: string,
  betAmount: number,
  betType: unknown,
): Promise<Dice3dResult> {
  const stake = assertBetAmount(betAmount);
  const bet = parseBet(betType);

  // 1. Roll (pure computation, nothing written yet).
  const serverSeed = generateServerSeed();
  const clientSeed = generateClientSeed();
  const serverSeedHash = hashServerSeed(serverSeed);

  const dice = rollDice(serverSeed, clientSeed);
  const { sum, triple, won, multiplier, tripleVoided } = evaluateDice3d(dice, bet);
  const payout = roundMoney(stake * multiplier);
  const roundId = crypto.randomUUID();
  const label = bet.kind === 'sum' ? String(bet.sum) : bet.kind;

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
      label,
      dice,
      sum,
      multiplier,
      payout,
      serverSeedHash,
    });

    return roundMoney(balance - stake + payout);
  });

  return {
    dice,
    sum,
    triple,
    betType: label,
    betSum: bet.kind === 'sum' ? bet.sum : null,
    won,
    multiplier,
    payout,
    betAmount: stake,
    balanceAfter,
    tripleVoided,
    serverSeedHash,
    roundId,
  };
}

/** Three independent 1-in-6 draws, one nonce per die. */
function rollDice(serverSeed: string, clientSeed: string): number[] {
  return Array.from({ length: DICE_COUNT }, (_, die) => {
    const index = generateProvablyFairIndex(serverSeed, clientSeed, NONCE + die, DIE_FACES);

    return index + 1;
  });
}

/**
 * Accepts `'high'`, `'low'`, a total as a number (`15`), or a total as a string
 * (`'15'`) — anything else is a 400.
 */
export function parseBet(raw: unknown): Dice3dBet {
  if (typeof raw === 'string') {
    const value = raw.trim().toLowerCase();

    if (value === 'high' || value === 'low') {
      return { kind: value };
    }

    if (value !== '' && Number.isInteger(Number(value))) {
      return parseSum(Number(value));
    }
  }

  if (typeof raw === 'number' && Number.isInteger(raw)) {
    return parseSum(raw);
  }

  throw new AppError(
    'VALIDATION_ERROR',
    400,
    "betType: Must be 'high', 'low', or a whole total between 3 and 18",
  );
}

function parseSum(sum: number): Dice3dBet {
  if (sum < 3 || sum > 18) {
    throw new AppError('VALIDATION_ERROR', 400, 'betType: A total bet must be between 3 and 18');
  }

  return { kind: 'sum', sum };
}

type RoundData = {
  roundId: string;
  userId: string;
  betAmount: number;
  label: string;
  dice: readonly number[];
  sum: number;
  multiplier: number;
  payout: number;
  serverSeedHash: string;
};

/**
 * Persists the round audit row (ledger rows are written by the wallet service).
 * `bet_value` keeps the call (`'high'`, `'low'`, `'15'`) and `result` the dice
 * plus their total (`'4,2,3|9'`).
 */
async function insertRound(client: PoolClient, data: RoundData): Promise<void> {
  await client.query(
    `INSERT INTO game_rounds
       (id, user_id, bet_amount, bet_type, bet_value, result, payout, multiplier, server_seed_hash)
     VALUES ($1, $2, $3, 'dice3d', $4, $5, $6, $7, $8)`,
    [
      data.roundId,
      data.userId,
      moneyString(data.betAmount),
      data.label,
      `${data.dice.join(',')}|${data.sum}`,
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
