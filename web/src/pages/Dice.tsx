import { useCallback, useEffect, useRef, useState } from 'react';
import { api, getApiErrorMessage } from '../api/client';
import type { BalanceResponse, DiceConfig, DicePrediction, DiceResult } from '../api/types';
import { GameShell } from '../components/GameShell';
import { GameResultOverlay } from '../components/GameResultOverlay';
import { useGameMusic } from '../hooks/useGameMusic';
import { playSound } from '../utils/sound';

/**
 * Dice (High/Low) — one roll of 1–100 per round.
 *
 * The server rolls and settles; this page only animates the reveal: the number
 * flickers through 1–100 for ~1 s, then lands on the server's roll and the
 * result card reports the outcome.
 */

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
  useGameMusic('/audio/slots-bgm.mp3', 0.4);

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
  const [showWin, setShowWin] = useState(false);
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
    setShowWin(false);
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
      if (data.won) setShowWin(true);
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

  // Marker position across the 1–100 track (roll 1 → 0%, roll 100 → 100%).
  const markerPct = Math.min(100, Math.max(0, ((display - table.min) / table.faces) * 100));

  const gameProps = {
    balance,
    betAmount: previewStake,
    setBetAmount: (amount: number) => setAmount(String(amount)),
    onSpin: () => void roll(call ?? 'high'),
    spinLabel: 'ROLL',
    isSpinning: isRolling,
  };

  return (
    <GameShell
      {...gameProps}
      controls={
        <div className="dice-actions">
          <button
            type="button"
            className={`dice-btn dice-btn--high${call === 'high' ? ' dice-btn--selected' : ''}`}
            onClick={() => {
              setCall('high');
              playSound('click');
            }}
            disabled={isRolling}
            aria-pressed={call === 'high'}
          >
            <span className="dice-btn__title">HIGH</span>
            <span className="dice-btn__sub">&gt;{table.houseNumber}</span>
          </button>

          <button
            type="button"
            className={`dice-btn dice-btn--low${call === 'low' ? ' dice-btn--selected' : ''}`}
            onClick={() => {
              setCall('low');
              playSound('click');
            }}
            disabled={isRolling}
            aria-pressed={call === 'low'}
          >
            <span className="dice-btn__title">LOW</span>
            <span className="dice-btn__sub">&lt;{table.houseNumber}</span>
          </button>
        </div>
      }
    >
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

          {result && (
            <GameResultOverlay
              isOpen={showWin}
              isWin={result.won}
              amount={result.won ? result.payout : 0}
              multiplier={result.won ? result.multiplier : 0}
              detail={
                result.won
                  ? `Rolled ${result.roll} · called ${result.prediction.toUpperCase()} · ${result.multiplier}× your bet`
                  : undefined
              }
              onClose={() => setShowWin(false)}
            />
          )}

          <p className="rt__fair">Provably fair · seed hash published before every roll</p>
          {error && <p className="error">{error}</p>}
          {balanceError && <p className="error">{balanceError}</p>}
        </section>

      </section>
    </GameShell>
  );
}


