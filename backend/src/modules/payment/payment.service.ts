import crypto from 'node:crypto';

import type { PoolClient } from 'pg';

import { AppError } from '../../common/utils/AppError.js';
import { query, withTransaction } from '../../config/db.js';
import { createTransaction, getBalance, lockUser } from '../wallet/wallet.service.js';
import type { DepositInput, PaymentMethod } from './payment.schema.js';

/**
 * Manual deposit / withdrawal requests (the bridge until a real payment gateway
 * is integrated).
 *
 * Money rules:
 *   * A **deposit** does not touch the ledger until an admin approves it.
 *   * A **withdrawal** is debited from the wallet immediately (a *completed*
 *     `withdraw` row) so the funds cannot be spent twice while it waits. If the
 *     admin rejects it, a compensating `deposit` row refunds the player.
 *
 * Note: the ledger only counts `status = 'completed'` rows toward a balance, so
 * a `pending` *transaction* would not actually hold the funds — hence the debit
 * is completed and the "waiting" state lives on `payment_requests.status`.
 */

export type PaymentType = 'deposit' | 'withdraw';
export type PaymentStatus = 'pending' | 'approved' | 'rejected';

export type PaymentRequest = {
  id: string;
  userId: string;
  amount: number;
  type: PaymentType;
  status: PaymentStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** bKash/Nagad Transaction ID (deposits only). */
  trxId: string | null;
  /** Number the player paid from (deposits only). */
  senderNumber: string | null;
  /** Meaningful for deposits only; withdrawals carry the column default. */
  paymentMethod: PaymentMethod;
  /** Joined for admin listings. */
  phone?: string;
};

export type PaymentRequestRow = {
  id: string;
  user_id: string;
  amount: string | number;
  type: PaymentType;
  status: PaymentStatus;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  created_at: Date;
  updated_at: Date;
  trx_id: string | null;
  sender_number: string | null;
  payment_method: PaymentMethod;
  phone?: string;
};

const FOREIGN_KEY_VIOLATION = '23503';
const UNIQUE_VIOLATION = '23505';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Selected by every payment query so the mapping is uniform. */
export const PAYMENT_COLUMNS = `
  pr.id,
  pr.user_id,
  pr.amount,
  pr.type,
  pr.status,
  pr.reviewed_by,
  pr.reviewed_at,
  pr.created_at,
  pr.updated_at,
  pr.trx_id,
  pr.sender_number,
  pr.payment_method,
  u.phone
`;

/**
 * Files a deposit request with the player's bKash/Nagad payment details so an
 * operator can verify it. No ledger entry is written until it is approved.
 */
export async function createDepositRequest(
  userId: string,
  input: DepositInput,
): Promise<PaymentRequest> {
  const value = assertAmount(input.amount);

  try {
    const result = await query<PaymentRequestRow>(
      `WITH inserted AS (
         INSERT INTO payment_requests
                (user_id, amount, type, trx_id, sender_number, payment_method)
              VALUES ($1, $2, 'deposit', $3, $4, $5)
           RETURNING *
       )
       SELECT ${PAYMENT_COLUMNS}
         FROM inserted pr
         JOIN users u ON u.id = pr.user_id`,
      [userId, moneyString(value), input.trxId, input.senderNumber, input.paymentMethod],
    );

    return mapPaymentRequest(requireRow(result.rows[0], 'PAYMENT_NOT_CREATED'));
  } catch (error) {
    if (isForeignKeyViolation(error)) {
      throw new AppError('USER_NOT_FOUND', 404, 'User does not exist');
    }
    if (isUniqueViolation(error)) {
      throw new AppError(
        'DUPLICATE_TRX_ID',
        409,
        'This Transaction ID has already been submitted',
      );
    }
    throw error;
  }
}

/**
 * Files a withdrawal request **and** debits the wallet immediately, atomically.
 * The debit is tagged with the request id (`reference_id`) so a refund can be
 * traced back to it.
 */
export async function createWithdrawRequest(
  userId: string,
  amount: number,
): Promise<PaymentRequest> {
  const value = assertAmount(amount);
  const requestId = crypto.randomUUID();

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

    // Real debit: the money leaves the wallet now and is refunded if rejected.
    await createTransaction(client, {
      userId,
      type: 'withdraw',
      amount: -value,
      referenceId: requestId,
    });

    const result = await client.query<PaymentRequestRow>(
      `WITH inserted AS (
         INSERT INTO payment_requests (id, user_id, amount, type)
              VALUES ($1, $2, $3, 'withdraw')
           RETURNING *
       )
       SELECT ${PAYMENT_COLUMNS}
         FROM inserted pr
         JOIN users u ON u.id = pr.user_id`,
      [requestId, userId, moneyString(value)],
    );

    return mapPaymentRequest(requireRow(result.rows[0], 'PAYMENT_NOT_CREATED'));
  });
}

/** A player's own request history, newest first. */
export async function listUserPayments(userId: string): Promise<PaymentRequest[]> {
  const result = await query<PaymentRequestRow>(
    `SELECT ${PAYMENT_COLUMNS}
       FROM payment_requests pr
       JOIN users u ON u.id = pr.user_id
      WHERE pr.user_id = $1
      ORDER BY pr.created_at DESC
      LIMIT 50`,
    [userId],
  );

  return result.rows.map(mapPaymentRequest);
}

/** Rejects malformed ids before they reach Postgres (which would raise 22P02). */
export function assertPaymentId(paymentId: string): string {
  if (!UUID_PATTERN.test(paymentId)) {
    throw new AppError('PAYMENT_NOT_FOUND', 404, 'Payment request not found');
  }
  return paymentId;
}

export function mapPaymentRequest(row: PaymentRequestRow): PaymentRequest {
  return {
    id: row.id,
    userId: row.user_id,
    amount: roundMoney(Number(row.amount)),
    type: row.type,
    status: row.status,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at ? new Date(row.reviewed_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    trxId: row.trx_id,
    senderNumber: row.sender_number,
    paymentMethod: row.payment_method,
    phone: row.phone,
  };
}

/** Locks a request for review (`SELECT … FOR UPDATE`). */
export async function lockPaymentRequest(
  client: PoolClient,
  paymentId: string,
): Promise<PaymentRequestRow> {
  const result = await client.query<PaymentRequestRow>(
    'SELECT * FROM payment_requests WHERE id = $1 FOR UPDATE',
    [paymentId],
  );

  return requireRow(result.rows[0], 'PAYMENT_NOT_FOUND');
}

function requireRow<T>(row: T | undefined, code: string): T {
  if (!row) {
    throw new AppError(
      code,
      code === 'PAYMENT_NOT_FOUND' ? 404 : 500,
      code === 'PAYMENT_NOT_FOUND'
        ? 'Payment request not found'
        : 'Payment request could not be created',
    );
  }
  return row;
}

function assertAmount(amount: number): number {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    throw new AppError('INVALID_AMOUNT', 400, 'Amount must be a finite number');
  }

  const value = roundMoney(amount);
  if (value <= 0) {
    throw new AppError('INVALID_AMOUNT', 400, 'Amount must be greater than 0');
  }

  return value;
}

function roundMoney(amount: number): number {
  return Math.round(amount * 100) / 100;
}

function moneyString(amount: number): string {
  return roundMoney(amount).toFixed(2);
}

function isForeignKeyViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  return (error as { code?: unknown }).code === FOREIGN_KEY_VIOLATION;
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  return (error as { code?: unknown }).code === UNIQUE_VIOLATION;
}

