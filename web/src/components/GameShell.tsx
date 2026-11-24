import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { GameBottomBar } from './GameBottomBar';
import { ArrowLeftIcon, WalletIcon } from './Icons';
import { LivePlayerBadge } from './LivePlayerBadge';
import { SoundToggle } from './SoundToggle';

/**
 * The frame every game page sits in.
 *
 * A fixed top bar (lobby on the left, balance centered, live players + sound on
 * the right) and a fixed bottom bar holding four
 * quick-bet chips around one big burning action button. The board goes in
 * `children` and takes whatever space is left, so nothing has to be scrolled to
 * reach the action.
 *
 * Games that need more than a bet size (bet type, mine count, hit/stand…) pass
 * those controls through `controls`; they render in a single scrolling strip
 * above the chips so the bar keeps a predictable height.
 */

/** Quick-bet values, two on each side of the action button. */
const DEFAULT_CHIPS = [5, 10, 20, 50];

export type GameShellProps = {
  balance: number | null;
  betAmount: number;
  setBetAmount: (amount: number) => void;
  onSpin: () => void;
  spinLabel: string;
  isSpinning: boolean;
  children: ReactNode;
  chips?: number[];
  /** Game-specific controls, shown in the bar above the chips. */
  controls?: ReactNode;
  /** Blocks the action on top of `isSpinning` (e.g. stake out of range). */
  disabled?: boolean;
  /** Shown under the balance, e.g. a balance request failure. */
  balanceError?: string | null;
  /**
   * Fill mode: the board area is exactly the space between the top bar and the
   * bottom bar (no page scroll), and `children` may size themselves to it.
   */
  fill?: boolean;
};

function money(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  const digits = rounded % 1 === 0 ? 0 : 2;

  return `৳${rounded.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: 2,
  })}`;
}

export function GameShell({
  balance,
  betAmount,
  setBetAmount,
  onSpin,
  spinLabel,
  isSpinning,
  children,
  chips = DEFAULT_CHIPS,
  controls,
  disabled = false,
  balanceError = null,
  fill = false,
}: GameShellProps) {
  return (
    <div className="phone-stage">
      <div className="phone-frame">
        <div className={`gs${controls ? ' gs--wide-bar' : ''}${fill ? ' gs--fill' : ''}`}>
      <header className="gs__top">
        <Link to="/" className="gs__back" aria-label="Back to Lobby">
          <ArrowLeftIcon className="icon icon--sm" />
          <span>Lobby</span>
        </Link>

        <span
          className={`gs__balance${balanceError ? ' gs__balance--error' : ''}`}
          title={balanceError ?? 'Current balance'}
        >
          <WalletIcon className="icon icon--sm" />
          {balance === null ? '—' : money(balance)}
        </span>

        <div className="gs__right">
          <LivePlayerBadge baseCount={3800} />
          <SoundToggle />
        </div>
      </header>

      <main className={`gs__main${fill ? ' gs__main--fill' : ''}`}>{children}</main>

      <footer className="gs__bar">
        {controls && <div className="gs__controls">{controls}</div>}

        <GameBottomBar
          betAmount={betAmount}
          onBetChange={setBetAmount}
          onPlay={onSpin}
          playLabel={spinLabel}
          isPlaying={isSpinning}
          disabled={disabled}
          chips={chips}
        />
      </footer>
    </div>
      </div>
    </div>
  );
}
