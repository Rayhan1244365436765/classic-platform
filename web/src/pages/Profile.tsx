import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { api, getApiErrorMessage } from '../api/client';
import type { BalanceResponse } from '../api/types';
import { ArrowLeftIcon, ArrowDownIcon, ArrowUpIcon, UserIcon } from '../components/Icons';
import { useAuth } from '../context/auth-context';

type MenuItem = {
  key: string;
  icon: string;
  label: string;
  /** Route to open; items without one show a "Coming Soon" toast. */
  to?: string;
  /** Red notification dot. */
  dot?: boolean;
};

const MENU: MenuItem[] = [
  { key: 'rewards', icon: '🎁', label: 'My Rewards', dot: true },
  { key: 'records', icon: '🧾', label: 'Deposit & Withdraw', to: '/history' },
  { key: 'account', icon: '👤', label: 'My Account' },
  { key: 'security', icon: '🛡️', label: 'Security' },
  { key: 'invite', icon: '🤝', label: 'Invite Friends' },
  { key: 'missions', icon: '🎯', label: 'Missions', dot: true },
  { key: 'rebate', icon: '💰', label: 'Rebate' },
  { key: 'mail', icon: '✉️', label: 'Mail', dot: true },
  { key: 'support', icon: '💬', label: 'Support' },
  { key: 'app', icon: '📲', label: 'App Download' },
  { key: 'service', icon: '🎧', label: 'Customer Service' },
];

export default function Profile() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const [balance, setBalance] = useState<number | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Initial load (no synchronous setState inside the effect body).
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const { data } = await api.get<BalanceResponse>('/wallet/balance');
        if (!cancelled) {
          setBalance(data.balance);
          setBalanceError(null);
        }
      } catch (requestError) {
        if (!cancelled) {
          setBalanceError(getApiErrorMessage(requestError, 'Could not load your balance.'));
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  // Manual refresh button.
  const refreshBalance = useCallback(async () => {
    setRefreshing(true);
    try {
      const { data } = await api.get<BalanceResponse>('/wallet/balance');
      setBalance(data.balance);
      setBalanceError(null);
    } catch (requestError) {
      setBalanceError(getApiErrorMessage(requestError, 'Could not load your balance.'));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!toast) {
      return;
    }
    const timer = window.setTimeout(() => setToast(null), 2000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function handleLogout() {
    logout();
    navigate('/login', { replace: true });
  }

  const phone = user?.phone ?? 'Player';
  const balanceLabel = balance === null ? '···' : `$${balance.toFixed(2)}`;

  return (
    <div className="profile">
      <header className="profile__hero">
        <Link to="/" className="profile__back" aria-label="Back to Lobby">
          <ArrowLeftIcon className="icon icon--sm" />
          <span>Lobby</span>
        </Link>

        <div className="profile__user">
          <span className="profile__avatar" aria-hidden="true">
            <UserIcon className="icon" />
          </span>
          <div className="profile__who">
            <strong className="profile__phone">{phone}</strong>
            <span className="profile__badge">★ Member</span>
          </div>
        </div>

        <div className="profile__balance">
          <span className="profile__balance-label">Balance</span>
          <span className="profile__balance-row">
            <strong title={balanceError ?? undefined}>{balanceLabel}</strong>
            <button
              type="button"
              className={`profile__refresh${refreshing ? ' profile__refresh--spin' : ''}`}
              onClick={() => void refreshBalance()}
              disabled={refreshing}
              aria-label="Refresh balance"
            >
              ↻
            </button>
          </span>
          {balanceError && <span className="profile__error">{balanceError}</span>}
        </div>

        <div className="profile__actions">
          <Link to="/?cashier=1" className="profile__action">
            <ArrowDownIcon className="icon icon--sm" />
            Deposit
          </Link>
          <Link to="/?cashier=1" className="profile__action">
            <ArrowUpIcon className="icon icon--sm" />
            Withdraw
          </Link>
          <button type="button" className="profile__action" onClick={() => setToast('My Card — Coming Soon')}>
            💳 My Card
          </button>
        </div>
      </header>

      <section className="profile__panel" aria-label="Member Center">
        <h2 className="profile__title">Member Center</h2>
        <div className="profile__grid">
          {MENU.map((item) => {
            const content = (
              <>
                <span className="profile__icon" aria-hidden="true">
                  {item.icon}
                  {item.dot && <i className="profile__dot" />}
                </span>
                <span className="profile__label">{item.label}</span>
              </>
            );

            return item.to ? (
              <Link key={item.key} to={item.to} className="profile__item">
                {content}
              </Link>
            ) : (
              <button
                key={item.key}
                type="button"
                className="profile__item"
                onClick={() => setToast(`${item.label} — Coming Soon`)}
              >
                {content}
              </button>
            );
          })}

          <button type="button" className="profile__item profile__item--logout" onClick={handleLogout}>
            <span className="profile__icon" aria-hidden="true">
              🚪
            </span>
            <span className="profile__label">Logout</span>
          </button>
        </div>
      </section>

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
