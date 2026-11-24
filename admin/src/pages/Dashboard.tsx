import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  ADMIN_USER_KEY,
  api,
  clearAdminSession,
  getApiErrorMessage,
} from '../api/client';
import type {
  AdminPaymentsResponse,
  AdminStats,
  AdminTransactionsResponse,
  AdminUsersResponse,
  AdminTransaction,
  AdminUser,
  PaymentRequest,
} from '../api/types';

function formatMoney(amount: number): string {
  return `৳${amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

function readAdminPhone(): string {
  const raw = localStorage.getItem(ADMIN_USER_KEY);

  if (!raw) {
    return 'Admin';
  }

  try {
    const parsed = JSON.parse(raw) as { phone?: unknown };
    return typeof parsed.phone === 'string' ? parsed.phone : 'Admin';
  } catch {
    return 'Admin';
  }
}

type DashboardData = {
  stats: AdminStats;
  users: AdminUser[];
  transactions: AdminTransaction[];
  payments: PaymentRequest[];
};

/** One loader shared by the initial effect, Refresh and post-action reloads. */
async function fetchDashboardData(): Promise<DashboardData> {
  const [statsResponse, usersResponse, transactionsResponse, paymentsResponse] =
    await Promise.all([
      api.get<AdminStats>('/admin/stats'),
      api.get<AdminUsersResponse>('/admin/users'),
      api.get<AdminTransactionsResponse>('/admin/transactions'),
      api.get<AdminPaymentsResponse>('/admin/payments'),
    ]);

  return {
    stats: statsResponse.data,
    users: usersResponse.data.users ?? [],
    transactions: transactionsResponse.data.transactions ?? [],
    payments: paymentsResponse.data.payments ?? [],
  };
}

export default function Dashboard() {
  const navigate = useNavigate();

  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [transactions, setTransactions] = useState<AdminTransaction[]>([]);
  const [payments, setPayments] = useState<PaymentRequest[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const applyData = useCallback((data: DashboardData) => {
    setStats(data.stats);
    setUsers(data.users);
    setTransactions(data.transactions);
    setPayments(data.payments);
    setError(null);
  }, []);

  const load = useCallback(async () => {
    try {
      applyData(await fetchDashboardData());
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Could not load dashboard data.'));
    } finally {
      setLoading(false);
    }
  }, [applyData]);

  useEffect(() => {
    let cancelled = false;

    async function loadInitial() {
      try {
        const data = await fetchDashboardData();
        if (cancelled) {
          return;
        }
        setStats(data.stats);
        setUsers(data.users);
        setTransactions(data.transactions);
        setPayments(data.payments);
        setError(null);
      } catch (requestError) {
        if (!cancelled) {
          setError(getApiErrorMessage(requestError, 'Could not load dashboard data.'));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadInitial();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleDecision(paymentId: string, action: 'approve' | 'reject') {
    setBusyId(paymentId);
    setError(null);

    try {
      await api.post(`/admin/payments/${paymentId}/${action}`);
      await load();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, `Could not ${action} the request.`));
    } finally {
      setBusyId(null);
    }
  }

  function handleRefresh() {
    setLoading(true);
    void load();
  }

  function handleLogout() {
    clearAdminSession();
    navigate('/login', { replace: true });
  }

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>Admin Dashboard</h1>
          <p className="muted">Signed in as {readAdminPhone()}</p>
        </div>
        <div className="row">
          <button type="button" className="button" onClick={handleRefresh} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
          <button type="button" className="button button--ghost" onClick={() => navigate('/games')}>
            Game Config
          </button>
          <button type="button" className="button button--ghost" onClick={handleLogout}>
            Log out
          </button>
        </div>
      </header>

      <main className="container">
        {error && <p className="error">{error}</p>}

        <section className="cards">
          <article className="card stat">
            <p className="stat__label">Total Users</p>
            <p className="stat__value">{stats ? stats.totalUsers : '—'}</p>
          </article>
          <article className="card stat">
            <p className="stat__label">Total Wagered</p>
            <p className="stat__value">{stats ? formatMoney(stats.totalWagered) : '—'}</p>
          </article>
          <article className="card stat">
            <p className="stat__label">Total Payouts</p>
            <p className="stat__value">{stats ? formatMoney(stats.totalPayouts) : '—'}</p>
          </article>
        </section>

        <section className="panel">
          <div className="panel__head">
            <h2>Pending Payments</h2>
            <span className="muted">{payments.length} awaiting review</span>
          </div>

          {payments.length === 0 ? (
            <p className="empty">{loading ? 'Loading payments…' : 'No pending requests.'}</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>User Phone</th>
                    <th className="num">Amount</th>
                    <th>Type</th>
                    <th>Method</th>
                    <th>Sender Number</th>
                    <th>TrxID</th>
                    <th>Date</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((payment) => (
                    <tr key={payment.id}>
                      <td className="mono">{payment.phone ?? '—'}</td>
                      <td className="num">{formatMoney(payment.amount)}</td>
                      <td>
                        <span className={`badge badge--${payment.type}`}>{payment.type}</span>
                      </td>
                      <td>{payment.type === 'deposit' ? payment.paymentMethod : '—'}</td>
                      <td className="mono">{payment.senderNumber ?? '—'}</td>
                      <td className="mono">{payment.trxId ?? '—'}</td>
                      <td className="muted">{formatDate(payment.createdAt)}</td>
                      <td>
                        <div className="row">
                          <button
                            type="button"
                            className="button button--approve"
                            onClick={() => handleDecision(payment.id, 'approve')}
                            disabled={busyId === payment.id}
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            className="button button--reject"
                            onClick={() => handleDecision(payment.id, 'reject')}
                            disabled={busyId === payment.id}
                          >
                            Reject
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="panel">
          <div className="panel__head">
            <h2>Users</h2>
            <span className="muted">{users.length} total</span>
          </div>

          {users.length === 0 ? (
            <p className="empty">{loading ? 'Loading users…' : 'No users yet.'}</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Phone</th>
                    <th>Role</th>
                    <th className="num">Balance</th>
                    <th>Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id}>
                      <td className="mono">{user.phone}</td>
                      <td>
                        <span className={`badge${user.role === 'admin' ? ' badge--admin' : ''}`}>
                          {user.role}
                        </span>
                      </td>
                      <td className="num">{formatMoney(user.balance)}</td>
                      <td className="muted">{formatDate(user.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="panel">
          <div className="panel__head">
            <h2>Recent Transactions</h2>
            <span className="muted">latest {transactions.length} (max 100)</span>
          </div>

          {transactions.length === 0 ? (
            <p className="empty">
              {loading ? 'Loading transactions…' : 'No transactions yet.'}
            </p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>User Phone</th>
                    <th>Type</th>
                    <th className="num">Amount</th>
                    <th>Status</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((transaction) => (
                    <tr key={transaction.id}>
                      <td className="mono">{transaction.phone}</td>
                      <td>
                        <span className={`badge badge--${transaction.type}`}>
                          {transaction.type}
                        </span>
                      </td>
                      <td
                        className={
                          transaction.amount < 0 ? 'num negative' : 'num positive'
                        }
                      >
                        {formatMoney(transaction.amount)}
                      </td>
                      <td className="muted">{transaction.status}</td>
                      <td className="muted">{formatDate(transaction.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

