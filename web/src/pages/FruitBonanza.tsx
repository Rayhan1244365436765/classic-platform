import { useCallback, useEffect, useRef, useState } from 'react';

import { api, getApiErrorMessage } from '../api/client';
import type { BalanceResponse, FruitBonanzaConfig, FruitBonanzaResult, FruitLineResult } from '../api/types';
import { GameShell } from '../components/GameShell';
import { GameResultOverlay } from '../components/GameResultOverlay';
import { playSound } from '../utils/sound';

const DEFAULT_BET = 5;
const SPIN_MS = 1500;
const STAGGER_MS = 110;
const STRIP_LENGTH = 4;
const ROLL_MS_MIN = 260;
const ROLL_MS_MAX = 360;

const FALLBACK_SYMBOLS = ['🍉', '🍇', '🍋', '🍒', '🍊', '⭐'];

const FALLBACK_CONFIG: FruitBonanzaConfig = {
  symbols: FALLBACK_SYMBOLS,
  lines: [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 4, 8], [2, 4, 6]],
  cells: 9,
  lineCount: 5,
  pays: { three: 4, two: 0.2 },
  rtp: 35 / 36,
  houseEdge: 1 / 36,
  probabilities: { three: 1 / 36, two: 5 / 12, none: 5 / 9 },
};

function delay(ms: number): Promise<void> { return new Promise((resolve) => { window.setTimeout(resolve, ms); }); }
function randomGrid(symbols: readonly string[]): string[] { return Array.from({ length: 9 }, () => symbols[Math.floor(Math.random() * symbols.length)]); }
function randomStrip(symbols: readonly string[]): string[] { return Array.from({ length: STRIP_LENGTH }, () => symbols[Math.floor(Math.random() * symbols.length)]); }
function randomRollSpeeds(): number[] { return Array.from({ length: 9 }, () => Math.round(ROLL_MS_MIN + Math.random() * (ROLL_MS_MAX - ROLL_MS_MIN))); }
function winningCells(lines: readonly FruitLineResult[]): Set<number> {
  const cells = new Set<number>();
  for (const line of lines) if (line.multiplier > 0) for (const cell of line.cells) cells.add(cell);
  return cells;
}

async function fetchBalance(): Promise<number> { const { data } = await api.get<BalanceResponse>('/wallet/balance'); return data.balance; }
async function fetchConfig(): Promise<FruitBonanzaConfig> { const { data } = await api.get<FruitBonanzaConfig>('/game/fruit_bonanza/config'); return data; }

export default function FruitBonanza() {
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [amount, setAmount] = useState(String(DEFAULT_BET));
  const [config, setConfig] = useState<FruitBonanzaConfig>(FALLBACK_CONFIG);
  const [grid, setGrid] = useState<string[]>(() => randomGrid(FALLBACK_SYMBOLS));
  const [strips, setStrips] = useState<string[][]>(() => Array.from({ length: 9 }, () => randomStrip(FALLBACK_SYMBOLS)));
  const [rollSpeeds, setRollSpeeds] = useState<number[]>(randomRollSpeeds);
  const [settled, setSettled] = useState<boolean[]>(() => Array(9).fill(true));
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<FruitBonanzaResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showWin, setShowWin] = useState(false);
  const unmounted = useRef(false);

  useEffect(() => { unmounted.current = false; return () => { unmounted.current = true; }; }, []);

  const refreshBalance = useCallback(async () => {
    try { setBalance(await fetchBalance()); setBalanceError(null); }
    catch (requestError) { setBalanceError(getApiErrorMessage(requestError, 'Could not load your balance.')); }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try { const value = await fetchBalance(); if (!cancelled) setBalance(value); }
      catch (requestError) { if (!cancelled) setBalanceError(getApiErrorMessage(requestError, 'Could not load your balance.')); }
      try { const next = await fetchConfig(); if (cancelled) return; setConfig(next); setGrid(randomGrid(next.symbols)); setStrips(Array.from({ length: 9 }, () => randomStrip(next.symbols))); }
      catch { /* fallback */ }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  const stake = Number(amount);
  const validStake = Number.isFinite(stake) && stake > 0 ? Math.round(stake * 100) / 100 : 0;

  async function spin(): Promise<void> {
    if (spinning) return;
    if (validStake <= 0) { setError('Enter a bet amount greater than 0.'); return; }
    setSpinning(true); setError(null); setResult(null); setShowWin(false);
    const startedAt = performance.now();
    setSettled(Array(9).fill(false));
    setStrips(Array.from({ length: 9 }, () => randomStrip(config.symbols)));
    setRollSpeeds(randomRollSpeeds());
    playSound('click');
    playSound('spin', { durationMs: SPIN_MS + STAGGER_MS * 9 });
    try {
      const { data } = await api.post<FruitBonanzaResult>('/game/fruit_bonanza/play', { betAmount: validStake });
      setBalance(data.balanceAfter);
      await delay(Math.max(0, SPIN_MS - (performance.now() - startedAt)));
      for (let cell = 0; cell < 9; cell += 1) {
        if (unmounted.current) return;
        const symbol = data.grid[cell];
        setGrid((previous) => { const next = [...previous]; next[cell] = symbol; return next; });
        setSettled((previous) => { const next = [...previous]; next[cell] = true; return next; });
        if (cell < 8) await delay(STAGGER_MS);
      }
      if (unmounted.current) return;
      setResult(data);
      playSound(data.payout > 0 ? 'win' : 'lose');
      if (data.payout > 0) setShowWin(true);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'The spin could not be completed.'));
      setSettled(Array(9).fill(true));
      void refreshBalance();
    } finally { if (!unmounted.current) setSpinning(false); }
  }

  const glow = result ? winningCells(result.lines) : new Set<number>();

  return (
    <GameShell balance={balance} balanceError={balanceError} betAmount={validStake} setBetAmount={(value) => setAmount(String(value))} onSpin={() => void spin()} spinLabel={spinning ? 'SPINNING' : 'SPIN'} isSpinning={spinning}>
      <section className="rt__stage fb__stage">
        <div className="fb-cabinet">
          <div className="fb-cabinet__header">
            <span className="fb-cabinet__brand">🍉 Fruit Bonanza</span>
            <span className="fb-cabinet__lines">{config.lineCount} paylines</span>
          </div>
          <div className={`fb-grid${spinning ? ' fb-grid--spinning' : ''}`} role="img" aria-label={`Reel grid: ${grid.join(' ')}`}>
            {grid.map((symbol, cell) => {
              const isSettled = settled[cell];
              const isWinning = isSettled && glow.has(cell);
              return (
                <div key={cell} className={`fb-cell${isWinning ? ' fb-cell--win' : ''}${isSettled ? '' : ' fb-cell--rolling'}`}>
                  {isSettled ? (
                    <span className="fb-cell__symbol">{symbol}</span>
                  ) : (
                    <span className="fb-strip fb-reel--spinning" style={{ animationDuration: `${rollSpeeds[cell]}ms` }} aria-hidden="true">
                      {[...strips[cell], strips[cell][0]].map((face, index) => <span key={index} className="fb-strip__face">{face}</span>)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        {error && <p className="error">{error}</p>}
      </section>
      <GameResultOverlay
        isOpen={showWin}
        isWin={(result?.payout ?? 0) > 0}
        amount={result?.payout ?? 0}
        multiplier={result && validStake > 0 ? Math.round((result.payout / validStake) * 100) / 100 : 0}
        detail={result && result.payout > 0 ? `${result.lines.filter((line) => line.multiplier > 0).length} winning line(s)` : undefined}
        onClose={() => setShowWin(false)}
      />
    </GameShell>
  );
}
