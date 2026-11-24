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
 * Fortune Gems — a 4×3 cluster-pays slot with Asian luck symbols.
 *
 * Twelve cells, eight symbols, and a win is **any 4+ identical symbols joined
 * horizontally or vertically** (diagonals do not connect). Every cluster that
 * reaches four pays on its own and the pays add up, so one board can hold two
 * separate clusters.
 *
 * Layout (row-major, every cell an independent 1-in-8 draw):
 *
 *   index:  0  1  2  3
 *           4  5  6  7
 *           8  9 10 11
 *
 * --- why the paytable is not the brief's 2 / 5 / 15 / 50 ----------------------
 * Eight symbols over twelve cells put only 1.5 cells of each symbol on the board
 * on average, so a *connected* run of four is rare. Measured over 4,000,000
 * sampled boards (`node backend/scripts/verify-fortune-gems.cjs`):
 *
 *   E[clusters 4-5] = 0.080490   E[clusters 6-7] = 0.003336
 *   E[clusters 8-9] = 0.000070   E[clusters 10+] ≈ 0.0000003
 *   hit rate (≥1 paying cluster) = 8.32%
 *
 * The brief's table therefore returns
 *
 *   RTP = 2 × 0.080490 + 5 × 0.003336 + 15 × 0.000070 ≈ 0.1787 → 17.87%
 *
 * an 82% house edge — harsher than any other game on the platform and a machine
 * no player would come back to. Scaling every tier by the same 5.43× keeps the
 * brief's 1 : 2.5 : 7.5 : 25 shape (and keeps the table monotonic, so a bigger
 * cluster never pays less) and lands on the shipped 11 / 26 / 80 / 265:
 *
 *   RTP = 11 × 0.080490 + 26 × 0.003336 + 80 × 0.000070 + 265 × 0.00000025
 *       = 0.885390 + 0.086736 + 0.005600 + 0.000066 = 0.97779 → 97.78%
 *
 * in line with the platform's other slots (Boxing King 97.42%, Fruit Bonanza
 * 97.22%). `BRIEF_PAYS` keeps the original table so the delta stays visible, and
 * the verifier re-measures both against the shipped constants.
 *
 * Consequence worth knowing: this is deliberately a **high-volatility** slot —
 * ~92% of spins lose, and a win is usually one 4-cluster paying 11×. To make it
 * hit more often, lower `MIN_CLUSTER` to 3 and re-derive the paytable with the
 * same script (the tier frequencies change, so the table must move with them).
 */

export const FORTUNE_SYMBOLS = ['🪙', '💰', '🧧', '🎋', '🏮', '👑', '💎', '8️⃣'] as const;

export type FortuneSymbol = (typeof FORTUNE_SYMBOLS)[number];

/** Board shape — 4 columns, 3 rows. */
export const FORTUNE_COLS = 4;
export const FORTUNE_ROWS = 3;
export const FORTUNE_CELLS = FORTUNE_COLS * FORTUNE_ROWS;

/** 8¹² = 68,719,476,736 — every possible board. */
export const FORTUNE_OUTCOMES = FORTUNE_SYMBOLS.length ** FORTUNE_CELLS;

/** A cluster must be this big to pay. */
export const MIN_CLUSTER = 4;

/** The table as briefed, kept for reference — it returns only 17.87% RTP. */
export const BRIEF_PAYS = {
  small: 2,
  medium: 5,
  large: 15,
  huge: 50,
} as const;

/** Payout by cluster size, as a multiple of the bet (shipped table, 97.78% RTP). */
export const FORTUNE_PAYS = {
  /** 4-5 symbols. */
  small: 11,
  /** 6-7 symbols. */
  medium: 26,
  /** 8-9 symbols. */
  large: 80,
  /** 10+ symbols. */
  huge: 265,
} as const;

export type FortunePayTable = { small: number; medium: number; large: number; huge: number };

/** Cluster pays: admin-configurable (`fortune_gems` row), falling back to the shipped table. */
export function fortunePays(): FortunePayTable {
  return getGameConfig<FortunePayTable>('fortune_gems') ?? FORTUNE_PAYS;
}

/**
 * Mean number of paying clusters per board, measured over 4,000,000 sampled
 * grids. Baked here so `fortuneGemsRtp()` is a closed form; the verifier
 * re-derives every figure and fails if these drift.
 */
export const FORTUNE_FREQUENCY = {
  small: 0.080490,
  medium: 0.003336,
  large: 0.000070,
  /** One 10-cluster in the 4,000,000 sampled boards — roughly one in four million. */
  huge: 0.00000025,
} as const;

/** Chance a board holds at least one paying cluster (measured). */
export const HIT_RATE = 0.083203;

export type FortuneTier = 'small' | 'medium' | 'large' | 'huge';

/**
 * Orthogonal neighbours of each cell, built from the 4×3 geometry so the board
 * shape lives in one place. Diagonals are deliberately absent.
 */
const NEIGHBOURS: ReadonlyArray<readonly number[]> = buildNeighbours();

function buildNeighbours(): number[][] {
  const list: number[][] = [];

  for (let cell = 0; cell < FORTUNE_CELLS; cell += 1) {
    const row = Math.floor(cell / FORTUNE_COLS);
    const col = cell % FORTUNE_COLS;
    const neighbours: number[] = [];

    if (row > 0) neighbours.push(cell - FORTUNE_COLS);
    if (row < FORTUNE_ROWS - 1) neighbours.push(cell + FORTUNE_COLS);
    if (col > 0) neighbours.push(cell - 1);
    if (col < FORTUNE_COLS - 1) neighbours.push(cell + 1);

    list.push(neighbours);
  }

  return list;
}

export type FortuneCluster = {
  symbol: FortuneSymbol;
  /** The cluster's cells, row-major, ascending. */
  cells: number[];
  size: number;
  /** Which paytable row the size falls in. */
  tier: FortuneTier;
  /** Multiple of the bet this cluster pays. */
  pay: number;
};

export type FortuneGemsResult = {
  /** Twelve symbols, row-major (4 per row). */
  grid: FortuneSymbol[];
  /** Every cluster of 4+ that paid. */
  clusters: FortuneCluster[];
  /** Cells belonging to a paying cluster (for the golden pulse). */
  winningCells: number[];
  /** Sum of the clusters' pays. */
  multiplier: number;
  payout: number;
  won: boolean;
  betAmount: number;
  balanceAfter: number;
  /** Size of the biggest cluster on the board (0 when nothing paid). */
  biggestCluster: number;
  serverSeedHash: string;
  roundId: string;
};

/** Which paytable row a cluster of `size` falls in. */
export function clusterTier(size: number): FortuneTier | null {
  if (size >= 10) return 'huge';
  if (size >= 8) return 'large';
  if (size >= 6) return 'medium';
  if (size >= MIN_CLUSTER) return 'small';

  return null;
}

/** Pay for a cluster of `size` symbols (0 below the minimum). */
export function clusterPay(size: number): number {
  const tier = clusterTier(size);

  return tier === null ? 0 : fortunePays()[tier];
}

/**
 * Every maximal group of 4+ identical symbols connected orthogonally. A group of
 * three, or a diagonal chain, is not a cluster.
 */
export function findClusters(grid: readonly FortuneSymbol[]): FortuneCluster[] {
  const seen = new Array<boolean>(FORTUNE_CELLS).fill(false);
  const clusters: FortuneCluster[] = [];

  for (let start = 0; start < FORTUNE_CELLS; start += 1) {
    if (seen[start]) continue;

    const symbol = grid[start]!;
    const stack = [start];
    const cells: number[] = [];
    seen[start] = true;

    while (stack.length > 0) {
      const cell = stack.pop()!;
      cells.push(cell);

      for (const next of NEIGHBOURS[cell]!) {
        if (!seen[next] && grid[next] === symbol) {
          seen[next] = true;
          stack.push(next);
        }
      }
    }

    const tier = clusterTier(cells.length);

    if (tier !== null) {
      cells.sort((a, b) => a - b);
      clusters.push({
        symbol,
        cells,
        size: cells.length,
        tier,
        pay: fortunePays()[tier],
      });
    }
  }

  return clusters;
}

/** Theoretical RTP of the shipped paytable (0.9778 = 97.78%). */
export function fortuneGemsRtp(pays: FortunePayTable = fortunePays()): number {
  return (
    pays.small * FORTUNE_FREQUENCY.small +
    pays.medium * FORTUNE_FREQUENCY.medium +
    pays.large * FORTUNE_FREQUENCY.large +
    pays.huge * FORTUNE_FREQUENCY.huge
  );
}

/** Symbols, paytable and measured odds — everything the cabinet draws. */
export function fortuneGemsConfig(): {
  symbols: readonly FortuneSymbol[];
  cols: number;
  rows: number;
  cells: number;
  outcomes: number;
  minCluster: number;
  pays: FortunePayTable;
  briefPays: typeof BRIEF_PAYS;
  frequency: typeof FORTUNE_FREQUENCY;
  hitRate: number;
  rtp: number;
  houseEdge: number;
} {
  const rtp = fortuneGemsRtp();

  return {
    symbols: FORTUNE_SYMBOLS,
    cols: FORTUNE_COLS,
    rows: FORTUNE_ROWS,
    cells: FORTUNE_CELLS,
    outcomes: FORTUNE_OUTCOMES,
    minCluster: MIN_CLUSTER,
    pays: fortunePays(),
    briefPays: BRIEF_PAYS,
    frequency: FORTUNE_FREQUENCY,
    hitRate: HIT_RATE,
    rtp,
    houseEdge: 1 - rtp,
  };
}

/** Fixed per-round nonce base; cell `i` is drawn with `NONCE + i`. */
const NONCE = 1;

/** Spin once and settle every cluster. */
export async function playFortuneGems(
  userId: string,
  betAmount: number,
): Promise<FortuneGemsResult> {
  const stake = assertBetAmount(betAmount);

  // 1. Draw the board (pure computation, nothing written yet).
  const serverSeed = generateServerSeed();
  const clientSeed = generateClientSeed();
  const serverSeedHash = hashServerSeed(serverSeed);

  const grid = drawGrid(serverSeed, clientSeed);
  const clusters = findClusters(grid);

  const multiplier = roundMoney(clusters.reduce((sum, cluster) => sum + cluster.pay, 0));
  const payout = roundMoney(stake * multiplier);
  const winningCells = [...new Set(clusters.flatMap((cluster) => cluster.cells))].sort(
    (a, b) => a - b,
  );
  const biggestCluster = clusters.reduce((max, cluster) => Math.max(max, cluster.size), 0);
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
    clusters,
    winningCells,
    multiplier,
    payout,
    won: payout > 0,
    betAmount: stake,
    balanceAfter,
    biggestCluster,
    serverSeedHash,
    roundId,
  };
}

/** Twelve independent 1-in-8 draws, one nonce per cell. */
function drawGrid(serverSeed: string, clientSeed: string): FortuneSymbol[] {
  return Array.from({ length: FORTUNE_CELLS }, (_, cell) => {
    const index = generateProvablyFairIndex(
      serverSeed,
      clientSeed,
      NONCE + cell,
      FORTUNE_SYMBOLS.length,
    );

    return FORTUNE_SYMBOLS[index]!;
  });
}

type RoundData = {
  roundId: string;
  userId: string;
  betAmount: number;
  grid: readonly FortuneSymbol[];
  multiplier: number;
  payout: number;
  serverSeedHash: string;
};

/**
 * Persists the round audit row (ledger rows are written by the wallet service).
 * `result` holds the twelve symbols row-major; there is no player decision, so
 * `bet_value` stays NULL.
 */
async function insertRound(client: PoolClient, data: RoundData): Promise<void> {
  await client.query(
    `INSERT INTO game_rounds
       (id, user_id, bet_amount, bet_type, bet_value, result, payout, multiplier, server_seed_hash)
     VALUES ($1, $2, $3, 'fortune_gems', NULL, $4, $5, $6, $7)`,
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
