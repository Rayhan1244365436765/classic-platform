import { useCallback, useEffect, useRef, useState } from 'react';

import { api, getApiErrorMessage } from '../api/client';
import type { BalanceResponse, PlinkoConfig, PlinkoResult } from '../api/types';
import { GameShell } from '../components/GameShell';
import { GameResultOverlay } from '../components/GameResultOverlay';
import { playSound } from '../utils/sound';

/**
 * Plinko — 8-row peg pyramid, 9 slots.
 *
 * The server settles the drop immediately (it returns the ball's path and the
 * slot); this page replays that path as an animation, so the artwork can never
 * disagree with the payout: the ball is drawn along the exact L/R steps the
 * backend rolled, and the slot it reaches is the slot that was paid.
 */

const ROWS = 8;
const SLOTS = 9;

/** Logical canvas size; CSS scales it to the container. */
const CANVAS_W = 720;
const CANVAS_H = 560;
const PEG_TOP_Y = 82;
const PEG_GAP_X = 62;
const PEG_GAP_Y = 47;
const BALL_RADIUS = 10;
/** One hop between pegs, then the drop into the slot. */
const HOP_MS = 115;
const DROP_MS = 150;

/** Fallback pay table — mirrors the backend. */
const FALLBACK_MULTIPLIERS = [5.49, 2.05, 1.08, 0.98, 0.49, 0.98, 1.08, 2.05, 5.49];
const DEFAULT_BET = 10;

type Phase = 'idle' | 'dropping' | 'landed';

type Point = { x: number; y: number };

function slotTopY(): number {
  return PEG_TOP_Y + ROWS * PEG_GAP_Y + 8;
}

/** Centre of slot `index`. */
function slotCentre(index: number): Point {
  return {
    x: CANVAS_W / 2 + (index - (SLOTS - 1) / 2) * PEG_GAP_X,
    y: slotTopY() + 26,
  };
}

/** Peg centres for row `row` (0 = single top peg). */
function pegRow(row: number): Point[] {
  return Array.from({ length: row + 1 }, (_, column) => ({
    x: CANVAS_W / 2 + (column - row / 2) * PEG_GAP_X,
    y: PEG_TOP_Y + row * PEG_GAP_Y,
  }));
}

/** Ball centre after each hop of `path`. */
function buildWaypoints(path: readonly ('L' | 'R')[]): Point[] {
  const points: Point[] = [{ x: CANVAS_W / 2, y: 34 }];
  let x = CANVAS_W / 2;

  path.forEach((step, index) => {
    x += step === 'R' ? PEG_GAP_X / 2 : -PEG_GAP_X / 2;
    points.push({ x, y: PEG_TOP_Y + (index + 1) * PEG_GAP_Y - 10 });
  });

  return points;
}

function slotColor(multiplier: number): { fill: string; text: string } {
  if (multiplier >= 5) {
    return { fill: '#f4c430', text: '#241a04' };
  }
  if (multiplier >= 2) {
    return { fill: '#22c55e', text: '#04240f' };
  }
  if (multiplier >= 1) {
    return { fill: '#3b82f6', text: '#f0f7ff' };
  }
  return { fill: '#475569', text: '#e2e8f0' };
}

async function fetchBalance(): Promise<number> {
  const { data } = await api.get<BalanceResponse>('/wallet/balance');
  return data.balance;
}

async function fetchConfig(): Promise<PlinkoConfig> {
  const { data } = await api.get<PlinkoConfig>('/game/plinko/config');
  return data;
}

/** Draws the board, the ball (if any) and the winning slot glow. */
function paintBoard(
  ctx: CanvasRenderingContext2D,
  multipliers: readonly number[],
  ball: Point | null,
  landedSlot: number | null,
  glow: number,
): void {
  const slotTop = slotTopY();

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

  // Board backdrop.
  const sky = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
  sky.addColorStop(0, '#0d1424');
  sky.addColorStop(0.55, '#0a0f1b');
  sky.addColorStop(1, '#05070d');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  const halo = ctx.createRadialGradient(CANVAS_W / 2, 40, 20, CANVAS_W / 2, 40, 360);
  halo.addColorStop(0, 'rgba(99, 102, 241, 0.18)');
  halo.addColorStop(1, 'rgba(99, 102, 241, 0)');
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // Pegs.
  for (let row = 0; row < ROWS; row += 1) {
    for (const peg of pegRow(row)) {
      ctx.beginPath();
      ctx.arc(peg.x, peg.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#94a3b8';
      ctx.shadowColor = 'rgba(148, 163, 184, 0.6)';
      ctx.shadowBlur = 10;
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.beginPath();
      ctx.arc(peg.x - 1.4, peg.y - 1.6, 1.8, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
      ctx.fill();
    }
  }

  // Slots.
  for (let index = 0; index < SLOTS; index += 1) {
    const centre = slotCentre(index);
    const multiplier = multipliers[index] ?? 0;
    const palette = slotColor(multiplier);
    const isWinner = landedSlot === index;
    const width = PEG_GAP_X - 6;
    const height = 46;
    const x = centre.x - width / 2;
    const y = slotTop - height / 2 + 26;

    if (isWinner) {
      const flare = ctx.createRadialGradient(centre.x, y + height / 2, 4, centre.x, y + height / 2, 66);
      flare.addColorStop(0, `rgba(255, 236, 180, ${0.55 * glow})`);
      flare.addColorStop(1, 'rgba(255, 236, 180, 0)');
      ctx.fillStyle = flare;
      ctx.beginPath();
      ctx.arc(centre.x, y + height / 2, 66, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.beginPath();
    ctx.roundRect(x, y, width, height, 10);
    ctx.fillStyle = palette.fill;
    ctx.globalAlpha = isWinner ? 1 : landedSlot === null ? 0.92 : 0.55;
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.lineWidth = isWinner ? 2.5 : 1;
    ctx.strokeStyle = isWinner
      ? `rgba(255, 255, 255, ${0.55 + 0.45 * glow})`
      : 'rgba(8, 12, 22, 0.55)';
    ctx.stroke();

    ctx.fillStyle = palette.text;
    ctx.font = `800 ${multiplier >= 5 ? 15 : 14}px "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${multiplier.toFixed(2)}x`, centre.x, y + height / 2);
  }

  // Ball.
  if (ball) {
    const trail = ctx.createRadialGradient(ball.x, ball.y, 1, ball.x, ball.y, BALL_RADIUS * 3.2);
    trail.addColorStop(0, 'rgba(255, 236, 180, 0.75)');
    trail.addColorStop(1, 'rgba(249, 115, 22, 0)');
    ctx.fillStyle = trail;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, BALL_RADIUS * 3.2, 0, Math.PI * 2);
    ctx.fill();

    const body = ctx.createRadialGradient(
      ball.x - 3,
      ball.y - 4,
      1,
      ball.x,
      ball.y,
      BALL_RADIUS,
    );
    body.addColorStop(0, '#ffffff');
    body.addColorStop(0.55, '#fcd34d');
    body.addColorStop(1, '#d97706');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, BALL_RADIUS, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Ball position for a drop that started `elapsedMs` ago. */
function ballAt(
  waypoints: Point[],
  landing: Point,
  elapsedMs: number,
): { point: Point; done: boolean } {
  const hops = waypoints.length - 1;
  const hopTime = elapsedMs;

  if (hopTime < hops * HOP_MS) {
    const index = Math.floor(hopTime / HOP_MS);
    const t = (hopTime - index * HOP_MS) / HOP_MS;
    // Ease-out per hop + a small arc, so it looks like it bounces off the pegs.
    const eased = 1 - (1 - t) ** 2;
    const from = waypoints[index]!;
    const to = waypoints[index + 1]!;
    const arc = Math.sin(Math.PI * t) * 6;

    return {
      point: {
        x: from.x + (to.x - from.x) * eased,
        y: from.y + (to.y - from.y) * eased - arc,
      },
      done: false,
    };
  }

  const last = waypoints[waypoints.length - 1]!;
  const t = Math.min(1, (hopTime - hops * HOP_MS) / DROP_MS);
  const eased = t ** 0.6;

  return {
    point: { x: last.x, y: last.y + (landing.y - last.y) * eased },
    done: t >= 1,
  };
}

export default function Plinko() {
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);

  const [amount, setAmount] = useState(String(DEFAULT_BET));
  const [config, setConfig] = useState<PlinkoConfig | null>(null);
  const multipliers = config?.multipliers ?? FALLBACK_MULTIPLIERS;

  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<PlinkoResult | null>(null);
  const [history, setHistory] = useState<PlinkoResult[]>([]);
  const [showWin, setShowWin] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const waypointsRef = useRef<Point[]>([]);
  const landingRef = useRef<Point>(slotCentre(4));
  const startedAtRef = useRef(0);
  const ballRef = useRef<Point | null>(null);
  const landedSlotRef = useRef<number | null>(null);
  const glowRef = useRef(0);
  const phaseRef = useRef<Phase>('idle');
  const resultRef = useRef<PlinkoResult | null>(null);
  const multipliersRef = useRef<readonly number[]>(multipliers);
  const lastHopRef = useRef(-1);

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
        if (!cancelled && value.multipliers.length === SLOTS) {
          setConfig(value);
          multipliersRef.current = value.multipliers;
        }
      } catch {
        // The fallback table matches the backend; the game still works.
      }
    }

    void load();
    void loadConfig();

    return () => {
      cancelled = true;
    };
  }, []);

  // One animation loop owns the canvas: it draws the board and advances the
  // ball along the path the server returned.
  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) {
      return undefined;
    }

    let frame = 0;

    const render = (now: number) => {
      if (phaseRef.current === 'dropping' || phaseRef.current === 'landed') {
        const elapsed = now - startedAtRef.current;
        const { point, done } = ballAt(waypointsRef.current, landingRef.current, elapsed);

        ballRef.current = point;

        // A tick for every peg the ball touches.
        const hop = Math.floor(elapsed / HOP_MS);
        if (phaseRef.current === 'dropping' && hop > lastHopRef.current) {
          lastHopRef.current = hop;
          playSound('click');
        }

        if (done && phaseRef.current === 'dropping') {
          phaseRef.current = 'landed';
          setPhase('landed');
          landedSlotRef.current = resultRef.current?.slot ?? null;
          glowRef.current = 1;
          setShowWin((resultRef.current?.multiplier ?? 0) >= 1);
          playSound((resultRef.current?.multiplier ?? 0) >= 1 ? 'win' : 'lose');
        }

        if (phaseRef.current === 'landed') {
          glowRef.current = Math.max(0.25, glowRef.current - 0.015);
        }
      }

      paintBoard(
        ctx,
        multipliersRef.current,
        ballRef.current,
        landedSlotRef.current,
        glowRef.current,
      );

      frame = window.requestAnimationFrame(render);
    };

    frame = window.requestAnimationFrame(render);

    return () => window.cancelAnimationFrame(frame);
  }, []);

  async function drop() {
    if (phase === 'dropping') {
      return;
    }

    setError(null);

    const stake = Number(amount);
    if (!Number.isFinite(stake) || stake <= 0) {
      setError('Enter a bet amount greater than 0.');
      return;
    }

    setResult(null);
    setShowWin(false);
    landedSlotRef.current = null;
    glowRef.current = 0;
    lastHopRef.current = -1;

    try {
      const { data } = await api.post<PlinkoResult>('/game/plinko/play', {
        betAmount: stake,
        rows: ROWS,
      });

      // Replay exactly the route the server settled.
      waypointsRef.current = buildWaypoints(data.path);
      landingRef.current = slotCentre(data.slot);
      resultRef.current = data;
      ballRef.current = waypointsRef.current[0]!;
      startedAtRef.current = performance.now();
      phaseRef.current = 'dropping';

      setResult(data);
      setPhase('dropping');
      setHistory((previous) => [data, ...previous].slice(0, 6));
      setBalance(data.balanceAfter);
      void refreshBalance();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'The ball could not be dropped.'));
      void refreshBalance();
    }
  }

  const stake = Number(amount) || 0;
  const previewStake = stake > 0 ? stake : DEFAULT_BET;
  const dropping = phase === 'dropping';

  return (
    <GameShell
      balance={balance}
      balanceError={balanceError}
      onBack={() => window.history.back()}
      betAmount={previewStake}
      setBetAmount={(value) => setAmount(String(value))}
      onSpin={() => void drop()}
      spinLabel={dropping ? 'DROPPING' : 'DROP'}
      isSpinning={dropping}
      controls={
        <div className="plinko-history" aria-label="Recent drops" style={{ display: 'flex', gap: 6, overflowX: 'auto' }}>
          {history.length === 0 ? (
            <span className="plinko-history__empty">no drops yet</span>
          ) : (
            history.map((entry, index) => (
              <span
                key={`${entry.roundId}-${index}`}
                className={`plinko-history__pill ${
                  entry.multiplier >= 2
                    ? 'plinko-history__pill--high'
                    : entry.multiplier >= 1
                      ? 'plinko-history__pill--even'
                      : 'plinko-history__pill--low'
                }`}
                title={`Slot ${entry.slot + 1}`}
              >
                {entry.multiplier.toFixed(2)}×
              </span>
            ))
          )}
        </div>
      }
    >
      <section className="rt__stage">
        <div className={`plinko${dropping ? ' plinko--dropping' : ''}`}>
          <canvas ref={canvasRef} width={CANVAS_W} height={CANVAS_H} className="plinko__board" />
        </div>

        {result && (
          <GameResultOverlay
            isOpen={showWin}
            isWin={result.multiplier >= 1}
            amount={result.payout}
            multiplier={result.multiplier}
            detail={`Slot ${result.slot + 1} of ${SLOTS}`}
            onClose={() => setShowWin(false)}
          />
        )}

        <p className="rt__fair">
          Provably fair · seed hash published before every drop · {ROWS} rows, {SLOTS} slots
        </p>
        {error && <p className="error">{error}</p>}
      </section>
    </GameShell>
  );
}



