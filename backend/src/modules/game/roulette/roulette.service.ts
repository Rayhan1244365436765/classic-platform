import crypto from 'node:crypto';

import type { PoolClient } from 'pg';

import {
  generateClientSeed,
  generateProvablyFairResult,
  generateServerSeed,
  hashServerSeed,
} from '../../../common/provably-fair';
import { AppError } from '../../../common/utils/AppError';
import { withTransaction } from '../../../config/db';
import { createTransaction, getBalance, lockUser } from '../../wallet/wallet.service';

/**
 * Roulette engine (European wheel, 0–36).
 *
 * A round is atomic: the stake debit, the optional payout credit, and the
 * `game_rounds` row are written inside a single DB transaction. If anything
 * fails, the ledger and the round history stay consistent (all rolled back).
 */

export const BET_TYPES = ['red', 'black', 'green', 'number'] as const;
export type BetType = (typeof BET_TYPES)[number];
export type RouletteColor = 'green' | 'red' | 'black';

export type RouletteResult = {
  resultNumber: number;
  resultColor: RouletteColor;
  won: boolean;
  payout: number;
  serverSeedHash: string;
  /** Extras that make the response self-explanatory for clients / admin. */
  roundId: string;
  betAmount: number;
  betType: BetType;
  betValue: string | null;
  balanceAfter: number;
};

/** Stake multipliers: number 36:1, outside colours 2:1, single green pocket 14:1. */
const PAYOUT_MULTIPLIERS: Record<BetType, number> = {
  number: 36,
  red: 2,
  black: 2,
  green: 14,
};

/** Fixed per-round nonce for the MVP; becomes per-client once seed history exists. */
const NONCE = 1;

/**
 * Colour of a pocket.
 *
 * Ranges as specified for this product: 0 green; 1–10 and 19–28 red;
 * 11–18 and 29–36 black. (This is not the classic alternating European layout —
 * change this one function if the wheel mapping is ever revised.)
 */
export function getRouletteColor(resultNumber: number): RouletteColor {
  if (resultNumber === 0) {
    return 'green';
  }

  const isRed = (resultNumber >= 1 && resultNumber <= 10) || (resultNumber >= 19 && resultNumber <= 28);
  return isRed ? 'red' : 'black';
}

/**
 * Play one roulette round.
 *
 * @param userId   owner of the wallet (from the verified JWT)
 * @param betAmount stake, positive number (2 dp)
 * @param betType  red | black | green | number
 * @param betValue pocket for `number` bets ('0'–'36'); ignored otherwise
 */
export async function playRoulette(
  userId: string,
  betAmount: number,
  betType: BetType,
  betValue?: string | number | null,
): Promise<RouletteResult> {
  const stake = assertBetAmount(betAmount);
  const type = assertBetType(betType);
  const value = type === 'number' ? assertNumberBet(betValue) : null;

  // 1. Commit + spin — pure computation, no DB writes yet.
  const serverSeed = generateServerSeed();
  const clientSeed = generateClientSeed();
  const serverSeedHash = hashServerSeed(serverSeed);
  const resultNumber = generateProvablyFairResult(serverSeed, clientSeed, NONCE);
  const resultColor = getRouletteColor(resultNumber);

  // 2. Settle the bet.
  const won = didWin(type, value, resultNumber, resultColor);
  const payout = won ? roundMoney(stake * PAYOUT_MULTIPLIERS[type]) : 0;

  // Ledger rows reference the round, so the id exists before the first insert.
  const roundId = crypto.randomUUID();

  // 3. One transaction: debit stake → credit payout → record the round.
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
      resultNumber,
      payout,
      serverSeedHash,
    });

    return roundMoney(balance - stake + payout);
  });

  return {
    resultNumber,
    resultColor,
    won,
    payout,
    serverSeedHash,
    roundId,
    betAmount: stake,
    betType: type,
    betValue: value,
    balanceAfter,
  };
}
/** Win rule per bet type. `betValue` is only set for `number` bets. */
function didWin(
  betType: BetType,
  betValue: string | null,
  resultNumber: number,
  resultColor: RouletteColor,
): boolean {
  switch (betType) {
    case 'number':
      return betValue === String(resultNumber);
    case 'red':
      return resultColor === 'red';
    case 'black':
      return resultColor === 'black';
    case 'green':
      return resultNumber === 0;
    default:
      return false;
  }
}

type RoundData = {
  roundId: string;
  userId: string;
  betAmount: number;
  betType: BetType;
  betValue: string | null;
  resultNumber: number;
  payout: number;
  serverSeedHash: string;
};

/** Persists the round audit row (the ledger rows are written by the wallet service). */
async function insertRound(client: PoolClient, data: RoundData): Promise<void> {
  await client.query(
    `INSERT INTO game_rounds
       (id, user_id, bet_amount, bet_type, bet_value, result, payout, server_seed_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      data.roundId,
      data.userId,
      moneyString(data.betAmount),
      data.betType,
      data.betValue,
      String(data.resultNumber),
      moneyString(data.payout),
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

function assertBetType(betType: BetType): BetType {
  if (!BET_TYPES.includes(betType)) {
    throw new AppError('INVALID_BET_TYPE', 400, `Bet type must be one of: ${BET_TYPES.join(', ')}`);
  }

  return betType;
}

/** Number bets must target an existing pocket: 0–36. */
function assertNumberBet(betValue: string | number | null | undefined): string {
  if (betValue === null || betValue === undefined || betValue === '') {
    throw new AppError('INVALID_BET_VALUE', 400, 'A number bet requires betValue between 0 and 36');
  }

  const raw = String(betValue).trim();
  if (!/^\d{1,2}$/.test(raw)) {
    throw new AppError('INVALID_BET_VALUE', 400, 'betValue must be an integer between 0 and 36');
  }

  const number = Number(raw);
  if (number < 0 || number > 36) {
    throw new AppError('INVALID_BET_VALUE', 400, 'betValue must be an integer between 0 and 36');
  }

  return String(number);
}

function roundMoney(amount: number): number {
  return Math.round(amount * 100) / 100;
}

function moneyString(amount: number): string {
  return roundMoney(amount).toFixed(2);
}

