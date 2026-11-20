import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { api, getApiErrorMessage } from '../api/client';
import type { BalanceResponse, SegmentColor, SpinResult, WheelConfig } from '../api/types';
import { ArrowLeftIcon, WalletIcon } from '../components/Icons';
import { GameBottomBar } from '../components/GameBottomBar';
import { GameResultOverlay } from '../components/GameResultOverlay';
import { LivePlayerBadge } from '../components/LivePlayerBadge';
import { SoundToggle } from '../components/SoundToggle';
import { useAudio } from '../context/audio-context';
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

/** Wheel/paytable preview stake used until the player enters one. */
const DEFAULT_BET = 10;
/** Must match the transform transition on `.wheel` so the card lands on stop. */
const SPIN_DURATION_MS = 3600;
/** One extra full turn per spin so the wheel always feels like it travels. */
const TURNS_PER_SPIN = 4;

/** Used only if the config request fails — mirrors the backend table. */
const FALLBACK_SEGMENTS: readonly number[] = [
  10, 0, 0.5, 0, 0, 2, 0, 0.5, 0, 0, 3, 0, 0.5, 0, 0, 1, 0, 0.5, 0, 0,
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
  const [isSpinning, setIsSpinning] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Rotation state: `turns` only grows so every spin travels in the same
  // direction; `landingIndex` is the segment the server picked.
  const [turns, setTurns] = useState(0);
  const [landingIndex, setLandingIndex] = useState(0);

  // Background music: a looping bed starts on arrival and stops on leave.
  const { playBgTrack, stopBgTrack } = useAudio();

  useEffect(() => {
    playBgTrack('/audio/spin-to-win-bgm.mp3', { loop: true, volume: 0.5 });
    return () => stopBgTrack();
  }, [playBgTrack, stopBgTrack]);

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

    if (balance !== null && stakeAmount > balance) {
      setError(`Insufficient balance. Your balance is ${money(balance)}.`);
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

  // Every label on the wheel is a dollar amount for the *current* stake, so the
  // wheel updates live as the player changes their bet.
  const previewStake = stake > 0 ? stake : DEFAULT_BET;

  return (
    <div className="phone-stage">
      <div className="phone-frame">
        <div className="rt rt--spin">
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

          {error && <p className="error">{error}</p>}
          {balanceError && <p className="error">{balanceError}</p>}
        </section>

        {result && (
          <GameResultOverlay
            isOpen={showResult}
            isWin={result.won}
            amount={result.won ? result.payout : result.betAmount}
            multiplier={result.multiplier}
            detail={
              result.won
                ? `$${result.betAmount.toFixed(2)} bet × ${result.multiplier} = $${result.payout.toFixed(2)}`
                : `$${result.betAmount.toFixed(2)} bet · the wheel stopped on 0×`
            }
            onClose={() => setShowResult(false)}
          />
        )}

      </main>

      <footer className="rt__dock">
        <GameBottomBar
          betAmount={previewStake}
          onBetChange={(value) => setAmount(String(value))}
          onPlay={() => void handleSpin()}
          playLabel="SPIN"
          isPlaying={isSpinning}
        />
      </footer>
    </div>
      </div>
    </div>
  );
}



