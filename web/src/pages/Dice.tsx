import { useCallback, useEffect, useRef, useState } from 'react';
import { api, getApiErrorMessage } from '../api/client';
import type { BalanceResponse, DiceConfig, DicePrediction, DiceResult } from '../api/types';
import { GameShell } from '../components/GameShell';
import { playSound } from '../utils/sound';

/**
 * Dice (High/Low) — one roll of 1–100 per round.
 *
 * The server rolls and settles; this page only animates the reveal: the number
 * flickers through 1–100 for ~1 s, then lands on the server's roll and the
 * result card reports the outcome.
 */

const CHIPS = [1, 5, 10, 50, 100];
/** Preview stake used before the player types one. */
const DEFAULT_BET = 10;
/** Used only if the config request fails — mirrors the backend table. */
const FALLBACK_CONFIG: DiceConfig = {
  faces: 100,
  min: 1,
  max: 100,
  multiplier: 1.95,
  houseNumber: 50,
  high: { min: 51, max: 100 },
  low: { min: 1, max: 49 },
};

/** How long the numbers flicker before the result lands. */
const ROLL_MS = 1000;
/** Interval between flickered numbers. */
const FLICKER_MS = 55;

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

async function fetchConfig(): Promise<DiceConfig> {
  const { data } = await api.get<DiceConfig>('/game/dice/config');
  return data;
}

export default function Dice() {
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);

  const [amount, setAmount] = useState(String(DEFAULT_BET));
  const [config, setConfig] = useState<DiceConfig | null>(null);
  const table = config ?? FALLBACK_CONFIG;

  /** Number currently shown on the table (flickers while rolling). */
  const [display, setDisplay] = useState<number>(table.houseNumber);
  const [call, setCall] = useState<DicePrediction | null>(null);
  const [isRolling, setIsRolling] = useState(false);
  const [result, setResult] = useState<DiceResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const flickerTimer = useRef<number | null>(null);

  const stopFlicker = useCallback(() => {
    if (flickerTimer.current !== null) {
      window.clearInterval(flickerTimer.current);
      flickerTimer.current = null;
    }
  }, []);

  // Never leave a timer behind when the page unmounts.
  useEffect(() => stopFlicker, [stopFlicker]);

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

    async function loadConfig() {
      try {
        const value = await fetchConfig();
        if (!cancelled && value.faces > 0) {
          setConfig(value);
        }
      } catch {
        // The fallback table matches the backend; the game still works.
      }
    }

    void loadBalance();
    void loadConfig();

    return () => {
      cancelled = true;
    };
  }, []);

  async function roll(prediction: DicePrediction) {
    if (isRolling) {
      return;
    }

    setError(null);

    const stakeAmount = Number(amount);
    if (!Number.isFinite(stakeAmount) || stakeAmount <= 0) {
      setError('Enter a bet amount greater than 0.');
      return;
    }

    setIsRolling(true);
    setResult(null);
    setCall(prediction);
    playSound('click');

    // Flicker 1–100 while the API settles the round.
    flickerTimer.current = window.setInterval(() => {
      setDisplay(table.min + Math.floor(Math.random() * table.faces));
    }, FLICKER_MS);

    try {
      const [response] = await Promise.all([
        api.post<DiceResult>('/game/dice/play', { betAmount: stakeAmount, prediction }),
        delay(ROLL_MS),
      ]);

      stopFlicker();

      const data = response.data;
      setDisplay(data.roll);
      setResult(data);
      playSound(data.won ? 'win' : 'lose');
      setBalance(data.balanceAfter);
      void refreshBalance();
    } catch (requestError) {
      stopFlicker();
      setDisplay(table.houseNumber);
      setError(getApiErrorMessage(requestError, 'The roll could not be placed.'));
      void refreshBalance();
    } finally {
      setIsRolling(false);
    }
  }

  const stake = Number(amount) || 0;
  const previewStake = stake > 0 ? stake : DEFAULT_BET;
  const winPayout = previewStake * table.multiplier;

  // Marker position across the 1–100 track (roll 1 → 0%, roll 100 → 100%).
  const markerPct = Math.min(100, Math.max(0, ((display - table.min) / table.faces) * 100));

  const gameProps = {
    balance,
    onBack: () => {
      // Dice has no other back destination.
    },
    betAmount: previewStake,
    setBetAmount: (amount: number) => setAmount(String(amount)),
    onSpin: () => void roll(call ?? 'high'),
    spinLabel: 'ROLL',
    isSpinning: isRolling,
  };

  return (
    <GameShell {...gameProps}>
      <section className="rt__stage">
        <section className="rt__stage">
          <div
            className={`dice-table${isRolling ? ' dice-table--rolling' : ''}${
              result && !result.won ? ' dice-table--lost' : ''
            }`}
          >
            <div className="dice-table__glow" aria-hidden="true" />

            <p className="dice-table__label">
              {isRolling
                ? `Rolling ${call === 'high' ? 'HIGH' : 'LOW'}`
                : call
                  ? `You called ${call === 'high' ? 'HIGH' : 'LOW'}`
                  : 'Call high or low'}
            </p>

            <div
              className={`dice-table__value${isRolling ? ' dice-table__value--rolling' : ''}${
                result && !isRolling
                  ? result.won
                    ? ' dice-table__value--win'
                    : ' dice-table__value--lose'
                  : ''
              }`}
              role="status"
              aria-live="polite"
              aria-label={isRolling ? 'Rolling' : `Roll ${display}`}
            >
              {display}
            </div>

            <div className="dice-track" aria-hidden="true">
              <span
                className={`dice-track__zone dice-track__zone--low${
                  call === 'low' ? ' dice-track__zone--active' : ''
                }`}
              />
              <span className="dice-track__zone dice-track__zone--house" />
              <span
                className={`dice-track__zone dice-track__zone--high${
                  call === 'high' ? ' dice-track__zone--active' : ''
                }`}
              />
              <span className="dice-track__marker" style={{ left: `${markerPct}%` }} />
            </div>

            <div className="dice-track__legend" aria-hidden="true">
              <span>{table.low.min}–{table.low.max} low</span>
              <span>{table.houseNumber}</span>
              <span>{table.high.min}–{table.high.max} high</span>
            </div>
          </div>

          {result && !isRolling && (
            <div
              className={`dice-result${result.won ? ' dice-result--win' : ' dice-result--lose'}`}
              role="status"
              aria-live="polite"
            >
              <p className="dice-result__headline">
                {result.won ? 'WINNER!' : result.roll === table.houseNumber ? 'House number!' : 'No luck'}
              </p>
              <p className="dice-result__amount">
                {result.won ? `+${money(result.payout)}` : `-${money(result.betAmount)}`}
              </p>
              <p className="dice-result__caption">
                Rolled {result.roll} · called {result.prediction.toUpperCase()}
                {result.won
                  ? ` · ${result.multiplier}× your bet`
                  : result.roll === table.houseNumber
                    ? ' · 50 loses either way'
                    : ''}
              </p>
            </div>
          )}

          <p className="rt__fair">Provably fair · seed hash published before every roll</p>
          {balanceError && <p className="error">{balanceError}</p>}
        </section>

        <aside className="rt__panel">
          <div className="panel-block">
            <div className="panel-label">
              Bet amount
              <span className="panel-value">{money(previewStake)}</span>
            </div>
            <div className="chips">
              {CHIPS.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  className={`chip${stake === chip ? ' chip--active' : ''}`}
                  onClick={() => setAmount(String(chip))}
                  disabled={isRolling}
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
                disabled={isRolling}
                aria-label="Custom bet amount"
              />
            </div>
          </div>

          <div className="panel-block">
            <div className="panel-label">
              Win pays
              <span className="panel-value">{table.multiplier}×</span>
            </div>
            <div className="payout">
              <span className="payout__amount payout__amount--gold">
                <span className="payout__label">Win</span>
                {money(winPayout)}
              </span>
              <span className="payout__amount payout__amount--gray">
                <span className="payout__label">Roll {table.houseNumber}</span>
                {money(0)}
              </span>
            </div>
            <p className="rt__meta rt__meta--left">
              {table.high.min}–{table.high.max} wins high · {table.low.min}–{table.low.max} wins low.
            </p>
          </div>

          <div className="dice-actions">
            <button
              type="button"
              className={`dice-btn dice-btn--high${call === 'high' ? ' dice-btn--selected' : ''}`}
              onClick={() => void roll('high')}
              disabled={isRolling}
            >
              <span className="dice-btn__title">ROLL HIGH</span>
              <span className="dice-btn__sub">&gt;{table.houseNumber}</span>
            </button>

            <button
              type="button"
              className={`dice-btn dice-btn--low${call === 'low' ? ' dice-btn--selected' : ''}`}
              onClick={() => void roll('low')}
              disabled={isRolling}
            >
              <span className="dice-btn__title">ROLL LOW</span>
              <span className="dice-btn__sub">&lt;{table.houseNumber}</span>
            </button>
          </div>

          {error && <p className="error">{error}</p>}

          <p className="rt__meta">
            {result
              ? `Round ${result.roundId.slice(0, 8)} · seed ${result.serverSeedHash.slice(0, 12)}…`
              : 'The server publishes a seed hash before every round'}
          </p>
        </aside>

      </section>
    </GameShell>
  );
}


