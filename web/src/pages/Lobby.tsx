import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type FormEvent,
} from 'react';
import { useNavigate } from 'react-router-dom';

import { api, getApiErrorMessage } from '../api/client';
import type { BalanceResponse, PaymentResponse } from '../api/types';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  GiftIcon,
  HeadsetIcon,
  HomeIcon,
  LiveIcon,
  LogoutIcon,
  SlotIcon,
  SportsIcon,
  UserIcon,
  WalletIcon,
} from '../components/Icons';
import { Modal } from '../components/Modal';
import { LivePlayerBadge } from '../components/LivePlayerBadge';
import { SoundToggle } from '../components/SoundToggle';
import { playSound } from '../utils/sound';
import { useAuth } from '../context/auth-context';

type Category = 'live' | 'slot';
type NavKey = 'home' | 'slots' | 'live' | 'sports' | 'promotions';

type Game = {
  id: string;
  title: string;
  category: Category;
  /** CSS gradient for the card artwork. */
  color: string;
  /** Emoji stand-in until real artwork exists. */
  icon: string;
  active?: boolean;
  badge?: string;
  /** Route opened when the card is playable. */
  path?: string;
};

const GAMES: Game[] = [
  { id: 'roulette', title: 'Spin to Win', category: 'live', color: 'linear-gradient(135deg,#d4af37,#7c5a10)', icon: '🎡', active: true, badge: 'LIVE', path: '/roulette' },
  { id: 'lucky-slots', title: 'Lucky Slots', category: 'slot', color: 'linear-gradient(135deg,#7c3aed,#2b1055)', icon: '🍒', active: true, badge: 'NEW', path: '/slots' },
  { id: 'dice', title: 'Dice', category: 'live', color: 'linear-gradient(135deg,#0e7490,#0f2f3d)', icon: '🎲', active: true, badge: 'NEW', path: '/dice' },
  { id: 'dice3d', title: '3D Dice 🎲', category: 'live', color: 'linear-gradient(135deg,#0f766e,#062a26)', icon: '🎲', active: true, badge: 'NEW', path: '/dice3d' },
  { id: 'aviator', title: 'Aviator', category: 'live', color: 'linear-gradient(135deg,#b45309,#7c2d12)', icon: '✈️', active: true, badge: 'HOT', path: '/aviator' },
  { id: 'mines', title: 'Mines', category: 'live', color: 'linear-gradient(135deg,#7f1d1d,#0f172a)', icon: '💣', active: true, badge: 'NEW', path: '/mines' },
  { id: 'plinko', title: 'Plinko', category: 'slot', color: 'linear-gradient(135deg,#4f46e5,#111827)', icon: '⚪', active: true, badge: 'NEW', path: '/plinko' },
  { id: 'keno', title: 'Keno 🔢', category: 'slot', color: 'linear-gradient(135deg,#0e7490,#164e63)', icon: '🎱', active: true, badge: 'NEW', path: '/keno' },
  { id: 'baccarat', title: 'Baccarat ♠️', category: 'live', color: 'linear-gradient(135deg,#15803d,#14532d)', icon: '♠️', active: true, badge: 'NEW', path: '/baccarat' },
  { id: 'boxing-king', title: 'Boxing King 🥊', category: 'slot', color: 'linear-gradient(135deg,#b91c1c,#450a0a)', icon: '🥊', active: true, badge: 'NEW', path: '/boxing-king' },
  { id: 'cascade', title: 'Showdown 🤠', category: 'slot', color: 'linear-gradient(135deg,#a16207,#422006)', icon: '🤠', active: true, badge: 'NEW', path: '/cascade' },
  { id: 'blackjack', title: 'Blackjack', category: 'live', color: 'linear-gradient(135deg,#166534,#052e16)', icon: '♠️', active: true, badge: 'NEW', path: '/blackjack' },
  { id: 'pinata-wins', title: 'Pinata Wins', category: 'slot', color: 'linear-gradient(135deg,#db2777,#831843)', icon: '🪅' },
  { id: 'super-teddy', title: 'Super Teddy', category: 'slot', color: 'linear-gradient(135deg,#ea580c,#7c2d12)', icon: '🧸' },
  { id: 'teenpatti', title: 'Teen Patti 🃏', category: 'live', color: 'linear-gradient(135deg,#0891b2,#164e63)', icon: '🃏', active: true, badge: 'NEW', path: '/teenpatti' },
  { id: 'dragontiger', title: 'Dragon Tiger 🐉', category: 'live', color: 'linear-gradient(135deg,#4338ca,#1e1b4b)', icon: '🐉', active: true, badge: 'NEW', path: '/dragontiger' },
  { id: 'fruit-bonanza', title: 'Fruit Bonanza 🍉', category: 'slot', color: 'linear-gradient(135deg,#f59e0b,#7c2d12)', icon: '🍉', active: true, badge: 'NEW', path: '/fruit-bonanza' },
  { id: 'dragon-tiger', title: 'Dragon Tiger', category: 'live', color: 'linear-gradient(135deg,#dc2626,#4c0519)', icon: '🐉', badge: 'HOT' },
  { id: 'lucky-bingo', title: 'Lucky Bingo', category: 'slot', color: 'linear-gradient(135deg,#7c3aed,#4c1d95)', icon: '🎱' },
  { id: 'ganesha-gold', title: 'Ganesha Gold', category: 'slot', color: 'linear-gradient(135deg,#d97706,#78350f)', icon: '🐘' },
  { id: 'caishen-wins', title: 'Caishen Wins', category: 'slot', color: 'linear-gradient(135deg,#be123c,#4c0519)', icon: '🧧' },
  { id: 'classic-roulette', title: 'Classic Roulette 🎡', category: 'live', color: 'linear-gradient(135deg,#0f7a4a,#06251a)', icon: '🎡', active: true, badge: 'NEW', path: '/classic-roulette' },
];
const NAV_ITEMS: Array<{
  key: NavKey;
  label: string;
  Icon: ComponentType<{ className?: string }>;
}> = [
  { key: 'home', label: 'Home', Icon: HomeIcon },
  { key: 'slots', label: 'Slots', Icon: SlotIcon },
  { key: 'live', label: 'Live Casino', Icon: LiveIcon },
  { key: 'sports', label: 'Sports', Icon: SportsIcon },
  { key: 'promotions', label: 'Promotions', Icon: GiftIcon },
];

const HEADINGS: Record<NavKey, { title: string; subtitle: string }> = {
  home: { title: 'Game Lobby', subtitle: 'Pick a table — 20 games and counting.' },
  slots: { title: 'Slot Games', subtitle: 'Jackpots, free spins and megaways.' },
  live: { title: 'Live Casino', subtitle: 'Real dealers, real wheels, real time.' },
  sports: { title: 'Sports', subtitle: 'Pre-match and live betting — coming soon.' },
  promotions: { title: 'Promotions', subtitle: 'Bonuses and tournaments — coming soon.' },
};

async function fetchBalance(): Promise<number> {
  const { data } = await api.get<BalanceResponse>('/wallet/balance');
  return data.balance;
}

export default function Lobby() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const [balance, setBalance] = useState<number | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [activeNav, setActiveNav] = useState<NavKey>('home');
  const [cashierOpen, setCashierOpen] = useState(false);
  const [amount, setAmount] = useState('10');
  const [busy, setBusy] = useState(false);
  const [cashierError, setCashierError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadBalance() {
      try {
        const value = await fetchBalance();
        if (!cancelled) {
          setBalance(value);
          setBalanceError(null);
        }
      } catch (requestError) {
        if (!cancelled) {
          setBalanceError(getApiErrorMessage(requestError, 'Could not load your balance.'));
        }
      }
    }

    void loadBalance();

    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-dismiss toasts.
  useEffect(() => {
    if (!toast) {
      return;
    }

    const timer = window.setTimeout(() => setToast(null), 2400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const refreshBalance = useCallback(async () => {
    try {
      setBalance(await fetchBalance());
      setBalanceError(null);
    } catch (requestError) {
      setBalanceError(getApiErrorMessage(requestError, 'Could not load your balance.'));
    }
  }, []);

  const visibleGames = useMemo(() => {
    if (activeNav === 'slots') {
      return GAMES.filter((game) => game.category === 'slot');
    }
    if (activeNav === 'live') {
      return GAMES.filter((game) => game.category === 'live');
    }
    return GAMES;
  }, [activeNav]);

  function selectNav(key: NavKey) {
    setActiveNav(key);

    if (key === 'sports') {
      setToast('Sports betting is coming soon');
    }
    if (key === 'promotions') {
      setToast('Promotions are coming soon');
    }
  }

  function openGame(game: Game) {
    playSound('click');

    if (game.active && game.path) {
      navigate(game.path);
      return;
    }

    setToast(`${game.title} — Coming Soon`);
  }

  async function performCashier(kind: 'deposit' | 'withdraw') {
    setCashierError(null);

    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      setCashierError('Enter an amount greater than 0.');
      return;
    }

    setBusy(true);

    try {
      await api.post<PaymentResponse>(`/payment/${kind}`, { amount: value });
      setCashierOpen(false);
      setToast(
        kind === 'deposit'
          ? 'Deposit request pending admin approval'
          : 'Withdrawal request pending admin approval',
      );
      await refreshBalance();
    } catch (requestError) {
      setCashierError(getApiErrorMessage(requestError, `Could not request a ${kind}.`));
    } finally {
      setBusy(false);
    }
  }

  function handleDeposit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void performCashier('deposit');
  }

  function handleLogout() {
    logout();
    navigate('/login', { replace: true });
  }

  const phone = user?.phone ?? 'Player';
  const balanceLabel = balance === null ? '···' : `$${balance.toFixed(2)}`;
  const heading = HEADINGS[activeNav];
  const showEmptyState = activeNav === 'sports' || activeNav === 'promotions';
  return (
    <div className="lobby">
      <aside className="lobby__sidebar">
        <div className="sidebar__brand">
          <span className="sidebar__crown" aria-hidden="true">
            ♛
          </span>
          <span className="sidebar__wordmark">
            CASINO<em>PLATFORM</em>
          </span>
        </div>

        <nav className="side-nav" aria-label="Game categories">
          {NAV_ITEMS.map(({ key, label, Icon }) => (
            <button
              key={key}
              type="button"
              className={`side-link${activeNav === key ? ' side-link--active' : ''}`}
              onClick={() => selectNav(key)}
              aria-current={activeNav === key ? 'page' : undefined}
            >
              <Icon className="icon" />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar__footer">
          <span className="sidebar__chip">Provably fair</span>
          <p className="side-note">HMAC-SHA256 · 18+ only</p>
        </div>
      </aside>

      <div className="lobby__content">
        <header className="lobby__topbar">
          <div className="lobby__identity">
            <span className="avatar" aria-hidden="true">
              <UserIcon className="icon" />
            </span>
            <span className="lobby__phone">{phone}</span>
          </div>

          <div className="lobby__topbar-right">
            <SoundToggle />

            <span
              className={`balance-pill${balanceError ? ' balance-pill--error' : ''}`}
              title={balanceError ?? 'Current balance'}
            >
              <WalletIcon className="icon icon--sm" />
              {balanceLabel}
            </span>

            <button
              type="button"
              className="button-primary button--compact"
              onClick={() => setCashierOpen(true)}
            >
              <ArrowDownIcon className="icon icon--sm" />
              Deposit
            </button>
            <button
              type="button"
              className="button-secondary button--compact"
              onClick={() => setCashierOpen(true)}
            >
              <ArrowUpIcon className="icon icon--sm" />
              Withdraw
            </button>
            <button
              type="button"
              className="icon-btn"
              onClick={handleLogout}
              title="Log out"
              aria-label="Log out"
            >
              <LogoutIcon className="icon" />
            </button>
          </div>
        </header>

        <main className="lobby__main">
          <div className="lobby__heading">
            <div>
              <h1>{heading.title}</h1>
              <p className="subtitle">{heading.subtitle}</p>
            </div>
            <div className="lobby__heading-meta">
              <LivePlayerBadge baseCount={12450} tone="total" />
              <span className="lobby__badge">{visibleGames.length} games</span>
            </div>
          </div>

          {balanceError && <p className="error">{balanceError}</p>}

          {showEmptyState ? (
            <div className="lobby__empty">
              <span aria-hidden="true">{activeNav === 'sports' ? '🏟️' : '🎁'}</span>
              <p>{heading.subtitle}</p>
            </div>
          ) : (
            <div className="game-grid">
              {visibleGames.map((game) => (
                <button
                  key={game.id}
                  type="button"
                  className={`game-card${game.active ? ' game-card--active' : ''}`}
                  onClick={() => openGame(game)}
                  aria-label={`${game.title} (${game.active ? 'play' : 'coming soon'})`}
                >
                  <span
                    className="game-card__art"
                    style={{ backgroundImage: game.color }}
                  >
                    {game.badge && (
                      <span
                        className={`game-card__badge${
                          game.badge === 'LIVE' ? ' game-card__badge--live' : ''
                        }`}
                      >
                        {game.badge}
                      </span>
                    )}
                    <span className="game-card__emoji" aria-hidden="true">
                      {game.icon}
                    </span>
                    {!game.active && (
                      <span className="game-card__lock" aria-hidden="true">
                        🔒
                      </span>
                    )}
                  </span>
                  <span className="game-card__meta">
                    <span className="game-card__title">{game.title}</span>
                    <span className="game-card__tag">
                      {game.active ? 'Play now' : 'Coming Soon'}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </main>
      </div>
      <div className="support" aria-label="Support">
        <button
          type="button"
          className="support__btn support__btn--wa"
          onClick={() => setToast('WhatsApp support is coming soon')}
          title="WhatsApp"
          aria-label="WhatsApp support"
        >
          WA
        </button>
        <button
          type="button"
          className="support__btn support__btn--tg"
          onClick={() => setToast('Telegram support is coming soon')}
          title="Telegram"
          aria-label="Telegram support"
        >
          TG
        </button>
        <button
          type="button"
          className="support__btn support__btn--cs"
          onClick={() => setToast('Live support is coming soon')}
          title="Customer support"
          aria-label="Customer support"
        >
          <HeadsetIcon className="icon" />
        </button>
      </div>

      <nav className="lobby__bottomnav" aria-label="Bottom navigation">
        <button
          type="button"
          className="bottom-link bottom-link--active"
          onClick={() => selectNav('home')}
        >
          <HomeIcon className="icon" />
          <span>Home</span>
        </button>
        <button
          type="button"
          className="bottom-link"
          onClick={() => selectNav('promotions')}
        >
          <GiftIcon className="icon" />
          <span>Promotions</span>
        </button>
        <button
          type="button"
          className="bottom-link"
          onClick={() => setToast(`${phone} · ${balanceLabel}`)}
        >
          <UserIcon className="icon" />
          <span>Profile</span>
        </button>
      </nav>

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}

      {cashierOpen && (
        <Modal title="Cashier" onClose={() => setCashierOpen(false)}>
          <form className="cashier-form" onSubmit={handleDeposit}>
            <label className="field">
              <span>Amount ($)</span>
              <input
                type="number"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                min={0.5}
                step={0.5}
                autoFocus
                required
              />
            </label>

            <div className="row">
              <button type="submit" className="button-primary" disabled={busy}>
                <ArrowDownIcon className="icon icon--sm" />
                {busy ? 'Sending…' : 'Deposit'}
              </button>
              <button
                type="button"
                className="button-secondary"
                disabled={busy}
                onClick={() => void performCashier('withdraw')}
              >
                <ArrowUpIcon className="icon icon--sm" />
                Withdraw
              </button>
            </div>

            {cashierError && <p className="error">{cashierError}</p>}
            <p className="hint">
              Requests are reviewed by an operator. Withdrawals are debited immediately and refunded
              if rejected.
            </p>
          </form>
        </Modal>
      )}
    </div>
  );
}


