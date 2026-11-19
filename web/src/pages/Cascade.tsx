import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { api, getApiErrorMessage } from '../api/client';
import type { BalanceResponse, CascadeConfig, CascadeResult, CascadeSymbolId } from '../api/types';
import { ArrowLeftIcon, WalletIcon } from '../components/Icons';
import { LivePlayerBadge } from '../components/LivePlayerBadge';
import { SoundToggle } from '../components/SoundToggle';
import { GameBottomBar } from '../components/GameBottomBar';
import { WinModal } from '../components/WinModal';
import { playSound } from '../utils/sound';

/**
 * Showdown — a 5×4 cascading cluster-pays slot.
 *
 * The server settles the whole chain in one call: it returns the opening grid and
 * one entry per cascade (the grid that won, the clusters that paid, the cells it
 * cleared, and the multiplier for that step). This page just replays it —
 * symbols fall in, winning clusters glow, they pop out, the survivors drop and
 * new symbols fall in — so what you see is exactly what was paid.
 *
 * Cascades multiply: ×1, ×2, ×4, ×8, ×16, up to five steps.
 */

/** Preview stake used before the player types one. */
const DEFAULT_BET = 5;

/** Replay timings (ms). */
const FALL_MS = 420;
const WIN_MS = 430;
const CLEAR_MS = 240;
const DROP_MS = 340;

/** Used only if the config request fails — mirrors the backend paytable. */
const FALLBACK_CONFIG: CascadeConfig = {
  cols: 5,
  rows: 4,
  cells: 20,
  minCluster: 3,
  maxCascades: 5,
  multipliers: [1, 2, 4, 8, 16],
  symbols: [
    { id: 'WHISKEY', glyph: '🥃' },
    { id: 'HAT', glyph: '🤠' },
    { id: 'GUN', glyph: '🔫' },
    { id: 'HORSE', glyph: '🐎' },
    { id: 'BADGE', glyph: '⭐' },
    { id: 'DYNAMITE', glyph: '💥' },
    { id: 'FIRE', glyph: '🔥' },
  ],
  pays: {
    WHISKEY: [0.06, 0.12, 0.25, 0.47, 0.82, 1.4],
    HAT: [0.07, 0.15, 0.3, 0.59, 1.07, 1.75],
    GUN: [0.09, 0.19, 0.37, 0.72, 1.28, 2.13],
    HORSE: [0.12, 0.25, 0.47, 0.94, 1.63, 2.57],
    BADGE: [0.16, 0.31, 0.59, 1.19, 2.13, 3.51],
    DYNAMITE: [0.34, 0.72, 1.4, 2.82, 4.69, 7.64],
    FIRE: [0.59, 1.19, 2.35, 4.69, 8.2, 14.08],
  },
  rtp: 0.9572,
  rtpRounds: 3_000_000,
};

const GLYPHS: Record<CascadeSymbolId, string> = {
  WHISKEY: '🥃',
  HAT: '🤠',
  GUN: '🔫',
  HORSE: '🐎',
  BADGE: '⭐',
  DYNAMITE: '💥',
  FIRE: '🔥',
};

/** A fresh grid for the idle cabinet, so it never looks empty (no 3-runs). */
const IDLE_GRID: CascadeSymbolId[] = [
  'WHISKEY', 'HAT', 'GUN', 'BADGE', 'HORSE',
  'GUN', 'BADGE', 'HORSE', 'DYNAMITE', 'HAT',
  'HAT', 'HORSE', 'WHISKEY', 'GUN', 'WHISKEY',
  'BADGE', 'DYNAMITE', 'WHISKEY', 'HAT', 'HORSE',
];

type Phase = 'idle' | 'falling' | 'winning' | 'clearing' | 'dropping' | 'done';

function money(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  const fractionDigits = rounded % 1 === 0 ? 0 : 2;

  return `$${rounded.toLocaleString('en-US', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: 2,
  })}`;
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

async function fetchConfig(): Promise<CascadeConfig> {
  const { data } = await api.get<CascadeConfig>('/game/cascade/config');
  return data;
}

export default function Cascade() {
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);

  const [amount, setAmount] = useState(String(DEFAULT_BET));
  const [config, setConfig] = useState<CascadeConfig>(FALLBACK_CONFIG);

  const [board, setBoard] = useState<CascadeSymbolId[]>(IDLE_GRID);
  /** Bumped whenever the board is replaced, so the CSS animation restarts. */
  const [boardKey, setBoardKey] = useState(0);
  const [phase, setPhase] = useState<Phase>('idle');
  const [winning, setWinning] = useState<Set<number>>(new Set());
  const [activeStep, setActiveStep] = useState(-1);
  const [result, setResult] = useState<CascadeResult | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Set when the page unmounts so a half-finished replay stops writing state. */
  const unmounted = useRef(false);

  useEffect(() => {
    unmounted.current = false;
    return () => {
      unmounted.current = true;
    };
  }, []);

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
        if (!cancelled) setBalance(value);
      } catch (requestError) {
        if (!cancelled) {
          setBalanceError(getApiErrorMessage(requestError, 'Could not load your balance.'));
        }
      }

      try {
        const next = await fetchConfig();
        if (!cancelled) setConfig(next);
      } catch {
        // Keep FALLBACK_CONFIG — the cabinet still works with the mirrored table.
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  const stake = Number(amount);
  const validStake = Number.isFinite(stake) && stake > 0 ? Math.round(stake * 100) / 100 : 0;
  const balanceLabel = balance === null ? '—' : money(balance);

  /** Multiplier currently in play (1× before the first cascade resolves). */
  const currentMultiplier =
    activeStep >= 0 && result ? result.steps[activeStep]?.multiplier ?? 1 : 1;

  function showBoard(grid: CascadeSymbolId[]) {
    setBoard(grid);
    setBoardKey((key) => key + 1);
  }

  async function spin() {
    if (spinning) return;

    if (validStake <= 0) {
      setError('Enter a bet amount greater than 0.');
      return;
    }

    setSpinning(true);
    setError(null);
    setResult(null);
    setModalOpen(false);
    setActiveStep(-1);
    setWinning(new Set());
    playSound('click');

    try {
      const { data } = await api.post<CascadeResult>('/game/cascade/play', {
        betAmount: validStake,
      });

      setBalance(data.balanceAfter);

      // 1. The opening grid falls in.
      setPhase('falling');
      showBoard(data.grid);
      await delay(FALL_MS);
      if (unmounted.current) return;

      // 2. Replay each cascade: glow → pop → drop → refill.
      for (let index = 0; index < data.steps.length; index += 1) {
        const step = data.steps[index]!;

        setResult(data);
        setActiveStep(index);
        setWinning(new Set(step.clusters.flatMap((cluster) => cluster.cells)));
        setPhase('winning');
        playSound('click');
        await delay(WIN_MS);
        if (unmounted.current) return;

        setPhase('clearing');
        setWinning(new Set(step.removed));
        await delay(CLEAR_MS);
        if (unmounted.current) return;

        const nextGrid =
          index + 1 < data.steps.length ? data.steps[index + 1]!.grid : data.finalGrid;

        setPhase('dropping');
        setWinning(new Set());
        showBoard(nextGrid);
        await delay(DROP_MS);
        if (unmounted.current) return;
      }

      // 3. Settle.
      setPhase('done');
      setActiveStep(-1);
      setResult(data);
      playSound(data.payout > 0 ? 'win' : 'lose');

      // Celebrate every win, however small — the dialog is part of the loop.
      if (data.payout > 0) setModalOpen(true);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'The spin could not be completed.'));
      setPhase('idle');
      void refreshBalance();
    } finally {
      if (!unmounted.current) setSpinning(false);
    }
  }

  function closeWinModal(): void {
    setModalOpen(false);
  }

  const statusText =
    phase === 'falling'
      ? 'Spinning…'
      : phase === 'winning'
        ? `Cascade ${activeStep + 1} · ${currentMultiplier}× multiplier`
        : phase === 'clearing'
          ? 'Clearing the winning clusters…'
          : phase === 'dropping'
            ? 'Dropping in…'
            : phase === 'done'
              ? result && result.totalWin > 0
                ? `${result.cascadeCount} cascade${result.cascadeCount === 1 ? '' : 's'} · paid ${money(result.payout)}`
                : 'No cluster this spin'
              : 'Press SPIN to play';

  return (
    <div className="rt rt--cascade">
      <header className="rt__topbar">
        <Link to="/" className="rt__back">
          <ArrowLeftIcon className="icon icon--sm" />
          Back to Lobby
        </Link>

        <h1 className="rt__title">Showdown 🤠</h1>

        <SoundToggle />

        <LivePlayerBadge baseCount={4200} />

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
          <div className={`cs-cabinet cs-cabinet--${phase}`}>
            <div className="cs-multipliers" aria-label="Cascade multipliers">
              {config.multipliers.map((multiplier, index) => (
                <span
                  key={multiplier}
                  className={`cs-multiplier${
                    index === activeStep
                      ? ' cs-multiplier--active'
                      : index < activeStep
                        ? ' cs-multiplier--used'
                        : ''
                  }`}
                  aria-current={index === activeStep ? 'step' : undefined}
                >
                  {multiplier}×
                </span>
              ))}
            </div>

            <div
              className="cs-grid"
              key={boardKey}
              style={{ gridTemplateColumns: `repeat(${config.cols}, minmax(0, 1fr))` }}
              role="img"
              aria-label={`${config.cols} by ${config.rows} grid`}
            >
              {board.map((symbol, index) => {
                const col = index % config.cols;
                const isWinning = winning.has(index);
                const classes = [
                  'cs-tile',
                  `cs-tile--${symbol.toLowerCase()}`,
                  phase === 'falling' || phase === 'dropping' ? 'cs-tile--fall' : '',
                  isWinning ? 'cs-tile--win' : '',
                  isWinning && phase === 'clearing' ? 'cs-tile--clear' : '',
                ]
                  .filter(Boolean)
                  .join(' ');

                return (
                  <div
                    key={`${boardKey}-${index}`}
                    className={classes}
                    style={{
                      animationDelay: `${col * 26 + Math.floor(index / config.cols) * 14}ms`,
                    }}
                  >
                    <span className="cs-tile__glyph">{GLYPHS[symbol]}</span>
                  </div>
                );
              })}
            </div>

            <p
              className={`cs-status${
                phase === 'done' && result && result.totalWin > 0 ? ' cs-status--win' : ''
              }`}
            >
              {statusText}
            </p>
          </div>

          {error && <p className="error">{error}</p>}
        </section>
      </main>

      <footer className="rt__dock">
        <GameBottomBar
          betAmount={validStake}
          onBetChange={(value) => setAmount(String(value))}
          onPlay={() => void spin()}
          playLabel="SPIN"
          isPlaying={spinning}
        />
      </footer>

      <WinModal isOpen={modalOpen} winAmount={result?.payout ?? 0} onClose={closeWinModal} />
    </div>
  );
}
