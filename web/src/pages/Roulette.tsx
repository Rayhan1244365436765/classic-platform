import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { api, getApiErrorMessage } from '../api/client';
import type { BalanceResponse, SegmentColor, SpinResult, WheelConfig } from '../api/types';
import { ArrowLeftIcon, WalletIcon } from '../components/Icons';
import { LivePlayerBadge } from '../components/LivePlayerBadge';
import { SoundToggle } from '../components/SoundToggle';
import { playSound } from '../utils/sound';

/**
 * "Spin to Win" lucky wheel.
 *
 * The player only chooses a stake; the segment decides the multiplier.
 * The layout comes from GET /game/roulette/segments so the wheel drawn here is
 * always the table the server settles on (20 segments).
 *
 * Player-facing rule: never surface odds, RTP or house edge. The UI shows the
 * multiplier paytable and the result, nothing else — the economics live in the
 * API docs, not in the game screen.
 */

const CHIPS = [1, 5, 10, 50, 100];
/** Wheel/paytable preview stake used until the player enters one. */
const DEFAULT_BET = 10;
const HISTORY_LIMIT = 6;
/** Must match the transform transition on `.wheel` so the card lands on stop. */
const SPIN_DURATION_MS = 3600;
/** One extra full turn per spin so the wheel always feels like it travels. */
const TURNS_PER_SPIN = 4;

/** Used only if the config request fails — mirrors the backend table. */
const FALLBACK_SEGMENTS: readonly number[] = [
  10, 0, 0.5, 0, 0, 2, 0, 0, 0.5, 0, 0, 0, 0.5, 0, 0, 0, 0.5, 0, 0, 0,
];

const SWATCH: Record<SegmentColor, string> = {
  gray: '#1b2130',
  blue: '#1d4ed8',
  green: '#15803d',
  gold: '#d4af37',
};

function colorOf(multiplier: number): SegmentColor {
  if (multiplier >= 10) {
    return 'gold';
  }
  if (multiplier >= 2) {
    return 'green';
  }
  if (multiplier > 0) {
    return 'blue';
  }
  return 'gray';
}

/** Zeros alternate two dark shades so the slices stay readable when spinning. */
function segmentFill(multiplier: number, index: number): string {
  if (multiplier > 0) {
    return SWATCH[colorOf(multiplier)];
  }
  return index % 2 === 0 ? '#1b2130' : '#131822';
}

function multiplierLabel(multiplier: number): string {
  return `${multiplier}×`;
}

/** "$0", "$5", "$100", "$1,250.50" — used where space is plentiful. */
function money(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  const fractionDigits = rounded % 1 === 0 ? 0 : 2;

  return `$${rounded.toLocaleString('en-US', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: 2,
  })}`;
}

/** Compact rim label: "$0", "$20", "$120", "$1.2k", "$12k". */
function moneyCompact(value: number): string {
  const rounded = Math.round(value * 100) / 100;

  if (rounded >= 1000) {
    const thousands = Math.round((rounded / 1000) * 10) / 10;
    return `$${thousands % 1 === 0 ? thousands.toFixed(0) : thousands.toFixed(1)}k`;
  }

  return money(rounded).replace('.00', '');
}

/** Full dollars unless the string would overflow the wheel hub. */
function moneyFit(value: number): string {
  const full = money(value);
  return full.length <= 7 ? full : moneyCompact(value);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function fetchBalance(): Promise<number> {
  const { data } = await api.get<BalanceResponse>('/wallet/balance');
  return data.balance;
}

async function fetchWheel(): Promise<WheelConfig> {
  const { data } = await api.get<WheelConfig>('/game/roulette/segments');
  return data;
}

export default function Roulette() {
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);

  const [amount, setAmount] = useState(String(DEFAULT_BET));
  const [wheel, setWheel] = useState<WheelConfig | null>(null);
  const segments = wheel?.segments ?? FALLBACK_SEGMENTS;

  const [result, setResult] = useState<SpinResult | null>(null);
  const [history, setHistory] = useState<SpinResult[]>([]);
  const [isSpinning, setIsSpinning] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Rotation state: `turns` only grows so every spin travels in the same
  // direction; `landingIndex` is the segment the server picked.
  const [turns, setTurns] = useState(0);
  const [landingIndex, setLandingIndex] = useState(0);

  const segmentDeg = 360 / segments.length;
  const wheelRotation = -(turns * TURNS_PER_SPIN * 360) - landingIndex * segmentDeg;

  const wheelBackground = useMemo(() => {
    const step = 360 / segments.length;
    const stops = segments
      .map(
        (multiplier, index) =>
          `${segmentFill(multiplier, index)} ${index * step}deg ${(index + 1) * step}deg`,
      )
      .join(', ');

    // Starting half a segment early keeps slice i centred on i * step, which is
    // where its label sits and where the pointer lands.
    return `conic-gradient(from ${-step / 2}deg, ${stops})`;
  }, [segments]);

  const refreshBalance = useCallback(async () => {
    try {
      setBalance(await fetchBalance());
      setBalanceError(null);
    } catch (requestError) {
      setBalanceError(getApiErrorMessage(requestError, 'Could not load your balance.'));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
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

    async function loadWheel() {
      try {
        const config = await fetchWheel();
        if (!cancelled && config.segments.length > 0) {
          setWheel(config);
        }
      } catch {
        // The fallback table matches the backend; the game still works.
      }
    }

    void load();
    void loadWheel();

    return () => {
      cancelled = true;
    };
  }, []);

  // Escape closes the result overlay.
  useEffect(() => {
    if (!showResult) {
      return;
    }

    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setShowResult(false);
      }
    }

    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [showResult]);

  async function handleSpin() {
    if (isSpinning) {
      return;
    }

    setError(null);

    const stakeAmount = Number(amount);
    if (!Number.isFinite(stakeAmount) || stakeAmount <= 0) {
      setError('Enter a bet amount greater than 0.');
      return;
    }

    setIsSpinning(true);
    setShowResult(false);

    try {
      // The API settles the stake; the rotation below is only presentation.
      const [response] = await Promise.all([
        api.post<SpinResult>('/game/roulette/play', { betAmount: stakeAmount }),
        delay(320),
      ]);

      const data = response.data;
      setResult(data);
      setLandingIndex(data.segmentIndex);
      setTurns((previous) => previous + 1);
      setHistory((previous) => [data, ...previous].slice(0, HISTORY_LIMIT));

      // Ticking for as long as the wheel actually spins.
      playSound('spin', { durationMs: SPIN_DURATION_MS });

      // Let the wheel finish its CSS transition before revealing the card.
      await delay(SPIN_DURATION_MS);
      setBalance(data.balanceAfter);
      setShowResult(true);
      playSound(data.won ? 'win' : 'lose');
      void refreshBalance();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'The spin could not be placed.'));
      void refreshBalance();
    } finally {
      setIsSpinning(false);
    }
  }

  const balanceLabel = balance === null ? '···' : `$${balance.toFixed(2)}`;
  const stake = Number(amount) || 0;

  // Paytable: the distinct multipliers on the wheel. No odds are shown — the
  // player only needs to know what a slice pays, not how likely it is.
  const multipliers = useMemo(
    () => [...new Set(segments)].sort((a, b) => a - b),
    [segments],
  );
  const topMultiplier = multipliers[multipliers.length - 1] ?? 0;

  // Every label on screen is a dollar amount for the *current* stake, so the
  // wheel updates live as the player changes their bet. An empty input falls
  // back to DEFAULT_BET instead of showing "$0" everywhere.
  const previewStake = stake > 0 ? stake : DEFAULT_BET;
  const topPayout = previewStake * topMultiplier;

  return (
    <div className="rt">
      <header className="rt__topbar">
        <Link to="/" className="rt__back">
          <ArrowLeftIcon className="icon icon--sm" />
          Back to Lobby
        </Link>

        <h1 className="rt__title">Spin to Win</h1>

        <SoundToggle />

        <LivePlayerBadge baseCount={3800} />

        <span
          className={`balance-pill${balanceError ? ' balance-pill--error' : ''}`}
          title={balanceError ?? 'Current balance'}
        >
          <WalletIcon className="icon icon--sm" />
          {balanceLabel}
        </span>
      </header>

      <main className="rt__body">
        <section className="rt__stage">
          <div className="history" aria-label="Recent spins">
            <span className="history__label">Last</span>
            {history.length === 0 ? (
              <span className="history__empty">no spins yet</span>
            ) : (
              history.map((entry, index) => (
                <span
                  key={`${entry.roundId}-${index}`}
                  className={`dot dot--${entry.segmentColor}`}
                  title={`${multiplierLabel(entry.multiplier)} · paid ${money(entry.payout)}`}
                >
                  {moneyCompact(entry.payout)}
                </span>
              ))
            )}
          </div>

          <div className={`wheel-wrap${isSpinning ? ' wheel-wrap--spinning' : ''}`}>
            <div className="wheel-pointer" aria-hidden="true" />
            <div
              className="wheel"
              style={{ backgroundImage: wheelBackground, transform: `rotate(${wheelRotation}deg)` }}
              role="img"
              aria-label={
                result
                  ? `Wheel stopped on ${money(result.payout)}`
                  : 'Prize wheel with 20 segments'
              }
            >
              <div className="wheel__labels" aria-hidden="true">
                {segments.map((multiplier, index) => (
                  <div
                    key={index}
                    className="wheel__label-slot"
                    style={{ transform: `rotate(${index * segmentDeg}deg)` }}
                  >
                    <span
                      className={`wheel__label wheel__label--${colorOf(multiplier)}`}
                    >
                      {moneyCompact(previewStake * multiplier)}
                    </span>
                  </div>
                ))}
              </div>

              <span
                className="wheel__hub"
                style={{ transform: `translate(-50%, -50%) rotate(${-wheelRotation}deg)` }}
              >
                {isSpinning ? '…' : result ? moneyFit(result.payout) : 'SPIN'}
              </span>
            </div>
          </div>

          <p className="rt__fair">
            Provably fair · seed hash published before every spin
          </p>
          {balanceError && <p className="error">{balanceError}</p>}
        </section>

        <aside className="rt__panel">
          <div className="panel-block">
            <div className="panel-label">
              Bet amount
              <span className="panel-value">${stake.toFixed(2)}</span>
            </div>
            <div className="chips">
              {CHIPS.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  className={`chip${stake === chip ? ' chip--active' : ''}`}
                  onClick={() => setAmount(String(chip))}
                  disabled={isSpinning}
                  aria-pressed={stake === chip}
                >
                  ${chip}
                </button>
              ))}
              <input
                className="chips__custom"
                type="number"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                min={0.5}
                step={0.5}
                disabled={isSpinning}
                aria-label="Custom bet amount"
              />
            </div>
            <p className="rt__meta rt__meta--left">
              Change your bet and every slice updates.
            </p>
          </div>

          <div className="panel-block">
            <div className="panel-label">
              Paytable
              <span className="panel-value">up to {money(topPayout)}</span>
            </div>
            <div className="payout">
              {multipliers.map((multiplier) => (
                <span
                  key={multiplier}
                  className={`payout__amount payout__amount--${colorOf(multiplier)}`}
                >
                  {money(previewStake * multiplier)}
                </span>
              ))}
            </div>
            <p className="rt__meta rt__meta--left">
              Payouts shown for your {money(previewStake)} bet.
            </p>
          </div>

          <button
            type="button"
            className={`spin${isSpinning ? ' spin--busy' : ''}`}
            onClick={() => void handleSpin()}
            disabled={isSpinning}
          >
            {isSpinning ? 'SPINNING…' : 'SPIN'}
          </button>

          {error && <p className="error">{error}</p>}

          <p className="rt__meta">
            {result
              ? `Round ${result.roundId.slice(0, 8)} · seed ${result.serverSeedHash.slice(0, 12)}…`
              : 'The server publishes a seed hash before every round'}
          </p>
        </aside>

        {showResult && result && (
          <div className="result-overlay" role="dialog" aria-modal="true" aria-labelledby="rt-result">
            <button
              type="button"
              className="result-overlay__backdrop"
              aria-label="Close result"
              onClick={() => setShowResult(false)}
            />
            <div
              className={`result-card${result.won ? ' result-card--win' : ' result-card--lose'}`}
            >
              <p className="result-card__kicker" id="rt-result">
                {result.won ? 'You won!' : 'Better luck next time!'}
              </p>

              <div className={`result-card__mult result-card__mult--${result.segmentColor}`}>
                {multiplierLabel(result.multiplier)}
              </div>
              <p className="result-card__color">{result.segmentColor.toUpperCase()} SEGMENT</p>

              <p className="result-card__amount">
                {result.won
                  ? `+$${result.payout.toFixed(2)}`
                  : `-$${result.betAmount.toFixed(2)}`}
              </p>
              <p className="result-card__sub">
                {result.won
                  ? `$${result.betAmount.toFixed(2)} bet × ${result.multiplier} = $${result.payout.toFixed(2)}`
                  : `$${result.betAmount.toFixed(2)} bet · the wheel stopped on 0×`}
              </p>

              <div className="result-card__actions">
                <button
                  type="button"
                  className="button-primary"
                  onClick={() => setShowResult(false)}
                >
                  Spin again
                </button>
                <Link to="/" className="button-secondary">
                  Lobby
                </Link>
              </div>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}



