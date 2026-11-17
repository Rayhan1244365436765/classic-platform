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
 * Classic European roulette — a single-zero wheel with 37 pockets (0–36).
 *
 * Colours: **0 is green**, the 18 red numbers are
 * `1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36`, and everything else
 * (2,4,6,8,10,11,13,15,17,20,22,24,26,28,29,31,33,35) is black.
 *
 * Payouts: a straight number returns **36×** (35:1 plus the stake), every
 * even-money bet returns **2×** (1:1 plus the stake).
 *
 * --- house edge ------------------------------------------------------------
 * The single zero is the *only* edge — no la partage, no en prison — so every
 * bet on the board is priced identically:
 *
 *   straight number   (1/37)  × 36 = 36/37 = 97.30%
 *   red / black       (18/37) × 2  = 36/37 = 97.30%
 *   even / odd        (18/37) × 2  = 36/37 = 97.30%
 *   low / high        (18/37) × 2  = 36/37 = 97.30%
 *
 * House edge = 1/37 = **2.70%**, the lowest on the platform, and the same on
 * every bet type (`rouletteRtp()` computes it rather than hard-coding it).
 *
 * The pocket comes from one provably-fair digest mapped onto `[0, 37)`.
 */

/** Pockets on the wheel: 0 plus 1–36. */
export const POCKETS = 37;

/** The 18 red numbers; 0 is green and the rest are black. */
export const RED_NUMBERS: readonly number[] = [
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
];

/**
 * Physical pocket order (clockwise) as printed on a European wheel — the
 * clients draw the wheel from this so the animation matches the real thing.
 */
export const WHEEL_ORDER: readonly number[] = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5,
  24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];

export type RouletteBetType = 'number' | 'red' | 'black' | 'even' | 'odd' | 'low' | 'high';
export type PocketColor = 'green' | 'red' | 'black';

/** Total return per unit staked, by bet type. */
export const PAYOUTS: Record<RouletteBetType, number> = {
  number: 36,
  red: 2,
  black: 2,
  even: 2,
  odd: 2,
  low: 2,
  high: 2,
};

/** Every bet type the table accepts, in board order. */
export const BET_TYPES: readonly RouletteBetType[] = [
  'number',
  'red',
  'black',
  'even',
  'odd',
  'low',
  'high',
];

export type ClassicRouletteResult = {
  /** The pocket that came up, 0–36. */
  pocket: number;
  pocketColor: PocketColor;
  betType: RouletteBetType;
  /** The chosen number for a straight bet, otherwise `null`. */
  betValue: number | null;
  won: boolean;
  /** 36 (number), 2 (even-money) or 0. */
  multiplier: number;
  payout: number;
  betAmount: number;
  balanceAfter: number;
  /** Index of the pocket in `WHEEL_ORDER`, for the ball animation. */
  wheelIndex: number;
  serverSeedHash: string;
  roundId: string;
};

/** Colour of a pocket: 0 green, the listed numbers red, the rest black. */
export function pocketColor(pocket: number): PocketColor {
  if (pocket === 0) return 'green';

  return RED_NUMBERS.includes(pocket) ? 'red' : 'black';
}

/** Number of pockets that win this bet. */
function winningPockets(betType: RouletteBetType): number {
  return betType === 'number' ? 1 : 18;
}

/** Does `pocket` win the bet? `betValue` is only used for straight numbers. */
export function betWins(
  betType: RouletteBetType,
  betValue: number | null,
  pocket: number,
): boolean {
  switch (betType) {
    case 'number':
      return betValue === pocket;
    case 'red':
      return pocketColor(pocket) === 'red';
    case 'black':
      return pocketColor(pocket) === 'black';
    case 'even':
      // 0 is neither even nor odd on the layout.
      return pocket !== 0 && pocket % 2 === 0;
    case 'odd':
      return pocket !== 0 && pocket % 2 === 1;
    case 'low':
      return pocket >= 1 && pocket <= 18;
    case 'high':
      return pocket >= 19 && pocket <= 36;
    default:
      return false;
  }
}

/** Theoretical RTP of a bet type — 36/37 for all of them. */
export function rouletteRtp(betType: RouletteBetType): number {
  return (winningPockets(betType) / POCKETS) * PAYOUTS[betType];
}

/** Table layout, payouts and odds — everything the client renders. */
export function classicRouletteConfig(): {
  pockets: number;
  redNumbers: readonly number[];
  wheelOrder: readonly number[];
  payouts: Record<RouletteBetType, number>;
  betTypes: readonly RouletteBetType[];
  rtp: Record<RouletteBetType, number>;
  houseEdge: number;
} {
  const rtp = Object.fromEntries(
    BET_TYPES.map((betType) => [betType, rouletteRtp(betType)]),
  ) as Record<RouletteBetType, number>;

  return {
    pockets: POCKETS,
    redNumbers: RED_NUMBERS,
    wheelOrder: WHEEL_ORDER,
    payouts: PAYOUTS,
    betTypes: BET_TYPES,
    rtp,
    houseEdge: 1 - rtp.red,
  };
}

/** Fixed per-round nonce for the MVP (same convention as the other games). */
const NONCE = 1;

/** Spin once and settle against the chosen bet. */
export async function playRoulette(
  userId: string,
  betAmount: number,
  betType: string,
  betValue: unknown,
): Promise<ClassicRouletteResult> {
  const stake = assertBetAmount(betAmount);
  const type = assertBetType(betType);
  const value = type === 'number' ? assertPocket(betValue) : null;

  // 1. Draw the pocket (pure computation, nothing written yet).
  const serverSeed = generateServerSeed();
  const clientSeed = generateClientSeed();
  const serverSeedHash = hashServerSeed(serverSeed);

  const pocket = generateProvablyFairIndex(serverSeed, clientSeed, NONCE, POCKETS);
  const color = pocketColor(pocket);
  const won = betWins(type, value, pocket);
  const multiplier = won ? PAYOUTS[type] : 0;
  const payout = roundMoney(stake * multiplier);
  const roundId = crypto.randomUUID();
  const wheelIndex = WHEEL_ORDER.indexOf(pocket);

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
      betType: type,
      betValue: value,
      pocket,
      color,
      multiplier,
      payout,
      serverSeedHash,
    });

    return roundMoney(balance - stake + payout);
  });

  return {
    pocket,
    pocketColor: color,
    betType: type,
    betValue: value,
    won,
    multiplier,
    payout,
    betAmount: stake,
    balanceAfter,
    wheelIndex,
    serverSeedHash,
    roundId,
  };
}

type RoundData = {
  roundId: string;
  userId: string;
  betAmount: number;
  betType: RouletteBetType;
  betValue: number | null;
  pocket: number;
  color: PocketColor;
  multiplier: number;
  payout: number;
  serverSeedHash: string;
};

/**
 * Persists the round audit row (ledger rows are written by the wallet service).
 * `bet_value` keeps what was backed (`number:17`, `red`, …) and `result` the
 * pocket that came up with its colour (`17|black`).
 */
async function insertRound(client: PoolClient, data: RoundData): Promise<void> {
  await client.query(
    `INSERT INTO game_rounds
       (id, user_id, bet_amount, bet_type, bet_value, result, payout, multiplier, server_seed_hash)
     VALUES ($1, $2, $3, 'classic_roulette', $4, $5, $6, $7, $8)`,
    [
      data.roundId,
      data.userId,
      moneyString(data.betAmount),
      data.betType === 'number' ? `number:${data.betValue}` : data.betType,
      `${data.pocket}|${data.color}`,
      moneyString(data.payout),
      moneyString(data.multiplier),
      data.serverSeedHash,
    ],
  );
}

function assertBetType(betType: string): RouletteBetType {
  if (!BET_TYPES.includes(betType as RouletteBetType)) {
    throw new AppError(
      'VALIDATION_ERROR',
      400,
      `betType: Must be one of ${BET_TYPES.join(', ')}`,
    );
  }

  return betType as RouletteBetType;
}

/** Straight bets need a whole pocket number, 0–36. */
function assertPocket(betValue: unknown): number {
  const value = typeof betValue === 'string' ? Number(betValue) : betValue;

  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value >= POCKETS) {
    throw new AppError(
      'VALIDATION_ERROR',
      400,
      `betValue: A number bet needs a whole pocket between 0 and ${POCKETS - 1}`,
    );
  }

  return value;
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
