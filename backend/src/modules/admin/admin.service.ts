import { AppError } from '../../common/utils/AppError.js';
import { query, withTransaction } from '../../config/db.js';
import {
  assertPaymentId,
  lockPaymentRequest,
  mapPaymentRequest,
  PAYMENT_COLUMNS,
  type PaymentRequest,
  type PaymentRequestRow,
} from '../payment/payment.service.js';
import { createTransaction } from '../wallet/wallet.service.js';

/**
 * Admin reporting queries.
 *
 * **Read-only by design** — nothing in this module writes to the database.
 * Money figures are derived from the `transactions` ledger, never from a stored
 * balance column (see docs/ARCHITECTURE.md §3).
 */

export type AdminStats = {
  totalUsers: number;
  /** Gross amount staked (absolute value: bet rows are stored as negative). */
  totalWagered: number;
  /** Total credited by `win` rows. */
  totalPayouts: number;
};

export type AdminUser = {
  id: string;
  phone: string;
  role: string;
  createdAt: string;
  balance: number;
};

export type AdminTransaction = {
  id: string;
  phone: string;
  type: string;
  amount: number;
  status: string;
  referenceId: string | null;
  createdAt: string;
};

type StatsRow = {
  total_users: string | number | null;
  total_wagered: string | number | null;
  total_payouts: string | number | null;
};

type UserRow = {
  id: string;
  phone: string;
  role: string;
  created_at: Date;
  balance: string | number | null;
};

type TransactionRow = {
  id: string;
  phone: string;
  type: string;
  amount: string | number;
  status: string;
  reference_id: string | null;
  created_at: Date;
};

/** Platform-wide counters for the dashboard cards. */
export async function getStats(): Promise<AdminStats> {
  const result = await query<StatsRow>(`
    SELECT
      (SELECT COUNT(*)::text FROM users) AS total_users,
      (
        SELECT COALESCE(ABS(SUM(amount)), 0)::text
          FROM transactions
         WHERE type = 'bet'
           AND status = 'completed'
      ) AS total_wagered,
      (
        SELECT COALESCE(SUM(amount), 0)::text
          FROM transactions
         WHERE type = 'win'
           AND status = 'completed'
      ) AS total_payouts
  `);

  const row = result.rows[0];

  return {
    totalUsers: Number(row?.total_users ?? 0),
    totalWagered: roundMoney(Number(row?.total_wagered ?? 0)),
    totalPayouts: roundMoney(Number(row?.total_payouts ?? 0)),
  };
}

/** Every user with their ledger-derived balance, newest first. */
export async function getUsers(): Promise<AdminUser[]> {
  const result = await query<UserRow>(`
    SELECT
      u.id,
      u.phone,
      u.role,
      u.created_at,
      COALESCE(SUM(t.amount), 0) AS balance
    FROM users u
    LEFT JOIN transactions t
           ON t.user_id = u.id
          AND t.status = 'completed'
    GROUP BY u.id, u.phone, u.role, u.created_at
    ORDER BY u.created_at DESC
  `);

  return result.rows.map((row) => ({
    id: row.id,
    phone: row.phone,
    role: row.role,
    createdAt: toIsoString(row.created_at),
    balance: roundMoney(Number(row.balance ?? 0)),
  }));
}

/** The most recent 100 ledger rows, newest first. */
export async function getTransactions(): Promise<AdminTransaction[]> {
  const result = await query<TransactionRow>(`
    SELECT
      t.id,
      u.phone,
      t.type,
      t.amount,
      t.status,
      t.reference_id,
      t.created_at
    FROM transactions t
    JOIN users u ON u.id = t.user_id
    ORDER BY t.created_at DESC
    LIMIT 100
  `);

  return result.rows.map((row) => ({
    id: row.id,
    phone: row.phone,
    type: row.type,
    amount: roundMoney(Number(row.amount)),
    status: row.status,
    referenceId: row.reference_id,
    createdAt: toIsoString(row.created_at),
  }));
}

function roundMoney(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
}

function toIsoString(value: Date | string): string {
  return new Date(value).toISOString();
}

// ---------------------------------------------------------------------------
// Payment request review
// ---------------------------------------------------------------------------

/**
 * Requests awaiting review, oldest first (a queue).
 */
export async function getPendingPayments(): Promise<PaymentRequest[]> {
  const result = await query<PaymentRequestRow>(`
    SELECT ${PAYMENT_COLUMNS}
      FROM payment_requests pr
      JOIN users u ON u.id = pr.user_id
     WHERE pr.status = 'pending'
     ORDER BY pr.created_at ASC
  `);

  return result.rows.map(mapPaymentRequest);
}

/**
 * Approves a request.
 *
 * - **deposit** → credits the player with a `deposit` ledger row.
 * - **withdraw** → nothing to move; the funds were debited when it was filed.
 *
 * The row is locked `FOR UPDATE` so two admins cannot approve the same request
 * (the second gets 409 instead of double-crediting).
 */
export async function approvePayment(
  paymentId: string,
  adminId: string,
): Promise<PaymentRequest> {
  const id = assertPaymentId(paymentId);

  return withTransaction(async (client) => {
    const request = await lockPaymentRequest(client, id);

    if (request.status !== 'pending') {
      throw new AppError(
        'PAYMENT_ALREADY_PROCESSED',
        409,
        `Payment request is already ${request.status}`,
      );
    }

    const updated = await client.query<PaymentRequestRow>(
      `UPDATE payment_requests
          SET status = 'approved',
              reviewed_by = $2,
              reviewed_at = now()
        WHERE id = $1
        RETURNING *`,
      [id, adminId],
    );

    if (request.type === 'deposit') {
      await createTransaction(client, {
        userId: request.user_id,
        type: 'deposit',
        amount: Number(request.amount),
        referenceId: id,
      });
    }

    return mapPaymentRequest(requireUpdated(updated.rows[0]));
  });
}

/**
 * Rejects a request.
 *
 * - **withdraw** → refunds the player with a compensating `deposit` row, because
 *   the money was taken when the request was filed.
 * - **deposit** → nothing to undo; no ledger row was ever written.
 */
export async function rejectPayment(
  paymentId: string,
  adminId: string,
): Promise<PaymentRequest> {
  const id = assertPaymentId(paymentId);

  return withTransaction(async (client) => {
    const request = await lockPaymentRequest(client, id);

    if (request.status !== 'pending') {
      throw new AppError(
        'PAYMENT_ALREADY_PROCESSED',
        409,
        `Payment request is already ${request.status}`,
      );
    }

    const updated = await client.query<PaymentRequestRow>(
      `UPDATE payment_requests
          SET status = 'rejected',
              reviewed_by = $2,
              reviewed_at = now()
        WHERE id = $1
        RETURNING *`,
      [id, adminId],
    );

    if (request.type === 'withdraw') {
      await createTransaction(client, {
        userId: request.user_id,
        type: 'deposit',
        amount: Number(request.amount),
        referenceId: id,
      });
    }

    return mapPaymentRequest(requireUpdated(updated.rows[0]));
  });
}

function requireUpdated(row: PaymentRequestRow | undefined): PaymentRequestRow {
  if (!row) {
    throw new AppError('PAYMENT_NOT_FOUND', 404, 'Payment request not found');
  }
  return row;
}

