import { useCallback, useEffect, useRef, useState } from 'react';

import { api, getApiErrorMessage } from '../api/client';
import type { BalanceResponse, ClassicRouletteConfig, ClassicRouletteResult, PocketColor, RouletteBetType } from '../api/types';
import { GameShell } from '../components/GameShell';
import { playSound } from '../utils/sound';

const DEFAULT_BET = 10;
const SPIN_MS = 3800;
const SPIN_TURNS = 6;

const FALLBACK_CONFIG: ClassicRouletteConfig = {
  pockets: 37,
  redNumbers: [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36],
  wheelOrder: [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26],
  payouts: { number: 36, red: 2, black: 2, even: 2, odd: 2, low: 2, high: 2 },
  betTypes: ['number', 'red', 'black', 'even', 'odd', 'low', 'high'],
  rtp: { number: 36 / 37, red: 36 / 37, black: 36 / 37, even: 36 / 37, odd: 36 / 37, low: 36 / 37, high: 36 / 37 },
  houseEdge: 1 / 37,
};

const OUTSIDE_BETS: { type: RouletteBetType; label: string }[] = [
  { type: 'low', label: '1–18' }, { type: 'even', label: 'EVEN' }, { type: 'red', label: 'RED' },
  { type: 'black', label: 'BLACK' }, { type: 'odd', label: 'ODD' }, { type: 'high', label: '19–36' },
];

type Selection = { type: RouletteBetType; value: number | null };
function money(value: number): string { const rounded = Math.round(value * 100) / 100; const fractionDigits = rounded % 1 === 0 ? 0 : 2; return `$${rounded.toLocaleString('en-US', { minimumFractionDigits: fractionDigits, maximumFractionDigits: 2 })}`; }
function colourOf(pocket: number, redNumbers: readonly number[]): PocketColor { if (pocket === 0) return 'green'; return redNumbers.includes(pocket) ? 'red' : 'black'; }
function betLabel(selection: Selection): string { return selection.type === 'number' ? `#${selection.value}` : selection.type.toUpperCase(); }
async function fetchBalance(): Promise<number> { const { data } = await api.get<BalanceResponse>('/wallet/balance'); return data.balance; }
async function fetchConfig(): Promise<ClassicRouletteConfig> { const { data } = await api.get<ClassicRouletteConfig>('/game/classic_roulette/config'); return data; }

type WheelFrame = { rotation: number; ballAngle: number; ballFactor: number; highlight: number | null };

function paintWheel(ctx: CanvasRenderingContext2D, size: number, config: ClassicRouletteConfig, frame: WheelFrame): void {
  const centre = size / 2; const rim = size * 0.48; const pocketRing = rim * 0.8; const hub = rim * 0.4; const step = (Math.PI * 2) / config.pockets;
  ctx.clearRect(0, 0, size, size);
  ctx.beginPath(); ctx.arc(centre, centre, rim, 0, Math.PI * 2); ctx.fillStyle = '#170f06'; ctx.fill(); ctx.lineWidth = size * 0.014; ctx.strokeStyle = 'rgb(212 175 55 / 85%)'; ctx.stroke();
  config.wheelOrder.forEach((pocket, index) => {
    const start = frame.rotation + index * step; const colour = colourOf(pocket, config.redNumbers); const settled = frame.highlight === index;
    ctx.beginPath(); ctx.moveTo(centre, centre); ctx.arc(centre, centre, pocketRing, start, start + step); ctx.closePath();
    ctx.fillStyle = settled ? '#f6d97a' : colour === 'green' ? '#0f7a4a' : colour === 'red' ? '#b0122c' : '#15181f'; ctx.fill();
    ctx.save(); ctx.translate(centre, centre); ctx.rotate(start + step / 2); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = settled ? '#1b1405' : 'rgb(255 255 255 / 82%)'; ctx.font = `600 ${Math.max(7, Math.round(size * 0.031))}px system-ui, sans-serif`;
    ctx.fillText(String(pocket), pocketRing * 0.86, 0); ctx.restore();
  });
  ctx.beginPath(); ctx.arc(centre, centre, hub, 0, Math.PI * 2); const hubFill = ctx.createRadialGradient(centre, centre * 0.8, hub * 0.1, centre, centre, hub); hubFill.addColorStop(0, '#232833'); hubFill.addColorStop(1, '#0c1016'); ctx.fillStyle = hubFill; ctx.fill(); ctx.lineWidth = size * 0.006; ctx.strokeStyle = 'rgb(212 175 55 / 45%)'; ctx.stroke();
  ctx.strokeStyle = 'rgb(255 255 255 / 12%)'; ctx.lineWidth = size * 0.004; for (let spoke = 0; spoke < 4; spoke += 1) { const angle = frame.rotation + (spoke * Math.PI) / 2; ctx.beginPath(); ctx.moveTo(centre, centre); ctx.lineTo(centre + Math.cos(angle) * hub * 0.92, centre + Math.sin(angle) * hub * 0.92); ctx.stroke(); }
  const ballDistance = rim * frame.ballFactor; const ballX = centre + Math.cos(frame.ballAngle) * ballDistance; const ballY = centre + Math.sin(frame.ballAngle) * ballDistance;
  ctx.beginPath(); ctx.arc(ballX, ballY, size * 0.016, 0, Math.PI * 2); ctx.fillStyle = '#fdfdfd'; ctx.shadowColor = 'rgb(0 0 0 / 65%)'; ctx.shadowBlur = size * 0.012; ctx.fill(); ctx.shadowBlur = 0;
}

const WHEEL_SIZE = 440;

export default function ClassicRoulette() {
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [amount, setAmount] = useState(String(DEFAULT_BET));
  const [config, setConfig] = useState<ClassicRouletteConfig>(FALLBACK_CONFIG);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<ClassicRouletteResult | null>(null);
  const [history, setHistory] = useState<{ pocket: number; color: PocketColor }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<WheelFrame>({ rotation: 0, ballAngle: -Math.PI / 2, ballFactor: 0.95, highlight: null });
  const configRef = useRef(config);
  const unmounted = useRef(false);

  useEffect(() => { configRef.current = config; }, [config]);
  useEffect(() => { unmounted.current = false; return () => { unmounted.current = true; }; }, []);

  const repaint = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(WHEEL_SIZE * dpr)) { canvas.width = Math.round(WHEEL_SIZE * dpr); canvas.height = Math.round(WHEEL_SIZE * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintWheel(ctx, WHEEL_SIZE, configRef.current, frameRef.current);
  }, []);

  useEffect(() => { repaint(); }, [repaint, config]);

  const refreshBalance = useCallback(async () => {
    try { setBalance(await fetchBalance()); setBalanceError(null); }
    catch (requestError) { setBalanceError(getApiErrorMessage(requestError, 'Could not load your balance.')); }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try { const value = await fetchBalance(); if (!cancelled) setBalance(value); }
      catch (requestError) { if (!cancelled) setBalanceError(getApiErrorMessage(requestError, 'Could not load your balance.')); }
      try { const next = await fetchConfig(); if (!cancelled) setConfig(next); } catch { /* fallback */ }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  const stake = Number(amount);
  const validStake = Number.isFinite(stake) && stake > 0 ? Math.round(stake * 100) / 100 : 0;

  function select(next: Selection): void {
    if (spinning) return;
    playSound('click'); setSelection(next); setResult(null); frameRef.current.highlight = null; repaint();
  }

  async function spin(): Promise<void> {
    if (spinning) return;
    if (!selection) { setError('Pick a number or one of the outside bets first.'); return; }
    if (validStake <= 0) { setError('Enter a bet amount greater than 0.'); return; }
    setSpinning(true); setError(null); setResult(null); playSound('click');
    try {
      const { data } = await api.post<ClassicRouletteResult>('/game/classic_roulette/play', { betAmount: validStake, betType: selection.type, betValue: selection.type === 'number' ? selection.value : undefined });
      setBalance(data.balanceAfter);
      const twoPi = Math.PI * 2; const step = twoPi / configRef.current.pockets; const wanted = -Math.PI / 2 - (data.wheelIndex + 0.5) * step; const from = frameRef.current.rotation;
      let delta = (wanted - from) % twoPi; if (delta < 0) delta += twoPi; const target = from + SPIN_TURNS * twoPi + delta;
      playSound('spin', { durationMs: SPIN_MS });
      const started = performance.now();
      await new Promise<void>((resolve) => {
        const tick = (now: number) => {
          if (unmounted.current) { resolve(); return; }
          const progress = Math.min(1, (now - started) / SPIN_MS); const eased = 1 - (1 - progress) ** 4;
          const bouncePhase = Math.max(0, (progress - 0.72) / 0.28); const bounce = Math.sin(bouncePhase * Math.PI * 3) * (1 - progress) * 0.035;
          frameRef.current = { rotation: from + (target - from) * eased, ballAngle: -Math.PI / 2 - (1 - eased) * twoPi * 4, ballFactor: 0.95 - 0.18 * eased + bounce, highlight: progress > 0.985 ? data.wheelIndex : null };
          repaint();
          if (progress < 1) requestAnimationFrame(tick); else resolve();
        };
        requestAnimationFrame(tick);
      });
      frameRef.current = { rotation: target, ballAngle: -Math.PI / 2, ballFactor: 0.77, highlight: data.wheelIndex }; repaint();
      setResult(data); setHistory((previous) => [{ pocket: data.pocket, color: data.pocketColor }, ...previous].slice(0, 9));
      playSound(data.payout > 0 ? 'win' : 'lose');
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'The spin could not be completed.')); void refreshBalance();
    } finally { if (!unmounted.current) setSpinning(false); }
  }

  const cellNumbers = Array.from({ length: 36 }, (_, index) => index + 1);
  const isPicked = (type: RouletteBetType, value: number | null): boolean => selection?.type === type && selection.value === value;

  return (
    <GameShell balance={balance} balanceError={balanceError} onBack={() => window.history.back()} betAmount={validStake} setBetAmount={(value) => setAmount(String(value))} onSpin={() => void spin()} spinLabel={spinning ? 'SPINNING' : 'SPIN'} isSpinning={spinning} disabled={!selection} controls={<span className="panel-label">{selection ? `Bet: ${betLabel(selection)}` : 'Pick a bet'}</span>}>
      <section className="rt__stage">
        <div className="cr-layout">
          <div className="cr-wheel-wrap">
            <canvas ref={canvasRef} className="cr-wheel" role="img" aria-label="European roulette wheel, 37 pockets" />
            <span className="cr-wheel__marker" aria-hidden="true" />
            {result && !spinning && (
              <div className={`cr-outcome cr-outcome--${result.pocketColor}`} role="status" aria-live="polite">
                <span className="cr-outcome__pocket">{result.pocket}</span>
                <span className="cr-outcome__colour">{result.pocketColor}</span>
              </div>
            )}
          </div>
          <div className="cr-bets">
            <div className="cr-table">
              <button type="button" className={`cr-zero${isPicked('number', 0) ? ' cr-cell--picked' : ''}`} onClick={() => select({ type: 'number', value: 0 })} disabled={spinning}>0</button>
              <div className="cr-numbers">
                {cellNumbers.map((pocket) => (
                  <button key={pocket} type="button" className={`cr-num cr-num--${colourOf(pocket, config.redNumbers)}${isPicked('number', pocket) ? ' cr-cell--picked' : ''}`} onClick={() => select({ type: 'number', value: pocket })} disabled={spinning} aria-pressed={isPicked('number', pocket)} aria-label={`Number ${pocket}, ${colourOf(pocket, config.redNumbers)}`}>{pocket}</button>
                ))}
              </div>
            </div>
            <div className="cr-outside">
              {OUTSIDE_BETS.map((bet) => (
                <button key={bet.type} type="button" className={`cr-outside__box cr-outside__box--${bet.type}${isPicked(bet.type, null) ? ' cr-cell--picked' : ''}`} onClick={() => select({ type: bet.type, value: null })} disabled={spinning} aria-pressed={isPicked(bet.type, null)}>{bet.label}</button>
              ))}
            </div>
            <p className="cr-hint">Straight {config.payouts.number}× · outside {config.payouts.red}×</p>
          </div>
        </div>
        {history.length > 0 && (
          <div className="cr-history" aria-label="Recent pockets">
            {history.map((entry, index) => <span key={index} className={`cr-history__chip cr-history__chip--${entry.color}`}>{entry.pocket}</span>)}
          </div>
        )}
        {result && !spinning && (
          <div className={`cr-result cr-result--${result.won ? 'won' : 'lost'}`} role="status" aria-live="polite">
            <p className="cr-result__headline">{result.won ? 'WINNER!' : `${result.pocket} ${result.pocketColor}`}</p>
            <p className="cr-result__amount">{result.won ? `+${money(result.payout - result.betAmount)}` : `-${money(result.betAmount)}`}</p>
          </div>
        )}
        {error && <p className="error">{error}</p>}
      </section>
    </GameShell>
  );
}
