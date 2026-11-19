import { useState, type ChangeEvent } from 'react';

const DEFAULT_CHIPS = [5, 10, 20, 50];

/** Custom bet ladder shared by every game: multiples of 5, from 5 up to 500. */
const BET_STEP = 5;
const BET_MIN = 5;
const BET_MAX = 500;

export type GameBottomBarProps = {
  betAmount: number;
  onBetChange: (amount: number) => void;
  onPlay: () => void;
  playLabel: string;
  isPlaying: boolean;
  /** Blocks play on top of `isPlaying` (e.g. stake out of range). */
  disabled?: boolean;
  /** Blocks only the bet chips (e.g. Aviator in flight) — defaults to `isPlaying`. */
  chipsDisabled?: boolean;
  chips?: number[];
};

function money(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  const digits = rounded % 1 === 0 ? 0 : 2;

  return `$${rounded.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: 2,
  })}`;
}

/** Rounds a bet to the nearest 5 and clamps it to [5, 500]. */
function snapBet(value: number): number {
  const stepped = Math.round(value / BET_STEP) * BET_STEP;
  return Math.min(Math.max(stepped, BET_MIN), BET_MAX);
}

/**
 * The single control row shared by every game:
 *
 *   [$chip] [$chip]      ( PLAY — big )      [$chip] [$chip]
 *   Custom bet: [ $___ ]
 *
 * Fully controlled: the page owns `betAmount` and passes it down with a setter.
 * Only the custom-input text is local (a string draft), so typing "2.5" doesn't
 * fire intermediate `onBetChange` calls. Tapping a chip commits immediately.
 */
export function GameBottomBar({
  betAmount,
  onBetChange,
  onPlay,
  playLabel,
  isPlaying,
  disabled = false,
  chipsDisabled,
  chips = DEFAULT_CHIPS,
}: GameBottomBarProps) {
  const [draft, setDraft] = useState(() => String(snapBet(betAmount)));

  const left = chips.slice(0, Math.ceil(chips.length / 2));
  const right = chips.slice(Math.ceil(chips.length / 2));

  function commitBet(value: number): void {
    const snapped = snapBet(value);
    setDraft(String(snapped));
    onBetChange(snapped);
  }

  function pickChip(chip: number): void {
    commitBet(chip);
  }

  function handleCustom(event: ChangeEvent<HTMLInputElement>): void {
    const value = event.target.value;
    setDraft(value);

    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      onBetChange(snapBet(parsed));
    }
  }

  function handleBlur(): void {
    const parsed = Number(draft);
    commitBet(Number.isFinite(parsed) && parsed > 0 ? parsed : BET_MIN);
  }

  function renderChip(chip: number) {
    const active = Math.abs(betAmount - chip) < 0.005;

    return (
      <button
        key={chip}
        type="button"
        className={`gs-chip${active ? ' gs-chip--active' : ''}`}
        onClick={() => pickChip(chip)}
        disabled={chipsDisabled ?? isPlaying}
        aria-pressed={active}
        aria-label={`Bet ${money(chip)}`}
      >
        {money(chip)}
      </button>
    );
  }

  return (
    <div className="gbb">
      <div className="gs__row">
        <div className="gs__chips">{left.map(renderChip)}</div>

        <button
          type="button"
          className={`gs__action${isPlaying ? ' gs__action--busy' : ''}`}
          onClick={onPlay}
          disabled={isPlaying || disabled}
          aria-label={`${playLabel} for ${money(betAmount)}`}
        >
          <span className="gs__action-flame" aria-hidden="true" />
          <span className="gs__action-label">{playLabel}</span>
          <span className="gs__action-bet">{isPlaying ? '…' : money(betAmount)}</span>
        </button>

        <div className="gs__chips">{right.map(renderChip)}</div>
      </div>

      <label className="gbb-custom">
        <span className="gbb-custom__label">Custom bet</span>
        <input
          className="gbb-custom__input"
          type="number"
          inputMode="decimal"
          value={draft}
          onChange={handleCustom}
          onBlur={handleBlur}
          min={BET_MIN}
          max={BET_MAX}
          step={BET_STEP}
          disabled={chipsDisabled ?? isPlaying}
          aria-label="Custom bet amount"
        />
      </label>
    </div>
  );
}

export default GameBottomBar;