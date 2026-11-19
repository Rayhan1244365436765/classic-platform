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
 * Boxing King — a 3×3 cluster-pays slot.
 *
 * Nine cells, six symbols, and a win is **any 3+ identical symbols joined
 * horizontally or vertically** (diagonals do not connect). Every cluster that
 * reaches three pays on its own and the pays add up, so one grid can hold two or
 * three separate clusters.
 *
 * Layout (row-major, every cell an independent 1-in-6 draw):
 *
 *   index:  0 1 2
 *           3 4 5
 *           6 7 8
 *
 *   neighbours: 0→1,3 | 1→0,2,4 | 2→1,5 | 3→0,4,6 | 4→1,3,5,7 | 5→2,4,8
 *               6→3,7 | 7→4,6,8 | 8→5,7
 *
 * --- paytable ---------------------------------------------------------------
 * A cluster pays by *size*, not by symbol:
 *
 *   3-4 symbols  → 2×
 *   5-6 symbols  → 8.5×
 *   7+  symbols  → 30×
 *
 * The bet is the base for every cluster, so a grid with a 4-cluster and a
 * 3-cluster pays 2× + 2×.
 *
 * --- RTP --------------------------------------------------------------------
 * Cluster frequency is not analytic on a 3×3 board (shapes overlap and stack), so
 * the three mean-clusters-per-grid figures below were **measured by enumerating
 * all 6⁹ = 10,077,696 grids** with the same flood fill the server uses
 * (`backend/scripts/verify-boxing-king.cjs`):
 *
 *   E[clusters of 3-4] = 0.380295   (37.87% of boards hold at least one)
 *   E[clusters of 5-6] = 0.023354
 *   E[clusters of 7+]  = 0.000504
 *
 *   RTP = 2 × 0.380295 + 8.5 × 0.023354 + 30 × 0.000504
 *       = 0.760590 + 0.198509 + 0.015120 = 0.974219 → 97.42%
 *
 * The brief's table (2× / 5× / 15×) was measured first and returns only **88.5%**
 * — an 11.5% house edge, roughly four times the platform's norm — so the two rare
 * tiers were raised while the common 3-4 tier keeps its 2×. The verifier
 * re-measures the frequencies and asserts this RTP, so the constants below cannot
 * drift away from the real board.
 */

export const BOXING_SYMBOLS = ['🥊', '🏆', '🤴', '💪', '💥', '🩳'] as const;

export type BoxingSymbol = (typeof BOXING_SYMBOLS)[number];

export const BOXING_CELLS = 9;
/** 6⁹ — every possible board. */
export const BOXING_OUTCOMES = BOXING_SYMBOLS.length ** BOXING_CELLS;

/** A cluster must be this big to pay. */
export const MIN_CLUSTER = 3;

/** Payout by cluster size, as a multiple of the bet. */
export const CLUSTER_PAYS = {
  /** 3-4 symbols. */
  small: 2,
  /** 5-6 symbols. */
  medium: 8.5,
  /** 7+ symbols. */
  large: 30,
} as const;

/**
 * Mean number of paying clusters per grid, measured over all 10,077,696 boards.
 * Baked here so the RTP is a closed form; the verifier re-derives them exactly.
 */
export const CLUSTER_FREQUENCY = {
  small: 0.380295,
  medium: 0.023354,
  large: 0.000504,
} as const;

/** Orthogonal neighbours of each cell (no diagonals). */
const NEIGHBOURS: ReadonlyArray<readonly number[]> = [
  [1, 3],
  [0, 2, 4],
  [1, 5],
  [0, 4, 6],
  [1, 3, 5, 7],
  [2, 4, 8],
  [3, 7],
  [4, 6, 8],
  [5, 7],
];


export type BoxingCluster = {
  symbol: BoxingSymbol;
  /** The cluster's cells, row-major, ascending. */
  cells: number[];
  size: number;
  /** Multiple of the bet this cluster pays. */
  pay: number;
};

export type BoxingKingResult = {
  /** Nine symbols, row-major. */
  grid: BoxingSymbol[];
  /** Every cluster of 3+ that paid. */
  clusters: BoxingCluster[];
  /** Cells belonging to a paying cluster (for the punch effect). */
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

/** Pay for a cluster of `size` symbols. */
export function clusterPay(size: number): number {
  if (size >= 7) return CLUSTER_PAYS.large;
  if (size >= 5) return CLUSTER_PAYS.medium;
  if (size >= MIN_CLUSTER) return CLUSTER_PAYS.small;

  return 0;
}

/**
 * Every maximal group of 3+ identical symbols connected orthogonally. A group of
 * two, or a diagonal chain, is not a cluster.
 */
export function findClusters(grid: readonly BoxingSymbol[]): BoxingCluster[] {
  const seen = new Array<boolean>(BOXING_CELLS).fill(false);
  const clusters: BoxingCluster[] = [];

  for (let start = 0; start < BOXING_CELLS; start += 1) {
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

    if (cells.length >= MIN_CLUSTER) {
      cells.sort((a, b) => a - b);
      clusters.push({ symbol, cells, size: cells.length, pay: clusterPay(cells.length) });
    }
  }

  return clusters;
}

/** Chance a board holds at least one paying cluster (measured, see above). */
const HIT_RATE = 0.378676;

/** Theoretical RTP of the paytable (≈0.9742 = 97.42%). */
export function boxingKingRtp(): number {
  return (
    CLUSTER_PAYS.small * CLUSTER_FREQUENCY.small +
    CLUSTER_PAYS.medium * CLUSTER_FREQUENCY.medium +
    CLUSTER_PAYS.large * CLUSTER_FREQUENCY.large
  );
}

/** Symbols, paytable and measured odds — everything the cabinet draws. */
export function boxingKingConfig(): {
  symbols: readonly BoxingSymbol[];
  cells: number;
  outcomes: number;
  minCluster: number;
  pays: typeof CLUSTER_PAYS;
  frequency: typeof CLUSTER_FREQUENCY;
  hitRate: number;
  rtp: number;
  houseEdge: number;
} {
  const rtp = boxingKingRtp();

  return {
    symbols: BOXING_SYMBOLS,
    cells: BOXING_CELLS,
    outcomes: BOXING_OUTCOMES,
    minCluster: MIN_CLUSTER,
    pays: CLUSTER_PAYS,
    frequency: CLUSTER_FREQUENCY,
    hitRate: HIT_RATE,
    rtp,
    houseEdge: 1 - rtp,
  };
}


/** Fixed per-round nonce base; cell `i` is drawn with `NONCE + i`. */
const NONCE = 1;

/** Spin once and settle every cluster. */
export async function playBoxingKing(
  userId: string,
  betAmount: number,
): Promise<BoxingKingResult> {
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

/** Nine independent 1-in-6 draws, one nonce per cell. */
function drawGrid(serverSeed: string, clientSeed: string): BoxingSymbol[] {
  return Array.from({ length: BOXING_CELLS }, (_, cell) => {
    const index = generateProvablyFairIndex(
      serverSeed,
      clientSeed,
      NONCE + cell,
      BOXING_SYMBOLS.length,
    );

    return BOXING_SYMBOLS[index]!;
  });
}

type RoundData = {
  roundId: string;
  userId: string;
  betAmount: number;
  grid: readonly BoxingSymbol[];
  multiplier: number;
  payout: number;
  serverSeedHash: string;
};

/**
 * Persists the round audit row (ledger rows are written by the wallet service).
 * `result` holds the nine symbols row-major; there is no player decision, so
 * `bet_value` stays NULL.
 */
async function insertRound(client: PoolClient, data: RoundData): Promise<void> {
  await client.query(
    `INSERT INTO game_rounds
       (id, user_id, bet_amount, bet_type, bet_value, result, payout, multiplier, server_seed_hash)
     VALUES ($1, $2, $3, 'boxing_king', NULL, $4, $5, $6, $7)`,
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
