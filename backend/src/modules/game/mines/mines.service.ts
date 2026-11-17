import crypto from 'node:crypto';

import type { PoolClient } from 'pg';

import {
  generateClientSeed,
  generateProvablyFairFloat,
  generateServerSeed,
  hashServerSeed,
} from '../../../common/provably-fair/index.js';
import { AppError } from '../../../common/utils/AppError.js';
import { query, withTransaction } from '../../../config/db.js';
import { createTransaction, getBalance, lockUser } from '../../wallet/wallet.service.js';

/**
 * Mines — a 5×5 board where the player opens tiles and cashes out before
 * hitting one of the hidden mines.
 *
 * Multiplier (standard hypergeometric pay table, 3% house edge):
 *
 *   fair(k) = C(25, k) / C(25 − M, k)          // k safe tiles, M mines
 *   multiplier(k) = floor(fair(k) × 0.97, 2dp)
 *
 * because P(opening k safe tiles) = 1 / fair(k), the expected return is 0.97 at
 * *every* cash-out point — the edge never depends on how greedy the player is.
 * The board is drawn with a provably-fair Fisher–Yates shuffle of the 25 cells,
 * and the mine layout never leaves the server until the game settles.
 */

export const GRID_SIZE = 25;
export const GRID_COLS = 5;
export const MIN_MINES = 1;
export const MAX_MINES = 24;
/** 3% house edge baked into the pay table. */
export const HOUSE_EDGE = 0.03;

export type MinesStatus = 'active' | 'won' | 'lost';

export type MinesStartResult = {
  gameId: string;
  betAmount: number;
  minesCount: number;
  multiplier: number;
  balanceAfter: number;
  serverSeedHash: string;
};

export type MinesRevealResult = {
  status: MinesStatus;
  multiplier: number;
  revealedTiles: number[];
  safeTiles: number;
  /** Mines are only disclosed once the game is over. */
  mines?: number[];
  bombIndex?: number;
  payout: number;
  balanceAfter: number;
};

export type MinesCashoutResult = {
  status: 'won';
  multiplier: number;
  payout: number;
  revealedTiles: number[];
  safeTiles: number;
  mines: number[];
  balanceAfter: number;
};

export type MinesResume = {
  gameId: string;
  betAmount: number;
  minesCount: number;
  multiplier: number;
  revealedTiles: number[];
  safeTiles: number;
};

/** Multiplier after opening `revealed` safe tiles on a board with `minesCount`. */
export function minesMultiplier(minesCount: number, revealed: number): number {
  if (revealed <= 0) {
    return 1;
  }

  let fair = 1;
  for (let step = 0; step < revealed; step += 1) {
    fair *= (GRID_SIZE - step) / (GRID_SIZE - minesCount - step);
  }

  // Floor, so the payout is never rounded up in the player's favour.
  return Math.floor(fair * (1 - HOUSE_EDGE) * 100) / 100;
}

/** Pay table for the UI: multiplier at each reveal count. */
export function minesTable(minesCount: number): number[] {
  const safeTiles = GRID_SIZE - minesCount;

  return Array.from({ length: safeTiles }, (_, index) => minesMultiplier(minesCount, index + 1));
}

/** Deterministic Fisher–Yates shuffle driven by the committed seed. */
function buildGrid(minesCount: number, serverSeed: string, clientSeed: string): boolean[] {
  const order = Array.from({ length: GRID_SIZE }, (_, index) => index);

  for (let index = order.length - 1; index > 0; index -= 1) {
    const roll = generateProvablyFairFloat(serverSeed, clientSeed, index + 1);
    const swap = Math.floor(roll * (index + 1));
    const current = order[index]!;
    order[index] = order[swap]!;
    order[swap] = current;
  }

  const grid = Array.from({ length: GRID_SIZE }, () => false);
  for (let index = 0; index < minesCount; index += 1) {
    grid[order[index]!] = true;
  }

  return grid;
}

function mineIndices(grid: boolean[]): number[] {
  return grid.reduce<number[]>((acc, isMine, index) => {
    if (isMine) {
      acc.push(index);
    }
    return acc;
  }, []);
}

type GameRow = {
  id: string;
  bet_amount: string | number;
  mines_count: number;
  grid_state: boolean[];
  revealed_tiles: number[];
  status: MinesStatus;
  multiplier: string | number;
};

/** Open a new game: debit the stake and commit a hidden board. */
export async function startGame(
  userId: string,
  betAmount: number,
  minesCount: number,
): Promise<MinesStartResult> {
  const stake = assertBetAmount(betAmount);
  const mines = assertMinesCount(minesCount);

  const serverSeed = generateServerSeed();
  const clientSeed = generateClientSeed();
  const serverSeedHash = hashServerSeed(serverSeed);
  const grid = buildGrid(mines, serverSeed, clientSeed);
  const gameId = crypto.randomUUID();

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

    // Only one board at a time — the player must settle the current one.
    const active = await client.query<{ id: string }>(
      `SELECT id FROM mines_games WHERE user_id = $1 AND status = 'active' LIMIT 1`,
      [userId],
    );

    if ((active.rowCount ?? 0) > 0) {
      throw new AppError(
        'GAME_IN_PROGRESS',
        409,
        'You already have an open board — cash it out (GET /game/mines/current) or finish it',
      );
    }

    await createTransaction(client, {
      userId,
      type: 'bet',
      amount: -stake,
      referenceId: gameId,
    });

    await client.query(
      `INSERT INTO mines_games
         (id, user_id, bet_amount, mines_count, grid_state, revealed_tiles,
          status, multiplier, server_seed_hash)
       VALUES ($1, $2, $3, $4, $5::jsonb, '[]'::jsonb, 'active', 1, $6)`,
      [gameId, userId, moneyString(stake), mines, JSON.stringify(grid), serverSeedHash],
    );

    return roundMoney(balance - stake);
  });

  return {
    gameId,
    betAmount: stake,
    minesCount: mines,
    multiplier: 1,
    balanceAfter,
    serverSeedHash,
  };
}

/** Open one tile. Mines end the game; the layout is disclosed on settle. */
export async function revealTile(
  userId: string,
  gameId: string,
  tileIndex: number,
): Promise<MinesRevealResult> {
  const index = assertTileIndex(tileIndex);

  return withTransaction(async (client) => {
    await lockUser(client, userId);

    const game = await lockGame(client, gameId, userId);
    if (game.status !== 'active') {
      throw new AppError('GAME_ALREADY_SETTLED', 409, `Game already ${game.status}`);
    }

    const revealed = game.revealed_tiles ?? [];
    if (revealed.includes(index)) {
      throw new AppError('TILE_ALREADY_REVEALED', 409, 'That tile is already open');
    }

    const stake = roundMoney(Number(game.bet_amount));

    // Mine → the game is over and the whole layout is now public.
    if (game.grid_state[index]) {
      await client.query(
        `UPDATE mines_games
            SET status = 'lost', payout = 0, settled_at = now()
          WHERE id = $1`,
        [gameId],
      );

      const balance = await getBalance(userId, client);

      return {
        status: 'lost',
        multiplier: 0,
        revealedTiles: revealed,
        safeTiles: revealed.length,
        mines: mineIndices(game.grid_state),
        bombIndex: index,
        payout: 0,
        balanceAfter: balance,
      };
    }

    const nextRevealed = [...revealed, index];
    const multiplier = minesMultiplier(game.mines_count, nextRevealed.length);
    const cleared = nextRevealed.length === GRID_SIZE - game.mines_count;

    // Board cleared → settle as a win straight away.
    if (cleared) {
      const payout = roundMoney(stake * multiplier);

      await createTransaction(client, {
        userId,
        type: 'win',
        amount: payout,
        referenceId: gameId,
      });

      await client.query(
        `UPDATE mines_games
            SET status = 'won', multiplier = $2, payout = $3,
                revealed_tiles = $4::jsonb, settled_at = now()
          WHERE id = $1`,
        [gameId, multiplier.toFixed(2), moneyString(payout), JSON.stringify(nextRevealed)],
      );

      const balance = await getBalance(userId, client);

      return {
        status: 'won',
        multiplier,
        revealedTiles: nextRevealed,
        safeTiles: nextRevealed.length,
        mines: mineIndices(game.grid_state),
        payout,
        balanceAfter: balance,
      };
    }

    await client.query(
      `UPDATE mines_games
          SET revealed_tiles = $2::jsonb, multiplier = $3
        WHERE id = $1`,
      [gameId, JSON.stringify(nextRevealed), multiplier.toFixed(2)],
    );

    const balance = await getBalance(userId, client);

    return {
      status: 'active',
      multiplier,
      revealedTiles: nextRevealed,
      safeTiles: nextRevealed.length,
      payout: 0,
      balanceAfter: balance,
    };
  });
}

/** Cash out the revealed tiles at the current multiplier. */
export async function cashOut(userId: string, gameId: string): Promise<MinesCashoutResult> {
  return withTransaction(async (client) => {
    await lockUser(client, userId);

    const game = await lockGame(client, gameId, userId);
    if (game.status !== 'active') {
      throw new AppError('GAME_ALREADY_SETTLED', 409, `Game already ${game.status}`);
    }

    const revealed = game.revealed_tiles ?? [];
    if (revealed.length === 0) {
      throw new AppError(
        'NOTHING_REVEALED',
        400,
        'Open at least one tile before cashing out',
      );
    }

    const stake = roundMoney(Number(game.bet_amount));
    // Recomputed from the number of safe tiles — never trusted from the client.
    const multiplier = minesMultiplier(game.mines_count, revealed.length);
    const payout = roundMoney(stake * multiplier);

    await createTransaction(client, {
      userId,
      type: 'win',
      amount: payout,
      referenceId: gameId,
    });

    await client.query(
      `UPDATE mines_games
          SET status = 'won', multiplier = $2, payout = $3, settled_at = now()
        WHERE id = $1`,
      [gameId, multiplier.toFixed(2), moneyString(payout)],
    );

    const balance = await getBalance(userId, client);

    return {
      status: 'won',
      multiplier,
      payout,
      revealedTiles: revealed,
      safeTiles: revealed.length,
      mines: mineIndices(game.grid_state),
      balanceAfter: balance,
    };
  });
}

/** The board the player can resume (page reload, second tab, …). */
export async function getActiveGame(userId: string): Promise<MinesResume | null> {
  const result = await query<{
    id: string;
    bet_amount: string | number;
    mines_count: number;
    revealed_tiles: number[];
  }>(
    `SELECT id, bet_amount, mines_count, revealed_tiles
       FROM mines_games
      WHERE user_id = $1 AND status = 'active'
      ORDER BY created_at DESC
      LIMIT 1`,
    [userId],
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  const revealed = row.revealed_tiles ?? [];

  return {
    gameId: row.id,
    betAmount: roundMoney(Number(row.bet_amount)),
    minesCount: row.mines_count,
    multiplier: minesMultiplier(row.mines_count, revealed.length),
    revealedTiles: revealed,
    safeTiles: revealed.length,
  };
}

/** Row-locks the game so reveal/cash-out can never interleave. */
async function lockGame(
  client: PoolClient,
  gameId: string,
  userId: string,
): Promise<GameRow> {
  const result = await client.query<GameRow>(
    `SELECT id, bet_amount, mines_count, grid_state, revealed_tiles, status, multiplier
       FROM mines_games
      WHERE id = $1 AND user_id = $2
      FOR UPDATE`,
    [gameId, userId],
  );

  const row = result.rows[0];
  if (!row) {
    throw new AppError('GAME_NOT_FOUND', 404, 'Game does not exist');
  }

  return row;
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

function assertMinesCount(minesCount: number): number {
  if (!Number.isInteger(minesCount) || minesCount < MIN_MINES || minesCount > MAX_MINES) {
    throw new AppError(
      'INVALID_MINES_COUNT',
      400,
      `Mines must be a whole number between ${MIN_MINES} and ${MAX_MINES}`,
    );
  }

  return minesCount;
}

function assertTileIndex(tileIndex: number): number {
  if (!Number.isInteger(tileIndex) || tileIndex < 0 || tileIndex >= GRID_SIZE) {
    throw new AppError('INVALID_TILE', 400, `Tile must be between 0 and ${GRID_SIZE - 1}`);
  }

  return tileIndex;
}

function roundMoney(amount: number): number {
  return Math.round(amount * 100) / 100;
}

function moneyString(amount: number): string {
  return roundMoney(amount).toFixed(2);
}


