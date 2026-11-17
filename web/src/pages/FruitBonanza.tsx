import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { api, getApiErrorMessage } from '../api/client';
import type {
  BalanceResponse,
  FruitBonanzaConfig,
  FruitBonanzaResult,
  FruitLineResult,
} from '../api/types';
import { ArrowLeftIcon, WalletIcon } from '../components/Icons';
import { LivePlayerBadge } from '../components/LivePlayerBadge';
import { SoundToggle } from '../components/SoundToggle';
import { WinModal } from '../components/WinModal';
import { playSound } from '../utils/sound';

/**
 * Fruit Bonanza — 3×3 fruit reels with five paylines (three rows, two diagonals).
 *
 * The server settles the spin; this page only replays it: all nine reels roll for
 * ~1.5 s, then stop left-to-right, top-to-bottom, 110 ms apart, revealing the
 * returned grid. Every cell of a paying line then glows, and the panel lists the
 * lines that paid with their symbols and multipliers.
 *
 * The paylines are drawn straight from `GET /config`, so the cabinet can never
 * disagree with the table the server settles on.
 */

const CHIPS = [1, 5, 10, 25, 50];
const DEFAULT_BET = 5;
/** How long every reel rolls before the first one stops. */
const SPIN_MS = 1500;
/** Gap between one reel stopping and the next. */
const STAGGER_MS = 110;
/** Faces in the rolling strip of each reel. */
const STRIP_LENGTH = 4;
/**
 * Each reel rolls at its own speed: nine reels moving in perfect lockstep is
 * what makes a slot look mechanical, so every spin re-rolls 260–360 ms.
 */
const ROLL_MS_MIN = 260;
const ROLL_MS_MAX = 360;

const FALLBACK_SYMBOLS = ['🍉', '🍇', '🍋', '🍒', '🍊', '⭐'];

/** Used only if `/config` fails — mirrors the backend table. */
const FALLBACK_CONFIG: FruitBonanzaConfig = {
  symbols: FALLBACK_SYMBOLS,
  lines: [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 4, 8],
    [2, 4, 6],
  ],
  cells: 9,
  lineCount: 5,
  pays: { three: 4, two: 0.2 },
  rtp: 35 / 36,
  houseEdge: 1 / 36,
  probabilities: { three: 1 / 36, two: 5 / 12, none: 5 / 9 },
};

/** Human names for the five lines, in config order. */
const LINE_NAMES = ['Top row', 'Middle row', 'Bottom row', 'Diagonal ↘', 'Diagonal ↙'];

function money(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  const digits = rounded % 1 === 0 ? 0 : 2;

  return `$${rounded.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: 2,
  })}`;
}

function multiplierLabel(value: number): string {
  return `${Math.round(value * 100) / 100}×`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

/** A random grid to show before the first spin. */
function randomGrid(symbols: readonly string[]): string[] {
  return Array.from({ length: 9 }, () => symbols[Math.floor(Math.random() * symbols.length)]);
}

/** Four random glyphs: the strip that scrolls past while a reel is spinning. */
function randomStrip(symbols: readonly string[]): string[] {
  return Array.from(
    { length: STRIP_LENGTH },
    () => symbols[Math.floor(Math.random() * symbols.length)],
  );
}

/** One roll duration per reel, in milliseconds. */
function randomRollSpeeds(): number[] {
  return Array.from({ length: 9 }, () =>
    Math.round(ROLL_MS_MIN + Math.random() * (ROLL_MS_MAX - ROLL_MS_MIN)),
  );
}

/** Cells belonging to a paying line, de-duplicated across lines. */
function winningCells(lines: readonly FruitLineResult[]): Set<number> {
  const cells = new Set<number>();
  for (const line of lines) {
    if (line.multiplier > 0) {
      for (const cell of line.cells) cells.add(cell);
    }
  }

  return cells;
}

async function fetchBalance(): Promise<number> {
  const { data } = await api.get<BalanceResponse>('/wallet/balance');
  return data.balance;
}

async function fetchConfig(): Promise<FruitBonanzaConfig> {
  const { data } = await api.get<FruitBonanzaConfig>('/game/fruit_bonanza/config');
  return data;
}

export default function FruitBonanza() {
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);

  const [amount, setAmount] = useState(String(DEFAULT_BET));
  const [config, setConfig] = useState<FruitBonanzaConfig>(FALLBACK_CONFIG);

  const [grid, setGrid] = useState<string[]>(() => randomGrid(FALLBACK_SYMBOLS));
  const [strips, setStrips] = useState<string[][]>(() =>
    Array.from({ length: 9 }, () => randomStrip(FALLBACK_SYMBOLS)),
  );
  const [rollSpeeds, setRollSpeeds] = useState<number[]>(randomRollSpeeds);
  const [settled, setSettled] = useState<boolean[]>(() => Array(9).fill(true));

  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<FruitBonanzaResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Celebration dialog (shared with Showdown), shown once the reels settle.
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [winAmount, setWinAmount] = useState(0);

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
        if (cancelled) return;

        setConfig(next);
        // Re-seed the idle cabinet with the real symbol set.
        setGrid(randomGrid(next.symbols));
        setStrips(Array.from({ length: 9 }, () => randomStrip(next.symbols)));
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
  const pays = config.pays;

  /** Roll every reel, then stop them one by one on the settled grid. */
  async function spin(): Promise<void> {
    if (spinning) return;

    if (validStake <= 0) {
      setError('Enter a bet amount greater than 0.');
      return;
    }

    setSpinning(true);
    setError(null);
    setResult(null);
    setIsModalOpen(false);

    // Start rolling immediately, so the click feels instant; the request runs
    // underneath and the stop schedule is measured from this moment.
    const startedAt = performance.now();
    setSettled(Array(9).fill(false));
    setStrips(Array.from({ length: 9 }, () => randomStrip(config.symbols)));
    setRollSpeeds(randomRollSpeeds());
    playSound('click');
    playSound('spin', { durationMs: SPIN_MS + STAGGER_MS * 9 });

    try {
      const { data } = await api.post<FruitBonanzaResult>('/game/fruit_bonanza/play', {
        betAmount: validStake,
      });

      setBalance(data.balanceAfter);

      // Hold every reel at full speed until the reels have rolled ~1.5 s…
      await delay(Math.max(0, SPIN_MS - (performance.now() - startedAt)));

      // …then they lock left-to-right, top-to-bottom.
      for (let cell = 0; cell < 9; cell += 1) {
        if (unmounted.current) return;

        const symbol = data.grid[cell];
        setGrid((previous) => {
          const next = [...previous];
          next[cell] = symbol;
          return next;
        });
        setSettled((previous) => {
          const next = [...previous];
          next[cell] = true;
          return next;
        });

        if (cell < 8) await delay(STAGGER_MS);
      }

      if (unmounted.current) return;

      setResult(data);
      playSound(data.payout > 0 ? 'win' : 'lose');

      if (data.payout > 0) {
        setWinAmount(data.payout);
        setIsModalOpen(true);
      }
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'The spin could not be completed.'));
      setSettled(Array(9).fill(true));
      void refreshBalance();
    } finally {
      if (!unmounted.current) setSpinning(false);
    }
  }

  const glow = result ? winningCells(result.lines) : new Set<number>();

  return (
    <div className="rt">
      <header className="rt__topbar">
        <Link to="/" className="rt__back">
          <ArrowLeftIcon className="icon icon--sm" />
          Back to Lobby
        </Link>

        <h1 className="rt__title">Fruit Bonanza 🍉</h1>

        <SoundToggle />

        <LivePlayerBadge baseCount={2800} />

        <span
          className={`balance-pill${balanceError ? ' balance-pill--error' : ''}`}
          title={balanceError ?? 'Current balance'}
        >
          <WalletIcon className="icon icon--sm" />
          {balanceLabel}
        </span>
      </header>

      <main className="rt__body">
        <section className="rt__stage fb__stage">
          <div className="fb-cabinet">
            <div className="fb-cabinet__header">
              <span className="fb-cabinet__brand">🍉 Fruit Bonanza</span>
              <span className="fb-cabinet__lines">{config.lineCount} paylines</span>
            </div>

            <div
              className={`fb-grid${spinning ? ' fb-grid--spinning' : ''}`}
              role="img"
              aria-label={`Reel grid: ${grid.join(' ')}`}
            >
              {grid.map((symbol, cell) => {
                const isSettled = settled[cell];
                const isWinning = isSettled && glow.has(cell);

                return (
                  <div
                    key={cell}
                    className={`fb-cell${isWinning ? ' fb-cell--win' : ''}${
                      isSettled ? '' : ' fb-cell--rolling'
                    }`}
                  >
                    {isSettled ? (
                      <span className="fb-cell__symbol">{symbol}</span>
                    ) : (
                      <span
                        className="fb-strip fb-reel--spinning"
                        style={{ animationDuration: `${rollSpeeds[cell]}ms` }}
                        aria-hidden="true"
                      >
                        {/* First face repeated last: the roll loops seamlessly. */}
                        {[...strips[cell], strips[cell][0]].map((face, index) => (
                          <span key={index} className="fb-strip__face">
                            {face}
                          </span>
                        ))}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="fb-paylines">
              {LINE_NAMES.map((name, index) => (
                <span
                  key={name}
                  className={`fb-payline${
                    result?.winningLines.includes(index) ? ' fb-payline--lit' : ''
                  }`}
                >
                  {name}
                </span>
              ))}
            </div>
          </div>
        </section>

        <aside className="rt__panel">
          <div className="panel-block">
            <div className="panel-label">
              Bet amount
              <span className="panel-value">{money(validStake)}</span>
            </div>
            <div className="chips">
              {CHIPS.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  className={`chip${validStake === chip ? ' chip--active' : ''}`}
                  onClick={() => {
                    playSound('click');
                    setAmount(String(chip));
                  }}
                  disabled={spinning}
                  aria-pressed={validStake === chip}
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
                disabled={spinning}
                aria-label="Custom bet amount"
              />
            </div>
          </div>

          <div className="panel-block">
            <div className="panel-label">
              Paytable
              <span className="panel-value">{config.lineCount} lines</span>
            </div>
            <ul className="fb-paytable">
              <li>
                <span>3 of a kind</span>
                <strong>{multiplierLabel(pays.three)}</strong>
              </li>
              <li>
                <span>2 of a kind</span>
                <strong>{multiplierLabel(pays.two)}</strong>
              </li>
            </ul>
            <p className="rt__meta rt__meta--left">
              Every winning line pays on the full bet.
            </p>
          </div>

          <button
            type="button"
            className="aviator-action"
            onClick={() => void spin()}
            disabled={spinning || validStake <= 0}
          >
            <span className="aviator-action__title">{spinning ? 'SPINNING…' : 'SPIN'}</span>
            <span className="aviator-action__sub">
              {money(validStake)} · {config.lineCount} paylines
            </span>
          </button>

          {error && <p className="error">{error}</p>}

          <p className="rt__meta">
            RTP {(config.rtp * 100).toFixed(2)}% · house edge{' '}
            {(config.houseEdge * 100).toFixed(2)}%
          </p>

          <p className="rt__meta">
            {result
              ? `Round ${result.roundId.slice(0, 8)} · seed ${result.serverSeedHash.slice(0, 12)}…`
              : 'Provably fair · one committed seed per spin'}
          </p>
        </aside>
      </main>

      {/* Same auto-dismissing celebration Showdown uses (closes itself). */}
      <WinModal
        isOpen={isModalOpen}
        winAmount={winAmount}
        onClose={() => setIsModalOpen(false)}
      />
    </div>
  );
}
