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
 * Lucky Slots — 3×3 reels (9 cells) with 3 horizontal paylines.
 *
 * Layout (row-major, all cells independent and uniform 1-in-6):
 *
 *   index:  0 1 2     ← line 0 (top)
 *           3 4 5     ← line 1 (middle)
 *           6 7 8     ← line 2 (bottom)
 *
 * A line pays when its three symbols are identical. The stake covers the whole
 * spin, so every winning line is paid on the full bet:
 *   payout = betAmount × winningLines × SLOT_PAYTABLE.lineMultiplier
 * With three lines the maximum is 3 × 8.4 = 25.2× the stake.
 *
 * --- RTP -------------------------------------------------------------------
 * P(line is 3 alike) = 6 triples / 6³ combos = 1/36 = 2.7778%
 *
 *   RTP = lines × P(line) × lineMultiplier
 *       = 3 × (1/36) × 8.4
 *       = 0.70   → house edge 30.0% exactly
 *
 * (For reference: 6× per line, as originally suggested, yields only
 * 3 × 6/36 = 50% RTP — a 50% house edge, not 30%.)
 * `slotsRtp()` recomputes this from the constants below, so any paytable edit
 * immediately shows its effect.
 */

export const SLOT_SYMBOLS = ['🍒', '🍋', '🍇', '⭐', '💎', '7️⃣'] as const;

export type SlotSymbol = (typeof SLOT_SYMBOLS)[number];

/** Horizontal paylines as cell indices (top, middle, bottom). */
export const SLOT_LINES: readonly (readonly [number, number, number])[] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
];

/** Payout per completed line, as a multiple of the *total* spin stake. */
export const SLOT_PAYTABLE = {
  lineMultiplier: 8.4,
  lines: SLOT_LINES.length,
} as const;

/** 3 rows × 3 columns. */
export const SLOT_CELLS = SLOT_LINES.length * 3;

/** Total grid combinations (6 symbols ^ 9 cells). */
export const SLOT_OUTCOMES = SLOT_SYMBOLS.length ** SLOT_CELLS;

/** Fixed per-round nonce for the MVP (same convention as the wheel). */
const NONCE = 1;

export type SlotsResult = {
  /** Nine symbols, row-major (0–2 top line, 3–5 middle, 6–8 bottom). */
  grid: SlotSymbol[];
  /** Indices of the lines that paid (e.g. `[0, 2]`). */
  winningLines: number[];
  /** Multiplier earned per winning line (8.4). */
  lineMultiplier: number;
  /** winningLines.length × lineMultiplier. */
  multiplier: number;
  won: boolean;
  payout: number;
  betAmount: number;
  balanceAfter: number;
  serverSeedHash: string;
  roundId: string;
};

/** Paytable + symbol set, exposed so clients never hard-code a different one. */
export function slotsConfig(): {
  symbols: readonly SlotSymbol[];
  paytable: typeof SLOT_PAYTABLE;
  lines: readonly (readonly [number, number, number])[];
  cells: number;
  outcomes: number;
} {
  return {
    symbols: SLOT_SYMBOLS,
    paytable: SLOT_PAYTABLE,
    lines: SLOT_LINES,
    cells: SLOT_CELLS,
    outcomes: SLOT_OUTCOMES,
  };
}

/**
 * Theoretical return-to-player of the configured paytable (0.70 = 30% house
 * edge). Server-side only — never part of a player-facing response.
 */
export function slotsRtp(): number {
  const n = SLOT_SYMBOLS.length;
  // n triple combinations out of n³ per line.
  const lineWinChance = n / n ** 3;

  return SLOT_LINES.length * lineWinChance * SLOT_PAYTABLE.lineMultiplier;
}

/** Returns the paying lines and the combined multiplier for a 3×3 grid. */
export function evaluateGrid(grid: readonly SlotSymbol[]): {
  winningLines: number[];
  multiplier: number;
} {
  const winningLines: number[] = [];

  SLOT_LINES.forEach((line, lineIndex) => {
    const first = grid[line[0]];
    if (first !== undefined && first === grid[line[1]] && first === grid[line[2]]) {
      winningLines.push(lineIndex);
    }
  });

  const multiplier = roundMoney(winningLines.length * SLOT_PAYTABLE.lineMultiplier);

  return { winningLines, multiplier };
}

/** Spin the reels once. */
export async function playSlots(userId: string, betAmount: number): Promise<SlotsResult> {
  const stake = assertBetAmount(betAmount);

  // 1. Draw the 3×3 grid (pure computation, nothing written yet).
  const serverSeed = generateServerSeed();
  const clientSeed = generateClientSeed();
  const serverSeedHash = hashServerSeed(serverSeed);

  // One digest → index over all 6⁹ grids → nine base-6 digits, i.e. nine
  // independent reels at exactly 1-in-6 each.
  const roll = generateProvablyFairIndex(serverSeed, clientSeed, NONCE, SLOT_OUTCOMES);
  const perSymbol = SLOT_SYMBOLS.length;
  const grid: SlotSymbol[] = Array.from({ length: SLOT_CELLS }, (_, cell) => {
    const place = perSymbol ** (SLOT_CELLS - 1 - cell);
    return SLOT_SYMBOLS[Math.floor(roll / place) % perSymbol]!;
  });

  const { winningLines, multiplier } = evaluateGrid(grid);
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
      grid,
      multiplier,
      payout,
      serverSeedHash,
    });

    return roundMoney(balance - stake + payout);
  });

  return {
    grid,
    winningLines,
    lineMultiplier: SLOT_PAYTABLE.lineMultiplier,
    multiplier,
    won,
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
  grid: readonly SlotSymbol[];
  multiplier: number;
  payout: number;
  serverSeedHash: string;
};

/** Persists the round audit row (ledger rows are written by the wallet service). */
async function insertRound(client: PoolClient, data: RoundData): Promise<void> {
  await client.query(
    `INSERT INTO game_rounds
       (id, user_id, bet_amount, bet_type, bet_value, result, payout, multiplier, server_seed_hash)
     VALUES ($1, $2, $3, 'slots', NULL, $4, $5, $6, $7)`,
    [
      data.roundId,
      data.userId,
      moneyString(data.betAmount),
      data.grid.join(''),
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


