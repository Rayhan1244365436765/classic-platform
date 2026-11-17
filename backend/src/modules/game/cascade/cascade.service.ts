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
 * Showdown (cascading cluster-pays slot) — 5×4 grid, Wild West symbol set.
 *
 * A **cluster** is three or more identical symbols joined orthogonally (no
 * diagonals). Every cluster pays from the table, all winning cells are removed,
 * the rest fall to the bottom of their column and fresh symbols drop in from the
 * top. That repeats while new clusters form, up to **5 cascades**, and the
 * cascade multiplier doubles each step:
 *
 *   step 1 ×1   step 2 ×2   step 3 ×4   step 4 ×8   step 5 ×16
 *
 * --- symbols ---------------------------------------------------------------
 * Seven themed symbols in three paying tiers, rarer as they get richer:
 *
 *   low    🤠 hat (24) · 🔫 gun (22) · 🥃 whiskey (26)
 *   mid    🐎 horse (13) · ⭐ badge (11)
 *   high   💥 dynamite (8) · 🔥 fire (6)
 *
 * (The numbers are spawn weights; they are not published as odds.)
 *
 * --- pay table / RTP -------------------------------------------------------
 * Cluster pays are bet multiples by cluster size (3, 4, 5, 6, 7, 8+):
 *
 *           3     4     5     6      7      8+
 *   🥃    0.06  0.12  0.25  0.47   0.82   1.40
 *   🤠    0.07  0.15  0.30  0.59   1.07   1.75
 *   🔫    0.09  0.19  0.37  0.72   1.28   2.13
 *   🐎    0.12  0.25  0.47  0.94   1.63   2.57
 *   ⭐    0.16  0.31  0.59  1.19   2.13   3.51
 *   💥    0.34  0.72  1.40  2.82   4.69   7.64
 *   🔥    0.59  1.19  2.35  4.69   8.20  14.08
 *
 * The cascade chain makes the exact expectation analytically intractable (each
 * refill is a fresh 20-cell state), so the table is **tuned by simulation** —
 * `backend/scripts/verify-cascade.cjs`, 3,000,000 rounds:
 *
 *   RTP 95.72% · hit rate 79.60% · avg 1.676 cascades · max win 133× bet
 *   cascades: 0 20.4% · 1 33.2% · 2 22.4% · 3 12.2% · 4 6.1% · 5 5.7%
 *
 * Re-theming changed the maths: the previous 8-symbol ladder carried over to
 * seven symbols paid **148.31%** (fewer distinct symbols ⇒ far more clusters), so
 * the pays were re-scaled and measured from scratch. `CASCADE_RTP` keeps the
 * measured figure beside the table; `GET /config` publishes it, and
 * `scripts/cascade-smoke.ps1` re-derives every cluster from live rounds.
 *
 * --- provable fairness -----------------------------------------------------
 * Every symbol — the opening 20 and every refill — comes from its own digest,
 * `HMAC(serverSeed, clientSeed:nonce)`, with the nonce incrementing per symbol.
 * The whole cascade chain is therefore reproducible from the committed seed.
 */

/** Grid geometry. */
export const GRID_COLS = 5;
export const GRID_ROWS = 4;
export const GRID_CELLS = GRID_COLS * GRID_ROWS;
/** Smallest paying cluster. */
export const MIN_CLUSTER = 3;
/** Cascades per round, and the multiplier applied to each step's win. */
export const MAX_CASCADES = 5;
export const CASCADE_MULTIPLIERS: readonly number[] = [1, 2, 4, 8, 16];

/** Measured over 3,000,000 simulated rounds (see the header). */
export const CASCADE_RTP = 0.9572;
export const CASCADE_RTP_ROUNDS = 3_000_000;

export type CascadeSymbolId =
  | 'WHISKEY'
  | 'HAT'
  | 'GUN'
  | 'HORSE'
  | 'BADGE'
  | 'DYNAMITE'
  | 'FIRE';

export type CascadeSymbol = {
  id: CascadeSymbolId;
  /** What the client draws. */
  glyph: string;
  /** Spawn weight — deliberately not published as an odds figure. */
  weight: number;
};

/** Low tier first; the last two are the premium symbols. */
export const CASCADE_SYMBOLS: readonly CascadeSymbol[] = [
  { id: 'WHISKEY', glyph: '🥃', weight: 26 },
  { id: 'HAT', glyph: '🤠', weight: 24 },
  { id: 'GUN', glyph: '🔫', weight: 22 },
  { id: 'HORSE', glyph: '🐎', weight: 13 },
  { id: 'BADGE', glyph: '⭐', weight: 11 },
  { id: 'DYNAMITE', glyph: '💥', weight: 8 },
  { id: 'FIRE', glyph: '🔥', weight: 6 },
];

/** Pay per cluster (bet multiples) indexed by size 3, 4, 5, 6, 7, 8+. */
export const CASCADE_PAYS: Record<CascadeSymbolId, readonly number[]> = {
  WHISKEY: [0.06, 0.12, 0.25, 0.47, 0.82, 1.4],
  HAT: [0.07, 0.15, 0.3, 0.59, 1.07, 1.75],
  GUN: [0.09, 0.19, 0.37, 0.72, 1.28, 2.13],
  HORSE: [0.12, 0.25, 0.47, 0.94, 1.63, 2.57],
  BADGE: [0.16, 0.31, 0.59, 1.19, 2.13, 3.51],
  DYNAMITE: [0.34, 0.72, 1.4, 2.82, 4.69, 7.64],
  FIRE: [0.59, 1.19, 2.35, 4.69, 8.2, 14.08],
};

export type CascadeCluster = {
  symbol: CascadeSymbolId;
  /** Grid indices (0 = top-left, row-major), ascending. */
  cells: number[];
  size: number;
  /** Table pay for this size, in bet multiples (before the cascade multiplier). */
  pay: number;
  /** `pay × multiplier`. */
  win: number;
};

export type CascadeStep = {
  /** 1-based cascade number. */
  step: number;
  multiplier: number;
  /** The grid the clusters were found in. */
  grid: CascadeSymbolId[];
  clusters: CascadeCluster[];
  /** Every cell cleared by this step's clusters. */
  removed: number[];
  /** Step win in bet multiples (already multiplied). */
  win: number;
};

export type CascadeResult = {
  /** Opening grid. */
  grid: CascadeSymbolId[];
  /** Grid after the last cascade (or the opening grid when nothing won). */
  finalGrid: CascadeSymbolId[];
  steps: CascadeStep[];
  cascadeCount: number;
  maxMultiplier: number;
  /** Total win in bet multiples, e.g. 2.41. */
  totalWin: number;
  betAmount: number;
  payout: number;
  balanceAfter: number;
  serverSeedHash: string;
  roundId: string;
};

const TOTAL_WEIGHT = CASCADE_SYMBOLS.reduce((sum, symbol) => sum + symbol.weight, 0);

/** Table pay for a cluster of `size`, in bet multiples. */
export function clusterPay(symbol: CascadeSymbolId, size: number): number {
  const row = CASCADE_PAYS[symbol];
  return row[Math.min(size, 8) - MIN_CLUSTER]!;
}

/** Orthogonal neighbours of a cell. */
function neighbours(cell: number): number[] {
  const col = cell % GRID_COLS;
  const row = (cell - col) / GRID_COLS;
  const result: number[] = [];

  if (col > 0) result.push(cell - 1);
  if (col < GRID_COLS - 1) result.push(cell + 1);
  if (row > 0) result.push(cell - GRID_COLS);
  if (row < GRID_ROWS - 1) result.push(cell + GRID_COLS);

  return result;
}

/**
 * Every connected group of 3+ identical symbols (4-way adjacency).
 * Cells are visited once, so no cluster can be counted twice.
 */
export function findClusters(
  grid: readonly CascadeSymbolId[],
): { symbol: CascadeSymbolId; cells: number[] }[] {
  if (grid.length !== GRID_CELLS) {
    throw new Error(`grid must hold ${GRID_CELLS} cells, got ${grid.length}`);
  }

  const seen = new Array<boolean>(GRID_CELLS).fill(false);
  const clusters: { symbol: CascadeSymbolId; cells: number[] }[] = [];

  for (let start = 0; start < GRID_CELLS; start += 1) {
    if (seen[start]) continue;

    const symbol = grid[start]!;
    const stack = [start];
    const cells: number[] = [];
    seen[start] = true;

    while (stack.length > 0) {
      const cell = stack.pop()!;
      cells.push(cell);

      for (const next of neighbours(cell)) {
        if (!seen[next] && grid[next] === symbol) {
          seen[next] = true;
          stack.push(next);
        }
      }
    }

    if (cells.length >= MIN_CLUSTER) {
      clusters.push({ symbol, cells: cells.sort((a, b) => a - b) });
    }
  }

  return clusters;
}

/**
 * Clear `removed`, drop each column to the bottom, and pull new symbols for the
 * gaps from `nextSymbol` (top row first, left to right).
 */
export function collapseGrid(
  grid: readonly CascadeSymbolId[],
  removed: readonly number[],
  nextSymbol: () => CascadeSymbolId,
): CascadeSymbolId[] {
  const next: (CascadeSymbolId | null)[] = [...grid];
  for (const cell of removed) next[cell] = null;

  for (let col = 0; col < GRID_COLS; col += 1) {
    const survivors: CascadeSymbolId[] = [];
    for (let row = GRID_ROWS - 1; row >= 0; row -= 1) {
      const value = next[row * GRID_COLS + col];
      if (value !== null) survivors.push(value);
    }

    // New symbols fill from the bottom of the gap upwards, so the column reads
    // top-down as [new…, survivor…].
    for (let row = GRID_ROWS - 1; row >= 0; row -= 1) {
      const fromBottom = GRID_ROWS - 1 - row;
      next[row * GRID_COLS + col] =
        fromBottom < survivors.length ? survivors[fromBottom]! : nextSymbol();
    }
  }

  return next as CascadeSymbolId[];
}

/** Symbols, geometry, multiplier ladder, pay table and the measured RTP. */
export function cascadeConfig(): {
  cols: number;
  rows: number;
  cells: number;
  minCluster: number;
  maxCascades: number;
  multipliers: readonly number[];
  symbols: { id: CascadeSymbolId; glyph: string }[];
  pays: Record<CascadeSymbolId, readonly number[]>;
  rtp: number;
  rtpRounds: number;
} {
  return {
    cols: GRID_COLS,
    rows: GRID_ROWS,
    cells: GRID_CELLS,
    minCluster: MIN_CLUSTER,
    maxCascades: MAX_CASCADES,
    multipliers: CASCADE_MULTIPLIERS,
    symbols: CASCADE_SYMBOLS.map(({ id, glyph }) => ({ id, glyph })),
    pays: CASCADE_PAYS,
    rtp: CASCADE_RTP,
    rtpRounds: CASCADE_RTP_ROUNDS,
  };
}

/** Play one Showdown spin. */
export async function playCascade(userId: string, betAmount: number): Promise<CascadeResult> {
  const stake = assertBetAmount(betAmount);

  // 1. Spin the grid and run the cascade chain (pure computation, nothing written).
  const serverSeed = generateServerSeed();
  const clientSeed = generateClientSeed();
  const serverSeedHash = hashServerSeed(serverSeed);

  // One digest per symbol drawn; the nonce keeps the order reproducible.
  let nonce = 0;
  const nextSymbol = (): CascadeSymbolId => {
    nonce += 1;
    let roll = generateProvablyFairFloat(serverSeed, clientSeed, nonce) * TOTAL_WEIGHT;

    for (const symbol of CASCADE_SYMBOLS) {
      roll -= symbol.weight;
      if (roll < 0) return symbol.id;
    }

    return CASCADE_SYMBOLS[CASCADE_SYMBOLS.length - 1]!.id;
  };

  const openingGrid = Array.from({ length: GRID_CELLS }, () => nextSymbol());
  let grid = openingGrid;
  const steps: CascadeStep[] = [];
  let totalWin = 0;

  for (let index = 0; index < MAX_CASCADES; index += 1) {
    const clusters = findClusters(grid);
    if (clusters.length === 0) break;

    const multiplier = CASCADE_MULTIPLIERS[index]!;
    const removedSet = new Set<number>();
    const paidClusters: CascadeCluster[] = [];
    let stepWin = 0;

    for (const cluster of clusters) {
      const pay = clusterPay(cluster.symbol, cluster.cells.length);
      const win = round4(pay * multiplier);

      paidClusters.push({
        symbol: cluster.symbol,
        cells: cluster.cells,
        size: cluster.cells.length,
        pay,
        win,
      });

      stepWin = round4(stepWin + win);
      for (const cell of cluster.cells) removedSet.add(cell);
    }

    const removed = [...removedSet].sort((a, b) => a - b);
    steps.push({
      step: index + 1,
      multiplier,
      grid,
      clusters: paidClusters,
      removed,
      win: stepWin,
    });

    totalWin = round4(totalWin + stepWin);
    grid = collapseGrid(grid, removed, nextSymbol);
  }

  const payout = roundMoney(stake * totalWin);
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
      cascadeCount: steps.length,
      maxMultiplier: steps.length === 0 ? 1 : steps[steps.length - 1]!.multiplier,
      totalWin,
      payout,
      serverSeedHash,
    });

    return roundMoney(balance - stake + payout);
  });

  return {
    grid: openingGrid,
    finalGrid: grid,
    steps,
    cascadeCount: steps.length,
    maxMultiplier: steps.length === 0 ? 1 : steps[steps.length - 1]!.multiplier,
    totalWin,
    betAmount: stake,
    payout,
    balanceAfter,
    serverSeedHash,
    roundId,
  };
}

type RoundData = {
  roundId: string;
  userId: string;
  betAmount: number;
  cascadeCount: number;
  maxMultiplier: number;
  totalWin: number;
  payout: number;
  serverSeedHash: string;
};

/**
 * Persists the round audit row (ledger rows are written by the wallet service).
 * `result` keeps the cascade count, the deepest multiplier and the total win in
 * bet multiples, e.g. `3c|4x|2.41x`. The `multiplier` column is clamped to what
 * `NUMERIC(6,2)` can hold so a monstrous round can never fail the insert — the
 * money itself is already exact in `payout`.
 */
async function insertRound(client: PoolClient, data: RoundData): Promise<void> {
  await client.query(
    `INSERT INTO game_rounds
       (id, user_id, bet_amount, bet_type, bet_value, result, payout, multiplier, server_seed_hash)
     VALUES ($1, $2, $3, 'cascade', NULL, $4, $5, $6, $7)`,
    [
      data.roundId,
      data.userId,
      moneyString(data.betAmount),
      `${data.cascadeCount}c|${data.maxMultiplier}x|${data.totalWin}x`,
      moneyString(data.payout),
      Math.min(data.totalWin, 9999.99).toFixed(2),
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

/** Bet multiples carry four decimals so small cluster pays don't drift. */
function round4(amount: number): number {
  return Math.round(amount * 10_000) / 10_000;
}

function moneyString(amount: number): string {
  return roundMoney(amount).toFixed(2);
}
