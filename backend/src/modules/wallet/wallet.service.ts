import type { PoolClient } from 'pg';

import { query, withTransaction } from '../../config/db.js';
import { AppError } from '../../common/utils/AppError.js';

/**
 * Wallet service — ledger-based money handling.
 *
 * Rules (see docs/ARCHITECTURE.md §3):
 *   1. There is no balance column. The balance is SUM(amount) over completed rows.
 *   2. Rows are append-only: this module only ever INSERTs into `transactions`.
 *   3. Credits are positive (deposit, win); debits are negative (withdraw, bet).
 *   4. Every money movement runs inside a single DB transaction (ACID).
 */

export type TransactionType = 'deposit' | 'withdraw' | 'bet' | 'win';
export type TransactionStatus = 'pending' | 'completed' | 'failed' | 'cancelled';

/** Transaction shape returned to callers (amount as a JS number). */
export type Transaction = {
  id: string;
  userId: string;
  type: TransactionType;
  amount: number;
  status: TransactionStatus;
  referenceId: string | null;
  createdAt: string;
};

export type CreateTransactionData = {
  userId: string;
  type: TransactionType;
  /** Signed amount: positive credits the wallet, negative debits it. */
  amount: number;
  referenceId?: string | null;
  status?: TransactionStatus;
};

type TransactionRow = {
  id: string;
  user_id: string;
  type: TransactionType;
  amount: string | number;
  status: TransactionStatus;
  reference_id: string | null;
  created_at: Date;
};

type BalanceRow = {
  balance: string | null;
};

/** Postgres error code for `foreign_key_violation`. */
const FOREIGN_KEY_VIOLATION = '23503';

/**
 * Current balance of a user: SUM of completed ledger rows.
 *
 * Pass a `client` to read inside an open transaction so the value is consistent
 * with the rows that transaction has already written.
 */
export async function getBalance(userId: string, client?: PoolClient): Promise<number> {
  const sql = `
    SELECT COALESCE(SUM(amount), 0) AS balance
      FROM transactions
     WHERE user_id = $1
       AND status  = 'completed'
  `;
  const params = [userId];

  const result = client
    ? await client.query<BalanceRow>(sql, params)
    : await query<BalanceRow>(sql, params);

  const raw = result.rows[0]?.balance;
  const balance = Number(raw ?? 0);

  return Number.isFinite(balance) ? roundMoney(balance) : 0;
}

/**
 * Low-level ledger insert. Must be called with an open transaction client so the
 * caller controls COMMIT/ROLLBACK.
 */
export async function createTransaction(
  client: PoolClient,
  data: CreateTransactionData,
): Promise<Transaction> {
  const status: TransactionStatus = data.status ?? 'completed';

  try {
    const result = await client.query<TransactionRow>(
      `INSERT INTO transactions (user_id, type, amount, status, reference_id)
            VALUES ($1, $2, $3, $4, $5)
         RETURNING id, user_id, type, amount, status, reference_id, created_at`,
      // Amount is sent as a 2-dp string so NUMERIC never sees a float artefact.
      [data.userId, data.type, moneyString(data.amount), status, data.referenceId ?? null],
    );

    const row = result.rows[0];
    if (!row) {
      throw new AppError('TRANSACTION_NOT_CREATED', 500, 'Transaction could not be created');
    }

    return mapTransaction(row);
  } catch (error) {
    if (isForeignKeyViolation(error)) {
      throw new AppError('USER_NOT_FOUND', 404, 'User does not exist');
    }
    throw error;
  }
}
/**
 * Credit the wallet (top-up). Returns the ledger row that was written.
 *
 * There is no upper limit beyond the DB `NUMERIC(18,2)` column; the amount must
 * be a positive, finite number with at most 2 decimal places.
 */
export async function deposit(userId: string, amount: number): Promise<Transaction> {
  const value = assertPositiveAmount(amount, 'deposit');

  return withTransaction(async (client) => {
    await assertUserExists(client, userId);
    return createTransaction(client, { userId, type: 'deposit', amount: value });
  });
}

/**
 * Debit the wallet (cash-out).
 *
 * The balance is checked inside the same transaction that inserts the debit, and
 * the user row is locked (`FOR UPDATE`) first. Without that lock two concurrent
 * withdrawals would both read the same balance and both succeed — an overdraft.
 * The lock serialises per-user withdrawals; the ledger itself stays append-only.
 */
export async function withdraw(userId: string, amount: number): Promise<Transaction> {
  const value = assertPositiveAmount(amount, 'withdraw');

  return withTransaction(async (client) => {
    await lockUser(client, userId);

    const balance = await getBalance(userId, client);
    if (balance < value) {
      throw new AppError(
        'INSUFFICIENT_FUNDS',
        400,
        `Insufficient funds: balance is ${balance.toFixed(2)}, requested ${value.toFixed(2)}`,
      );
    }

    return createTransaction(client, { userId, type: 'withdraw', amount: -value });
  });
}

/**
 * BEGIN/COMMIT/ROLLBACK handling lives in `config/db.ts` (shared with the game
 * modules), so roulette bets and payouts use exactly the same transaction code.
 */

/** Serialises money movements for one user (row lock held until COMMIT). */
export async function lockUser(client: PoolClient, userId: string): Promise<void> {
  const result = await client.query<{ id: string }>(
    'SELECT id FROM users WHERE id = $1 FOR UPDATE',
    [userId],
  );

  if (result.rowCount === 0) {
    throw new AppError('USER_NOT_FOUND', 404, 'User does not exist');
  }
}

/** Cheaper existence check for credits (no lock needed to add money). */
async function assertUserExists(client: PoolClient, userId: string): Promise<void> {
  const result = await client.query<{ id: string }>('SELECT id FROM users WHERE id = $1', [userId]);

  if (result.rowCount === 0) {
    throw new AppError('USER_NOT_FOUND', 404, 'User does not exist');
  }
}

function assertPositiveAmount(amount: number, action: 'deposit' | 'withdraw'): number {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    throw new AppError('INVALID_AMOUNT', 400, 'Amount must be a finite number');
  }

  const value = roundMoney(amount);
  if (value <= 0) {
    throw new AppError('INVALID_AMOUNT', 400, `Amount must be greater than 0 to ${action}`);
  }

  return value;
}

function roundMoney(amount: number): number {
  return Math.round(amount * 100) / 100;
}

function moneyString(amount: number): string {
  return roundMoney(amount).toFixed(2);
}

function mapTransaction(row: TransactionRow): Transaction {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    amount: roundMoney(Number(row.amount)),
    status: row.status,
    referenceId: row.reference_id,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function isForeignKeyViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  return (error as { code?: unknown }).code === FOREIGN_KEY_VIOLATION;
}

