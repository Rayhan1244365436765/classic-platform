import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';

import { api, getApiErrorMessage } from '../api/client';
import type { BalanceResponse, BoxingKingConfig, BoxingKingResult } from '../api/types';
import { ArrowLeftIcon, WalletIcon } from '../components/Icons';
import { LivePlayerBadge } from '../components/LivePlayerBadge';
import { SoundToggle } from '../components/SoundToggle';
import { WinModal } from '../components/WinModal';
import { playSound } from '../utils/sound';

/**
 * Boxing King — a 3×3 cluster-pays slot in a boxing ring.
 *
 * The server settles the spin; this page replays it: the nine reels roll for
 * ~1.5 s, lock one by one, then every node of a paying cluster throws a punch
 * (scale + shake + red glow). A cluster of 5+ also sets off the spark burst.
 */

const CHIPS = [1, 5, 10, 25, 50];
const DEFAULT_BET = 5;
/** How long all nine reels roll before the first one locks. */
const SPIN_MS = 1500;
/** Gap between one reel locking and the next. */
const STAGGER_MS = 110;
/** Faces in the rolling strip of each reel. */
const STRIP_LENGTH = 4;
/** Sparks live this long after a big hit. */
const SPARK_MS = 1400;
const SPARKS = 18;

const FALLBACK_SYMBOLS = ['🥊', '🏆', '🤴', '💪', '💥', '🩳'];

const FALLBACK_CONFIG: BoxingKingConfig = {
  symbols: FALLBACK_SYMBOLS,
  cells: 9,
  outcomes: 6 ** 9,
  minCluster: 3,
  pays: { small: 2, medium: 8.5, large: 30 },
  frequency: { small: 0.380295, medium: 0.023354, large: 0.000504 },
  hitRate: 0.378676,
  rtp: 0.974219,
  houseEdge: 0.025781,
};

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

/** Money maths to the cent, before formatting. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function randomGrid(symbols: readonly string[]): string[] {
  return Array.from({ length: 9 }, () => symbols[Math.floor(Math.random() * symbols.length)]);
}

function randomStrip(symbols: readonly string[]): string[] {
  return Array.from(
    { length: STRIP_LENGTH },
    () => symbols[Math.floor(Math.random() * symbols.length)],
  );
}

/** One roll duration per reel, so the nine never spin in lockstep. */
function randomRollSpeeds(): number[] {
  return Array.from({ length: 9 }, () => Math.round(260 + Math.random() * 100));
}

/** Spark geometry, re-rolled for every big hit. */
function randomSparks(): CSSProperties[] {
  return Array.from({ length: SPARKS }, () => {
    const angle = Math.random() * Math.PI * 2;
    const distance = 70 + Math.random() * 120;

    return {
      '--spark-x': `${Math.cos(angle) * distance}px`,
      '--spark-y': `${Math.sin(angle) * distance}px`,
      '--spark-delay': `${Math.random() * 0.15}s`,
      '--spark-size': `${4 + Math.random() * 6}px`,
    } as CSSProperties;
  });
}

async function fetchBalance(): Promise<number> {
  const { data } = await api.get<BalanceResponse>('/wallet/balance');
  return data.balance;
}

async function fetchConfig(): Promise<BoxingKingConfig> {
  const { data } = await api.get<BoxingKingConfig>('/game/boxing_king/config');
  return data;
}

export default function BoxingKing() {
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);

  const [amount, setAmount] = useState(String(DEFAULT_BET));
  const [config, setConfig] = useState<BoxingKingConfig>(FALLBACK_CONFIG);

  const [grid, setGrid] = useState<string[]>(() => randomGrid(FALLBACK_SYMBOLS));
  const [strips, setStrips] = useState<string[][]>(() =>
    Array.from({ length: 9 }, () => randomStrip(FALLBACK_SYMBOLS)),
  );
  const [rollSpeeds, setRollSpeeds] = useState<number[]>(randomRollSpeeds);
  const [settled, setSettled] = useState<boolean[]>(() => Array(9).fill(true));

  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<BoxingKingResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sparks, setSparks] = useState<CSSProperties[] | null>(null);
  /**
   * The stage curtains start closed and are raised by the first FIGHT, then left
   * open — the reveal is a one-off for this visit, not a per-spin animation.
   */
  const [isCurtainOpen, setIsCurtainOpen] = useState(false);

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
        setGrid(randomGrid(next.symbols));
        setStrips(Array.from({ length: 9 }, () => randomStrip(next.symbols)));
      } catch {
        // Keep FALLBACK_CONFIG — the ring still works with the mirrored paytable.
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
  const winningCells = new Set(result?.winningCells ?? []);

  // What each cluster size actually pays at the current stake.
  const winSmall = round2(validStake * config.pays.small);
  const winMedium = round2(validStake * config.pays.medium);
  const winLarge = round2(validStake * config.pays.large);

  /** Roll every reel, lock them one by one, then punch the clusters. */
  async function fight(): Promise<void> {
    if (spinning) return;

    if (validStake <= 0) {
      setError('Enter a bet amount greater than 0.');
      return;
    }

    setSpinning(true);
    setError(null);
    setResult(null);
    setIsModalOpen(false);
    setSparks(null);
    // Raise the curtain on the first throw, so the ring is revealed as it spins up.
    setIsCurtainOpen(true);
    playSound('punch');
    playSound('spin', { durationMs: SPIN_MS + STAGGER_MS * 9 });

    const startedAt = performance.now();
    setSettled(Array(9).fill(false));
    setStrips(Array.from({ length: 9 }, () => randomStrip(config.symbols)));
    setRollSpeeds(randomRollSpeeds());

    try {
      const { data } = await api.post<BoxingKingResult>('/game/boxing_king/play', {
        betAmount: validStake,
      });

      setBalance(data.balanceAfter);

      await delay(Math.max(0, SPIN_MS - (performance.now() - startedAt)));
      if (unmounted.current) return;

      for (let cell = 0; cell < 9; cell += 1) {
        if (unmounted.current) return;

        const symbol = data.grid[cell]!;
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

        // Every reel slams home with its own punch, each one a touch heavier.
        playSound('punch', { volume: 0.45 + cell * 0.04, pitch: 1.05 - cell * 0.02 });

        if (cell < 8) await delay(STAGGER_MS);
      }

      if (unmounted.current) return;

      setResult(data);

      if (data.payout > 0) {
        // The knockout blow first, then the celebration landing on top of it.
        playSound('punch', { volume: 1, pitch: 0.76 });
        window.setTimeout(() => playSound('win'), 140);
      } else {
        playSound('lose');
      }

      // A cluster of five or more lands like a knockout.
      if (data.biggestCluster >= 5) {
        setSparks(randomSparks());
        window.setTimeout(() => {
          if (!unmounted.current) setSparks(null);
        }, SPARK_MS);
      }

      if (data.payout > 0) {
        setWinAmount(data.payout);
        setIsModalOpen(true);
      }
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'The round could not be completed.'));
      setSettled(Array(9).fill(true));
      void refreshBalance();
    } finally {
      if (!unmounted.current) setSpinning(false);
    }
  }


  return (
    <div className="rt">
      <header className="rt__topbar">
        <Link to="/" className="rt__back">
          <ArrowLeftIcon className="icon icon--sm" />
          Back to Lobby
        </Link>

        <h1 className="rt__title">Boxing King 🥊</h1>

        <SoundToggle />

        <LivePlayerBadge baseCount={4400} />

        <span
          className={`balance-pill${balanceError ? ' balance-pill--error' : ''}`}
          title={balanceError ?? 'Current balance'}
        >
          <WalletIcon className="icon icon--sm" />
          {balanceLabel}
        </span>
      </header>

      <main className="rt__body">
        <section className="rt__stage bk__stage">
          <div className="bk-ring">
            <div className="bk-ring__ropes" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <span className="bk-ring__post bk-ring__post--tl" aria-hidden="true" />
            <span className="bk-ring__post bk-ring__post--tr" aria-hidden="true" />
            <span className="bk-ring__post bk-ring__post--bl" aria-hidden="true" />
            <span className="bk-ring__post bk-ring__post--br" aria-hidden="true" />

            <div className="bk-mat">
              {/* Permanent fire ring around the reels — always burning. */}
              <div className="bk-fire-border" aria-hidden="true" />

              <div className="bk-grid" role="img" aria-label={`Board: ${grid.join(' ')}`}>
                {grid.map((symbol, cell) => {
                  const isSettled = settled[cell];
                  const punching = isSettled && winningCells.has(cell);

                  return (
                    <div
                      key={cell}
                      className={`bk-cell${punching ? ' bk-cell--win' : ''}${
                        isSettled ? '' : ' bk-cell--rolling'
                      }`}
                    >
                      {isSettled ? (
                        <span className="bk-cell__symbol">{symbol}</span>
                      ) : (
                        <span
                          className="bk-strip bk-reel--spinning"
                          style={{ animationDuration: `${rollSpeeds[cell] ?? 300}ms` }}
                          aria-hidden="true"
                        >
                          {[...strips[cell]!, strips[cell]![0]!].map((face, index) => (
                            <span key={index} className="bk-strip__face">
                              {face}
                            </span>
                          ))}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>

              {/*
               * Stage curtains: their own clipping wrapper so they slide out
               * without spilling over the ring, and they never take a click.
               */}
              <div className="bk-curtains" aria-hidden="true">
                <div
                  className={`bk-curtain bk-curtain--left${isCurtainOpen ? ' bk-curtain--open' : ''}`}
                />
                <div
                  className={`bk-curtain bk-curtain--right${isCurtainOpen ? ' bk-curtain--open' : ''}`}
                />
              </div>

              {sparks && (
                <div className="bk-sparks" aria-hidden="true">
                  {sparks.map((style, index) => (
                    <span key={index} style={style} />
                  ))}
                </div>
              )}
            </div>
          </div>

          <p
            className={`bk-result${result ? (result.won ? ' bk-result--won' : ' bk-result--lost') : ''}`}
            role="status"
            aria-live="polite"
          >
            {spinning
              ? 'Fighting…'
              : result
                ? result.won
                  ? `${result.clusters.length} cluster${result.clusters.length > 1 ? 's' : ''} · ${result.biggestCluster} best · ${multiplierLabel(result.multiplier)} → ${money(result.payout)}`
                  : 'No cluster — the round goes to the house'
                : `${config.pays.small}× for 3–4 · ${config.pays.medium}× for 5–6 · ${config.pays.large}× for 7+`}
          </p>
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
              Cluster paytable
              <span className="panel-value">Win Multipliers</span>
            </div>
            <ul className="bk-paytable">
              <li>
                <span>3–4 symbols</span>
                <strong>{money(winSmall)}</strong>
              </li>
              <li>
                <span>5–6 symbols</span>
                <strong>{money(winMedium)}</strong>
              </li>
              <li>
                <span>7+ symbols</span>
                <strong>{money(winLarge)}</strong>
              </li>
            </ul>
          </div>

          <button
            type="button"
            className="bk-fight"
            onClick={() => void fight()}
            disabled={spinning || validStake <= 0}
          >
            <span className="bk-fight__title">{spinning ? 'FIGHTING…' : 'FIGHT'}</span>
            <span className="bk-fight__sub">{money(validStake)} on the board</span>
          </button>

          {error && <p className="error">{error}</p>}
        </aside>
      </main>

      <WinModal isOpen={isModalOpen} winAmount={winAmount} onClose={() => setIsModalOpen(false)} />
    </div>
  );
}
