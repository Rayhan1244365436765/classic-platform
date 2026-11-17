import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { api, getApiErrorMessage } from '../api/client';
import type { BalanceResponse, KenoConfig, KenoPayTable, KenoResult } from '../api/types';
import { ArrowLeftIcon, WalletIcon } from '../components/Icons';
import { LivePlayerBadge } from '../components/LivePlayerBadge';
import { SoundToggle } from '../components/SoundToggle';
import { playSound, startSpin, stopSpin } from '../utils/sound';

/**
 * Keno — pick 1–10 numbers from the 1–80 board, the house draws 20.
 *
 * The server settles immediately (it returns the 20 drawn numbers and the exact
 * payout); this page replays the draw as a reveal — one ball every
 * `REVEAL_STEP_MS` — so the board can never disagree with what was paid: picked
 * numbers that were drawn turn green, picked numbers that were not turn red,
 * and the rest of the drawn numbers turn gold.
 *
 * The prize ladder comes from `GET /game/keno/config`, so the panel always shows
 * the same multipliers the backend settles on (3% house edge at every pick
 * count — see the backend module header for the derivation).
 */

const CHIPS = [1, 5, 10, 50, 100];
/** Preview stake used before the player types one. */
const DEFAULT_BET = 10;
/** Picks pre-selected on first load (the classic 10-spot game). */
const DEFAULT_PICKS = 10;
/** One drawn number revealed per tick. */
const REVEAL_STEP_MS = 55;

/**
 * Used only if the config request fails — mirrors the backend ladders exactly
 * (see `backend/scripts/verify-keno.cjs`).
 */
const FALLBACK_CONFIG: KenoConfig = {
  pool: 80,
  drawn: 20,
  minPicks: 1,
  maxPicks: 10,
  payTables: [
    { picks: 1, minHits: 1, rtp: 0.97, multipliers: [0, 3.88] },
    { picks: 2, minHits: 1, rtp: 0.969, multipliers: [0, 1.73, 5.19] },
    { picks: 3, minHits: 2, rtp: 0.9689, multipliers: [0, 0, 5.37, 16.13] },
    { picks: 4, minHits: 2, rtp: 0.9693, multipliers: [0, 0, 2.62, 7.86, 23.59] },
    { picks: 5, minHits: 2, rtp: 0.9678, multipliers: [0, 0, 1.49, 4.48, 13.46, 40.38] },
    { picks: 6, minHits: 3, rtp: 0.9698, multipliers: [0, 0, 0, 3.93, 11.79, 35.37, 106.12] },
    { picks: 7, minHits: 3, rtp: 0.9699, multipliers: [0, 0, 0, 2.25, 6.75, 20.25, 60.75, 182.27] },
    { picks: 8, minHits: 3, rtp: 0.969, multipliers: [0, 0, 0, 1.38, 4.14, 12.43, 37.3, 111.92, 335.78] },
    { picks: 9, minHits: 4, rtp: 0.969, multipliers: [0, 0, 0, 0, 3.43, 10.31, 30.93, 92.81, 278.44, 835.32] },
    { picks: 10, minHits: 4, rtp: 0.9691, multipliers: [0, 0, 0, 0, 2.1, 6.31, 18.93, 56.81, 170.45, 511.35, 1534.05] },
  ],
};

function money(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  const fractionDigits = rounded % 1 === 0 ? 0 : 2;

  return `$${rounded.toLocaleString('en-US', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: 2,
  })}`;
}

/** `3.88` → `3.88×`, `1534.05` → `1,534.05×`. */
function multiplierLabel(multiplier: number): string {
  return `${multiplier.toLocaleString('en-US', { maximumFractionDigits: 2 })}×`;
}

async function fetchBalance(): Promise<number> {
  const { data } = await api.get<BalanceResponse>('/wallet/balance');
  return data.balance;
}

async function fetchConfig(): Promise<KenoConfig> {
  const { data } = await api.get<KenoConfig>('/game/keno/config');
  return data;
}

/** The ladder for a pick count (falls back to the 10-spot table). */
function payTableFor(config: KenoConfig, picks: number): KenoPayTable {
  return config.payTables.find((table) => table.picks === picks) ?? config.payTables.at(-1)!;
}

export default function Keno() {
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);

  const [amount, setAmount] = useState(String(DEFAULT_BET));
  const [config, setConfig] = useState<KenoConfig>(FALLBACK_CONFIG);
  const [picksCount, setPicksCount] = useState(DEFAULT_PICKS);
  const [selected, setSelected] = useState<number[]>([]);

  /** Numbers revealed so far — grows one per tick while the draw plays out. */
  const [revealed, setRevealed] = useState<number[]>([]);
  const [drawing, setDrawing] = useState(false);
  const [result, setResult] = useState<KenoResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const revealTimer = useRef<number | null>(null);

  const stopReveal = useCallback(() => {
    if (revealTimer.current !== null) {
      window.clearInterval(revealTimer.current);
      revealTimer.current = null;
    }
  }, []);

  // Never leave a timer or a ticker behind when the page unmounts.
  useEffect(() => {
    return () => {
      stopReveal();
      stopSpin();
    };
  }, [stopReveal]);

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
        // Keep FALLBACK_CONFIG — the game still works with the mirrored ladder.
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  const stake = Number(amount);
  const validStake = Number.isFinite(stake) && stake > 0 ? Math.round(stake * 100) / 100 : 0;
  const table = payTableFor(config, picksCount);
  const topMultiplier = table.multipliers[picksCount] ?? 0;
  const topPrize = Math.round(validStake * topMultiplier * 100) / 100;

  const balanceLabel = balance === null ? '—' : money(balance);
  const picksLeft = picksCount - selected.length;
  const ready = !drawing && selected.length === picksCount && validStake > 0;

  const drawnSet = new Set(revealed);
  const settled = result !== null;
  const pickedSet = new Set(selected);

  function resetBoard() {
    stopReveal();
    setRevealed([]);
    setResult(null);
  }

  function choosePicks(count: number) {
    playSound('click');
    resetBoard();
    setPicksCount(count);
    // Lowering the pick count can't leave more numbers selected than allowed.
    setSelected((previous) => previous.slice(0, count));
  }

  function toggleNumber(number: number) {
    if (drawing) return;

    setError(null);
    resetBoard();

    setSelected((previous) => {
      if (previous.includes(number)) {
        return previous.filter((value) => value !== number);
      }
      if (previous.length >= picksCount) {
        return previous; // Board is full — deselect something first.
      }

      return [...previous, number];
    });

    playSound('click');
  }

  function clearPicks() {
    playSound('click');
    resetBoard();
    setSelected([]);
  }

  async function draw() {
    if (drawing) return;

    if (validStake <= 0) {
      setError('Enter a bet amount greater than 0.');
      return;
    }
    if (selected.length !== picksCount) {
      setError(
        picksLeft > 0
          ? `Pick ${picksLeft} more number${picksLeft === 1 ? '' : 's'} to draw.`
          : `You can only pick ${picksCount} numbers.`,
      );
      return;
    }

    setDrawing(true);
    setError(null);
    setResult(null);
    setRevealed([]);

    try {
      const { data } = await api.post<KenoResult>('/game/keno/play', {
        betAmount: validStake,
        selectedNumbers: [...selected].sort((a, b) => a - b),
      });

      setBalance(data.balanceAfter);

      // Replay the draw — one ball per tick — then report the outcome.
      startSpin(REVEAL_STEP_MS * data.drawn.length);

      let shown = 0;
      await new Promise<void>((resolve) => {
        revealTimer.current = window.setInterval(() => {
          shown += 1;
          setRevealed(data.drawn.slice(0, shown));

          if (shown >= data.drawn.length) {
            stopReveal();
            resolve();
          }
        }, REVEAL_STEP_MS);
      });

      stopSpin();
      setResult(data);
      playSound(data.payout > 0 ? 'win' : 'lose');
    } catch (requestError) {
      stopSpin();
      setError(getApiErrorMessage(requestError, 'The draw could not be completed.'));
      void refreshBalance();
    } finally {
      setDrawing(false);
    }
  }

  const cellNumbers = Array.from({ length: config.pool }, (_, index) => index + 1);
  const pickOptions = Array.from(
    { length: config.maxPicks - config.minPicks + 1 },
    (_, index) => config.minPicks + index,
  );

  return (
    <div className="rt">
      <header className="rt__topbar">
        <Link to="/" className="rt__back">
          <ArrowLeftIcon className="icon icon--sm" />
          Back to Lobby
        </Link>

        <h1 className="rt__title">Keno 🔢</h1>

        <SoundToggle />

        <LivePlayerBadge baseCount={1900} />

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
          <div
            className={`keno-board${drawing ? ' keno-board--drawing' : ''}`}
            role="group"
            aria-label={`Keno board, ${config.pool} numbers`}
          >
            {cellNumbers.map((number) => {
              const picked = pickedSet.has(number);
              const drawn = drawnSet.has(number);
              const hit = picked && drawn;
              const miss = settled && picked && !drawn;

              const modifier = hit
                ? ' keno-cell--hit'
                : picked
                  ? miss
                    ? ' keno-cell--miss'
                    : ' keno-cell--picked'
                  : drawn
                    ? ' keno-cell--drawn'
                    : '';

              return (
                <button
                  key={number}
                  type="button"
                  className={`keno-cell${modifier}`}
                  onClick={() => toggleNumber(number)}
                  disabled={drawing}
                  aria-pressed={picked}
                  aria-label={`Number ${number}${picked ? ', picked' : ''}${
                    drawn ? ', drawn' : ''
                  }`}
                >
                  {number}
                </button>
              );
            })}
          </div>

          <div className="keno-legend" aria-hidden="true">
            <span className="keno-legend__item">
              <span className="keno-legend__dot keno-legend__dot--picked" />
              Your picks
            </span>
            <span className="keno-legend__item">
              <span className="keno-legend__dot keno-legend__dot--hit" />
              Matched
            </span>
            <span className="keno-legend__item">
              <span className="keno-legend__dot keno-legend__dot--drawn" />
              Drawn
            </span>
            <span className="keno-legend__item">
              <span className="keno-legend__dot keno-legend__dot--miss" />
              Missed
            </span>
          </div>

          {drawing && (
            <p className="keno-status" role="status" aria-live="polite">
              Drawing {revealed.length}/{config.drawn}…
            </p>
          )}

          {result && !drawing && (
            <div
              className={`keno-result${result.payout > 0 ? ' keno-result--win' : ' keno-result--lose'}`}
              role="status"
              aria-live="polite"
            >
              <p className="keno-result__headline">
                You matched {result.hits} number{result.hits === 1 ? '' : 's'}!
              </p>
              <p className="keno-result__amount">
                {result.payout > 0 ? `You won ${money(result.payout)}` : 'You won $0'}
              </p>
              <p className="keno-result__caption">
                {result.hits} of {result.picked.length} picks paid{' '}
                {multiplierLabel(result.multiplier)} your {money(result.betAmount)} bet
              </p>
            </div>
          )}
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
                  disabled={drawing}
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
                disabled={drawing}
                aria-label="Custom bet amount"
              />
            </div>
          </div>

          <div className="panel-block">
            <div className="panel-label">
              Numbers to pick
              <span className="panel-value">
                {selected.length}/{picksCount}
              </span>
            </div>
            <div className="chips keno-picks">
              {pickOptions.map((count) => (
                <button
                  key={count}
                  type="button"
                  className={`chip${count === picksCount ? ' chip--active' : ''}`}
                  onClick={() => choosePicks(count)}
                  disabled={drawing}
                  aria-pressed={count === picksCount}
                >
                  {count}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="keno-clear"
              onClick={clearPicks}
              disabled={drawing || selected.length === 0}
            >
              Clear picks
            </button>
          </div>

          <div className="panel-block">
            <div className="panel-label">
              {picksCount}-spot paytable
              <span className="panel-value">{multiplierLabel(topMultiplier)}</span>
            </div>
            <ul className="keno-paytable">
              {table.multipliers.map((multiplier, hits) =>
                hits < table.minHits ? null : (
                  <li
                    key={hits}
                    className={`keno-paytable__row${
                      result && result.picked.length === picksCount && result.hits === hits
                        ? ' keno-paytable__row--hit'
                        : ''
                    }`}
                  >
                    <span className="keno-paytable__hits">
                      {hits} match{hits === 1 ? '' : 'es'}
                    </span>
                    <span className="keno-paytable__pays">{multiplierLabel(multiplier)}</span>
                    <span className="keno-paytable__amount">
                      {money(Math.round(validStake * multiplier * 100) / 100)}
                    </span>
                  </li>
                ),
              )}
            </ul>
            <p className="rt__meta rt__meta--left">
              Top prize {money(topPrize)} · {config.drawn} of {config.pool} drawn · pays from{' '}
              {table.minHits} match{table.minHits === 1 ? '' : 'es'}
            </p>
          </div>

          <button
            type="button"
            className="aviator-action"
            onClick={() => void draw()}
            disabled={!ready}
          >
            <span className="aviator-action__title">{drawing ? 'DRAWING…' : 'DRAW'}</span>
            <span className="aviator-action__sub">
              {money(validStake)} · {selected.length}/{picksCount} picked
            </span>
          </button>

          {error && <p className="error">{error}</p>}

          <p className="rt__meta">
            {result
              ? `Round ${result.roundId.slice(0, 8)} · seed ${result.serverSeedHash.slice(0, 12)}…`
              : 'Provably fair · 20 of 80 drawn from one committed seed'}
          </p>
        </aside>
      </main>
    </div>
  );
}
