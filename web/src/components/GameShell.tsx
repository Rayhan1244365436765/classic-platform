import type { ReactNode } from 'react';

import { ArrowLeftIcon, WalletIcon } from './Icons';
import { SoundToggle } from './SoundToggle';

/**
 * The frame every game page sits in.
 *
 * A fixed top bar (lobby + balance) and a fixed bottom bar holding four
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
  onBack: () => void;
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
  title?: string;
  /** Shown under the balance, e.g. a balance request failure. */
  balanceError?: string | null;
};

function money(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  const digits = rounded % 1 === 0 ? 0 : 2;

  return `$${rounded.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: 2,
  })}`;
}

export function GameShell({
  balance,
  onBack,
  betAmount,
  setBetAmount,
  onSpin,
  spinLabel,
  isSpinning,
  children,
  chips = DEFAULT_CHIPS,
  controls,
  disabled = false,
  title,
  balanceError = null,
}: GameShellProps) {
  const left = chips.slice(0, Math.ceil(chips.length / 2));
  const right = chips.slice(Math.ceil(chips.length / 2));

  return (
    <div className={`gs${controls ? ' gs--wide-bar' : ''}`}>
      <header className="gs__top">
        <button type="button" className="gs__back" onClick={onBack}>
          <ArrowLeftIcon className="icon icon--sm" />
          <span>Lobby</span>
        </button>

        <h1 className="gs__title">{title ?? 'Play'}</h1>

        <SoundToggle />

        <span
          className={`gs__balance${balanceError ? ' gs__balance--error' : ''}`}
          title={balanceError ?? 'Current balance'}
        >
          <WalletIcon className="icon icon--sm" />
          {balance === null ? '—' : money(balance)}
        </span>
      </header>

      <main className="gs__main">{children}</main>

      <footer className="gs__bar">
        {controls && <div className="gs__controls">{controls}</div>}

        <div className="gs__row">
          <div className="gs__chips">
            {left.map((chip) => {
              const active = Math.abs(betAmount - chip) < 0.005;

              return (
                <button
                  key={chip}
                  type="button"
                  className={`gs-chip${active ? ' gs-chip--active' : ''}`}
                  onClick={() => setBetAmount(chip)}
                  disabled={isSpinning}
                  aria-pressed={active}
                  aria-label={`Bet ${money(chip)}`}
                >
                  {money(chip)}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            className={`gs__action${isSpinning ? ' gs__action--busy' : ''}`}
            onClick={onSpin}
            disabled={isSpinning || disabled}
            aria-label={`${spinLabel} for ${money(betAmount)}`}
          >
            <span className="gs__action-flame" aria-hidden="true" />
            <span className="gs__action-label">{spinLabel}</span>
            <span className="gs__action-bet">{isSpinning ? '…' : money(betAmount)}</span>
          </button>

          <div className="gs__chips">
            {right.map((chip) => {
              const active = Math.abs(betAmount - chip) < 0.005;

              return (
                <button
                  key={chip}
                  type="button"
                  className={`gs-chip${active ? ' gs-chip--active' : ''}`}
                  onClick={() => setBetAmount(chip)}
                  disabled={isSpinning}
                  aria-pressed={active}
                  aria-label={`Bet ${money(chip)}`}
                >
                  {money(chip)}
                </button>
              );
            })}
          </div>
        </div>
      </footer>
    </div>
  );
}
