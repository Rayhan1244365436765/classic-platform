import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

import { api, getApiErrorMessage } from '../api/client';
import type { BalanceResponse, RouletteResult } from '../api/types';

type BetType = RouletteResult['betType'];

const BET_TYPES: Array<{ value: BetType; label: string }> = [
  { value: 'red', label: 'Red' },
  { value: 'black', label: 'Black' },
  { value: 'green', label: 'Green' },
  { value: 'number', label: 'Number' },
];

const POCKET_COUNT = 37;

/** Single fetch implementation shared by the initial load and post-spin refresh. */
async function fetchBalance(): Promise<number> {
  const { data } = await api.get<BalanceResponse>('/wallet/balance');
  return data.balance;
}

export default function Roulette() {
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);

  const [betAmount, setBetAmount] = useState<number>(10);
  const [betType, setBetType] = useState<BetType>('red');
  const [betValue, setBetValue] = useState<string>('7');

  const [result, setResult] = useState<RouletteResult | null>(null);
  const [isSpinning, setIsSpinning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshBalance = useCallback(async () => {
    try {
      setBalance(await fetchBalance());
      setBalanceError(null);
    } catch (requestError) {
      setBalanceError(getApiErrorMessage(requestError, 'Could not load your balance.'));
    }
  }, []);

  // Always read a fresh balance when the table is opened.
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

    void loadBalance();

    return () => {
      cancelled = true;
    };
  }, []);

  function chooseBetType(next: BetType) {
    setBetType(next);
    setError(null);
  }

  async function handleSpin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSpinning) {
      return;
    }

    setError(null);

    if (!Number.isFinite(betAmount) || betAmount <= 0) {
      setError('Enter a bet amount greater than 0.');
      return;
    }

    if (betType === 'number') {
      const pocket = Number(betValue);

      if (!Number.isInteger(pocket) || pocket < 0 || pocket > 36) {
        setError('Choose a number between 0 and 36.');
        return;
      }
    }

    setIsSpinning(true);
    setResult(null);

    try {
      const payload =
        betType === 'number'
          ? { betAmount, betType, betValue: String(Number(betValue)) }
          : { betAmount, betType };

      const { data } = await api.post<RouletteResult>('/game/roulette/play', payload);

      // `balanceAfter` is the authoritative post-round balance; re-fetch to be sure.
      setBalance(data.balanceAfter);
      setResult(data);
      await refreshBalance();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'The spin could not be placed.'));
      await refreshBalance();
    } finally {
      setIsSpinning(false);
    }
  }

  const wheelRotation = result && !isSpinning ? result.resultNumber * (360 / POCKET_COUNT) : 0;
  return (
    <main className="shell">
      <section className="card card--wide">
        <h1>Roulette</h1>
        <p className="subtitle">
          Current Balance: {balance === null ? '—' : `$${balance.toFixed(2)}`}
        </p>
        {balanceError && <p className="error">{balanceError}</p>}

        <div className="wheel-wrap">
          <div className="wheel-pointer" aria-hidden="true" />
          <div
            className={`wheel${isSpinning ? ' wheel--spinning' : ''}`}
            style={isSpinning ? undefined : { transform: `rotate(${wheelRotation}deg)` }}
            role="img"
            aria-label={result ? `Result ${result.resultNumber} ${result.resultColor}` : 'Roulette wheel'}
          >
            <span className="wheel__number">
              {isSpinning ? '…' : result ? result.resultNumber : '—'}
            </span>
          </div>
        </div>

        <form onSubmit={handleSpin}>
          <label className="field">
            <span>Bet amount ($)</span>
            <input
              type="number"
              name="betAmount"
              value={Number.isFinite(betAmount) ? betAmount : ''}
              onChange={(event) =>
                setBetAmount(event.target.value === '' ? 0 : Number(event.target.value))
              }
              min={0.5}
              step={0.5}
              required
            />
          </label>

          <div className="field">
            <span>Bet on</span>
            <div className="bet-row">
              {BET_TYPES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`bet bet--${option.value}${
                    betType === option.value ? ' bet--active' : ''
                  }`}
                  onClick={() => chooseBetType(option.value)}
                  disabled={isSpinning}
                  aria-pressed={betType === option.value}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {betType === 'number' && (
            <label className="field">
              <span>Number (0–36)</span>
              <input
                type="number"
                name="betValue"
                value={betValue}
                onChange={(event) => setBetValue(event.target.value)}
                min={0}
                max={36}
                step={1}
                required
              />
            </label>
          )}

          <button type="submit" className="button-primary button-block" disabled={isSpinning}>
            {isSpinning ? 'Spinning…' : 'Spin'}
          </button>

          {error && <p className="error">{error}</p>}
        </form>

        {result && (
          <div className={`result${result.won ? ' result--win' : ' result--lose'}`}>
            <p className="result__headline">
              {result.resultNumber} · {result.resultColor}
            </p>
            <p className="result__text">
              {result.won
                ? `You won $${result.payout.toFixed(2)}!`
                : `No win this time — $${result.betAmount.toFixed(2)} lost.`}
            </p>
          </div>
        )}

        <p className="seeds">
          Round {result ? result.roundId.slice(0, 8) : '—'} · server seed hash{' '}
          {result ? `${result.serverSeedHash.slice(0, 16)}…` : 'committed before the spin'}
        </p>

        <p className="hint">
          <Link to="/">Back to dashboard</Link>
        </p>
      </section>
    </main>
  );
}

