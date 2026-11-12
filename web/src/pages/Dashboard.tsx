import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { api, getApiErrorMessage } from '../api/client';
import type { BalanceResponse, PaymentResponse } from '../api/types';
import { useAuth } from '../context/auth-context';

/** Shared by the initial load, the roulette comeback and the cashier. */
async function fetchBalance(): Promise<number> {
  const { data } = await api.get<BalanceResponse>('/wallet/balance');
  return data.balance;
}

export default function Dashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [amount, setAmount] = useState('10');
  const [cashierBusy, setCashierBusy] = useState(false);
  const [cashierNotice, setCashierNotice] = useState<string | null>(null);
  const [cashierError, setCashierError] = useState<string | null>(null);

  const refreshBalance = useCallback(async () => {
    try {
      setBalance(await fetchBalance());
      setError(null);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Could not load your balance.'));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadBalance() {
      try {
        const value = await fetchBalance();
        if (!cancelled) {
          setBalance(value);
          setError(null);
        }
      } catch (requestError) {
        if (!cancelled) {
          setError(getApiErrorMessage(requestError, 'Could not load your balance.'));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadBalance();

    return () => {
      cancelled = true;
    };
  }, []);

  async function submitRequest(kind: 'deposit' | 'withdraw') {
    setCashierNotice(null);
    setCashierError(null);

    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      setCashierError('Enter an amount greater than 0.');
      return;
    }

    setCashierBusy(true);

    try {
      await api.post<PaymentResponse>(`/payment/${kind}`, { amount: value });
      setCashierNotice('Request pending admin approval.');
      // A withdrawal is debited immediately, so the balance changed.
      await refreshBalance();
    } catch (requestError) {
      setCashierError(getApiErrorMessage(requestError, `Could not request a ${kind}.`));
    } finally {
      setCashierBusy(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitRequest('deposit');
  }

  function handleLogout() {
    logout();
    navigate('/login', { replace: true });
  }

  return (
    <main className="shell">
      <section className="card card--wide">
        <h1>Welcome to Casino</h1>
        <p className="subtitle">
          {user?.phone ? `Signed in as ${user.phone}` : 'Signed in'}
          {user?.role === 'admin' ? ' · admin' : ''}
        </p>

        <h2>Balance</h2>
        {loading && <p className="subtitle">Loading…</p>}
        {!loading && error && <p className="error">{error}</p>}
        {!loading && !error && balance !== null && (
          <p className="balance">Current Balance: ${balance.toFixed(2)}</p>
        )}
        {!loading && !error && balance === null && (
          <p className="balance">Current Balance: $0.00</p>
        )}

        <h2>Cashier</h2>
        <form className="cashier" onSubmit={handleSubmit}>
          <label className="field cashier__field">
            <span>Amount ($)</span>
            <input
              type="number"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              min={0.5}
              step={0.5}
              required
            />
          </label>
          <div className="row">
            <button type="submit" className="button-primary" disabled={cashierBusy}>
              {cashierBusy ? 'Sending…' : 'Deposit'}
            </button>
            <button
              type="button"
              className="button-secondary"
              disabled={cashierBusy}
              onClick={() => void submitRequest('withdraw')}
            >
              Withdraw
            </button>
          </div>
        </form>
        {cashierNotice && <p className="notice">{cashierNotice}</p>}
        {cashierError && <p className="error">{cashierError}</p>}

        <div className="row">
          <button
            type="button"
            className="button-primary"
            onClick={() => navigate('/roulette')}
          >
            Play Roulette
          </button>
          <button type="button" className="button-secondary" onClick={handleLogout}>
            Log out
          </button>
        </div>

        <p className="hint">
          Deposits and withdrawals are reviewed by an operator. Roulette is provably fair.
        </p>
      </section>
    </main>
  );
}
