import { useCallback, useEffect, useRef, useState } from 'react';

import { api, getApiErrorMessage } from '../api/client';
import type { BalanceResponse, KenoConfig, KenoPayTable, KenoResult } from '../api/types';
import { GameShell } from '../components/GameShell';
import { playSound, startSpin, stopSpin } from '../utils/sound';

const DEFAULT_BET = 10;
const DEFAULT_PICKS = 10;
const REVEAL_STEP_MS = 55;

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
  return `$${rounded.toLocaleString('en-US', { minimumFractionDigits: fractionDigits, maximumFractionDigits: 2 })}`;
}

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
        if (!cancelled) setBalanceError(getApiErrorMessage(requestError, 'Could not load your balance.'));
      }
      try {
        const next = await fetchConfig();
        if (!cancelled) setConfig(next);
      } catch {
        // Keep fallback
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  const stake = Number(amount);
  const validStake = Number.isFinite(stake) && stake > 0 ? Math.round(stake * 100) / 100 : 0;
  const table = payTableFor(config, picksCount);
  const topMultiplier = table.multipliers[picksCount] ?? 0;
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
    setSelected((previous) => previous.slice(0, count));
  }

  function toggleNumber(number: number) {
    if (drawing) return;
    setError(null);
    resetBoard();
    setSelected((previous) => {
      if (previous.includes(number)) return previous.filter((value) => value !== number);
      if (previous.length >= picksCount) return previous;
      return [...previous, number];
    });
    playSound('click');
  }

  async function draw() {
    if (drawing) return;
    if (validStake <= 0) { setError('Enter a bet amount greater than 0.'); return; }
    if (selected.length !== picksCount) {
      setError(picksLeft > 0 ? `Pick ${picksLeft} more number${picksLeft === 1 ? '' : 's'} to draw.` : `You can only pick ${picksCount} numbers.`);
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
      startSpin(REVEAL_STEP_MS * data.drawn.length);

      let shown = 0;
      await new Promise<void>((resolve) => {
        revealTimer.current = window.setInterval(() => {
          shown += 1;
          setRevealed(data.drawn.slice(0, shown));
          if (shown >= data.drawn.length) { stopReveal(); resolve(); }
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
  const pickOptions = Array.from({ length: config.maxPicks - config.minPicks + 1 }, (_, index) => config.minPicks + index);

  return (
    <GameShell
      balance={balance}
      balanceError={balanceError}
      onBack={() => window.history.back()}
      betAmount={validStake}
      setBetAmount={(value) => setAmount(String(value))}
      onSpin={() => void draw()}
      spinLabel={drawing ? 'DRAWING…' : 'DRAW'}
      isSpinning={drawing}
      disabled={!ready}
      controls={
        <div className="chips" style={{ flexWrap: 'nowrap', overflowX: 'auto' }}>
          <span className="panel-label" style={{ marginRight: 8 }}>Picks</span>
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
      }
    >
      <section className="rt__stage">
        <div className={`keno-board${drawing ? ' keno-board--drawing' : ''}`} role="group" aria-label={`Keno board, ${config.pool} numbers`}>
          {cellNumbers.map((number) => {
            const picked = pickedSet.has(number);
            const drawn = drawnSet.has(number);
            const hit = picked && drawn;
            const miss = settled && picked && !drawn;
            const modifier = hit ? ' keno-cell--hit' : picked ? (miss ? ' keno-cell--miss' : ' keno-cell--picked') : drawn ? ' keno-cell--drawn' : '';
            return (
              <button
                key={number}
                type="button"
                className={`keno-cell${modifier}`}
                onClick={() => toggleNumber(number)}
                disabled={drawing}
                aria-pressed={picked}
                aria-label={`Number ${number}${picked ? ', picked' : ''}${drawn ? ', drawn' : ''}`}
              >
                {number}
              </button>
            );
          })}
        </div>

        {drawing && <p className="keno-status" role="status" aria-live="polite">Drawing {revealed.length}/{config.drawn}…</p>}

        {result && !drawing && (
          <div className={`keno-result${result.payout > 0 ? ' keno-result--win' : ' keno-result--lose'}`} role="status" aria-live="polite">
            <p className="keno-result__headline">You matched {result.hits} number{result.hits === 1 ? '' : 's'}!</p>
            <p className="keno-result__amount">{result.payout > 0 ? `You won ${money(result.payout)}` : 'You won $0'}</p>
            <p className="keno-result__caption">{result.hits} of {result.picked.length} picks paid {multiplierLabel(result.multiplier)} your {money(result.betAmount)} bet</p>
          </div>
        )}

        <p className="rt__fair">{selected.length}/{picksCount} picked · top {multiplierLabel(topMultiplier)} · pays from {table.minHits} match{table.minHits === 1 ? '' : 'es'}</p>
        {error && <p className="error">{error}</p>}
      </section>
    </GameShell>
  );
}
