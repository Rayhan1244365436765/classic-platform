import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type CSSProperties,
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
  HistoryIcon,
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
import { ProfileButton } from '../components/ProfileButton';
import { SoundToggle } from '../components/SoundToggle';
import { FireRouletteWheel } from '../components/FireRouletteWheel';
import { playSound } from '../utils/sound';
import { useAuth } from '../context/auth-context';

type Category = 'live' | 'slot';
type NavKey = 'home' | 'slots' | 'live' | 'sports' | 'promotions';

type Game = {
  id: string;
  title: string;
  category: Category;
  /** CSS gradient for the card artwork (fallback when no image). */
  color: string;
  /**
   * Glow colour of a premium tile (themed gradient + large glowing 3D icon).
   * Used by any game without a photo — see `isPremium`.
   */
  glow?: string;
  /** Optional custom artwork image served from /images/games/. */
  image?: string;
  /** Emoji stand-in until real artwork exists. */
  icon: string;
  active?: boolean;
  badge?: string;
  /** Route opened when the card is playable. */
  path?: string;
};

const GAMES: Game[] = [
  { id: 'roulette', title: 'Spin to Win', category: 'live', color: 'linear-gradient(160deg,#ffe08a 0%,#d4af37 34%,#c2410c 76%,#7c1d12 100%)', icon: '🎡', active: true, badge: 'LIVE', path: '/roulette' },
  { id: 'lucky-slots', title: 'Lucky Slots', category: 'slot', color: 'linear-gradient(135deg,#7c3aed,#2b1055)', icon: '🍒', active: true, badge: 'NEW', path: '/slots', image: '/images/lucky-slots.jpg' },
  { id: 'dice', title: 'Dice', category: 'live', color: 'linear-gradient(155deg,#2dd4bf 0%,#0e7490 36%,#0b3a5c 70%,#06182c 100%)', glow: '#5eead4', icon: '🎲', active: true, badge: 'NEW', path: '/dice' },
  { id: 'dice3d', title: '3D Dice 🎲', category: 'live', color: 'linear-gradient(135deg,#0f766e,#062a26)', icon: '🎲', active: true, badge: 'NEW', path: '/dice3d', image: '/images/dice3d.jpg' },
  { id: 'aviator', title: 'Aviator', category: 'live', color: 'linear-gradient(135deg,#b45309,#7c2d12)', icon: '✈️', active: true, badge: 'HOT', path: '/aviator', image: '/images/aviator.jpg' },
  { id: 'mines', title: 'Mines', category: 'live', color: 'linear-gradient(155deg,#c2301f 0%,#7f1d1d 30%,#2a0707 66%,#050506 100%)', glow: '#ff6a3d', icon: '💣', active: true, badge: 'NEW', path: '/mines' },
  { id: 'plinko', title: 'Plinko', category: 'slot', color: 'linear-gradient(155deg,#a78bfa 0%,#6d28d9 30%,#3730a3 62%,#0f1240 100%)', glow: '#a5b4fc', icon: '🔴', active: true, badge: 'NEW', path: '/plinko' },
  { id: 'keno', title: 'Keno 🔢', category: 'slot', color: 'linear-gradient(135deg,#0e7490,#164e63)', icon: '🎱', active: true, badge: 'NEW', path: '/keno', image: '/images/keno.jpg' },
  { id: 'baccarat', title: 'Baccarat ♠️', category: 'live', color: 'linear-gradient(135deg,#15803d,#14532d)', icon: '♠️', active: true, badge: 'NEW', path: '/baccarat', image: '/images/baccarat.jpg' },
  { id: 'boxing-king', title: 'Boxing King 🥊', category: 'slot', color: 'linear-gradient(135deg,#b91c1c,#450a0a)', icon: '🥊', active: true, badge: 'NEW', path: '/boxing-king', image: '/images/boxing-king.jpg' },
  { id: 'cascade', title: 'Showdown 🤠', category: 'slot', color: 'linear-gradient(135deg,#a16207,#422006)', icon: '🤠', active: true, badge: 'NEW', path: '/cascade', image: '/images/shodown.jpg' },
  { id: 'blackjack', title: 'Blackjack', category: 'live', color: 'linear-gradient(135deg,#166534,#052e16)', icon: '♠️', active: true, badge: 'NEW', path: '/blackjack', image: '/images/blackjack.jpg' },
  { id: 'pinata-wins', title: 'Pinata Wins', category: 'slot', color: 'linear-gradient(155deg,#fde047 0%,#fb923c 30%,#ec4899 64%,#9d174d 100%)', glow: '#ffd166', icon: '🎉' },
  { id: 'super-teddy', title: 'Super Teddy', category: 'slot', color: 'linear-gradient(155deg,#fbcfe8 0%,#e9a98b 34%,#b4745a 68%,#5c3a2e 100%)', glow: '#ffd9bf', icon: '🧸' },
  { id: 'teenpatti', title: 'Teen Patti 🃏', category: 'live', color: 'linear-gradient(155deg,#34d399 0%,#047857 32%,#064e3b 66%,#022c22 100%)', glow: '#6ee7b7', icon: '🃏', active: true, badge: 'NEW', path: '/teenpatti' },
  { id: 'dragontiger', title: 'Dragon Tiger 🐉', category: 'live', color: 'linear-gradient(155deg,#fcd34d 0%,#d97706 26%,#b91c1c 60%,#4c0519 100%)', glow: '#fbbf24', icon: '🐉', active: true, badge: 'NEW', path: '/dragontiger' },
  { id: 'fruit-bonanza', title: 'Fruit Bonanza 🍉', category: 'slot', color: 'linear-gradient(155deg,#a3e635 0%,#16a34a 34%,#dc2626 76%,#7f1d1d 100%)', glow: '#bef264', icon: '🍉', active: true, badge: 'NEW', path: '/fruit-bonanza' },
  { id: 'fortune-gems', title: 'Fortune Gems 💎', category: 'slot', color: 'linear-gradient(155deg,#f0c24a 0%,#b45309 24%,#7f1d1d 58%,#3f0d14 100%)', glow: '#ffd76a', icon: '💎', active: true, badge: 'NEW', path: '/fortune-gems' },
  { id: 'dragon-tiger', title: 'Dragon Tiger', category: 'live', color: 'linear-gradient(155deg,#fb7185 0%,#be123c 32%,#4c0519 66%,#0a0305 100%)', glow: '#fda4af', icon: '🐉', badge: 'HOT' },
  { id: 'lucky-bingo', title: 'Lucky Bingo', category: 'slot', color: 'linear-gradient(155deg,#818cf8 0%,#6d28d9 34%,#312e81 68%,#0b0c3a 100%)', glow: '#a5b4fc', icon: '🎱' },
  { id: 'ganesha-gold', title: 'Ganesha Gold', category: 'slot', color: 'linear-gradient(155deg,#fde68a 0%,#f59e0b 28%,#c2410c 62%,#5a1d06 100%)', glow: '#ffc857', icon: '🐘' },
  { id: 'caishen-wins', title: 'Caishen Wins', category: 'slot', color: 'linear-gradient(155deg,#fbbf24 0%,#ef4444 30%,#991b1b 64%,#3f0a0a 100%)', glow: '#ffd34d', icon: '🧧' },
  { id: 'classic-roulette', title: 'Classic Roulette 🎡', category: 'live', color: 'linear-gradient(135deg,#0f7a4a,#06251a)', icon: '🎡', active: true, badge: 'NEW', path: '/classic-roulette' },
];

/**
 * Premium tile: a themed gradient + glowing icon, for any game without a photo.
 * Locked ("Coming Soon") games use it too; CSS veils and padlocks them.
 */
function isPremium(game: Game): boolean {
  return Boolean(game.glow && !game.image);
}

/**
 * Inline art background. Photo tiles and the fire wheel bring their own artwork,
 * so they get no inline style. Locked tiles keep their themed art.
 */
function artStyle(game: Game): CSSProperties | undefined {
  if (game.id === 'roulette' || game.image) {
    return undefined;
  }

  return isPremium(game)
    ? ({ backgroundImage: game.color, '--gc-glow': game.glow } as CSSProperties)
    : { backgroundImage: game.color };
}

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
  const { logout } = useAuth();

  const [balance, setBalance] = useState<number | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [activeNav, setActiveNav] = useState<NavKey>('home');
  // The Profile page links here with ?cashier=1 to open the deposit/withdraw modal.
  const [cashierOpen, setCashierOpen] = useState(
    () => new URLSearchParams(window.location.search).get('cashier') === '1',
  );
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

  /** Withdrawals only — deposits have their own page (/deposit) with bKash/Nagad details. */
  async function performWithdraw() {
    const kind = 'withdraw';
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
      setToast('Withdrawal request pending admin approval');
      await refreshBalance();
    } catch (requestError) {
      setCashierError(getApiErrorMessage(requestError, `Could not request a ${kind}.`));
    } finally {
      setBusy(false);
    }
  }

  function handleWithdraw(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void performWithdraw();
  }

  function handleLogout() {
    logout();
    navigate('/login', { replace: true });
  }

  const balanceLabel = balance === null ? '···' : `৳${balance.toFixed(2)}`;
  const heading = HEADINGS[activeNav];
  const showEmptyState = activeNav === 'sports' || activeNav === 'promotions';
  return (
    <div className="lobby">
      <aside className="lobby__sidebar">
        <div className="sidebar__brand">
          <img src="/logo.png" alt="Casino Logo" style={{ maxHeight: '40px', width: 'auto' }} />
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
          <ProfileButton />

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
              onClick={() => navigate('/deposit')}
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
                  className={`game-card${game.active ? ' game-card--active' : ' game-card--locked'}${game.id === 'roulette' ? ' game-card--featured' : ''}`}
                  onClick={() => openGame(game)}
                  aria-label={`${game.title} (${game.active ? 'play' : 'coming soon'})`}
                  aria-disabled={game.active ? undefined : true}
                >
                  <span
                    className={`game-card__art${game.id === 'roulette' ? ' game-card__art--fire' : ''}${isPremium(game) ? ` game-card__art--premium gc-theme-${game.id}` : ''}`}
                    style={artStyle(game)}
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
                    {game.image ? (
                      <img
                        className="game-card__img"
                        src={game.image}
                        alt=""
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <>
                        {game.id === 'roulette' ? (
                          <FireRouletteWheel />
                        ) : isPremium(game) ? (
                          <span className="gc3d" aria-hidden="true">
                            <span className="gc3d__halo" />
                            <span className="gc3d__float">
                              <span className="game-card__emoji">{game.icon}</span>
                            </span>
                            <span className="gc3d__floor" />
                          </span>
                        ) : (
                          <span className="game-card__emoji" aria-hidden="true">
                            {game.icon}
                          </span>
                        )}
                      </>
                    )}
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
          onClick={() => navigate('/history')}
        >
          <HistoryIcon className="icon" />
          <span>History</span>
        </button>
        <button
          type="button"
          className="bottom-link"
          onClick={() => navigate('/profile')}
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
        <Modal title="Withdraw" onClose={() => setCashierOpen(false)}>
          <form className="cashier-form" onSubmit={handleWithdraw}>
            <label className="field">
              <span>Amount (৳)</span>
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
                <ArrowUpIcon className="icon icon--sm" />
                {busy ? 'Sending…' : 'Withdraw'}
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


