import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { api, getApiErrorMessage } from '../api/client';
import type {
  AviatorConfig,
  AviatorOutcome,
  AviatorStart,
  BalanceResponse,
} from '../api/types';
import { ArrowLeftIcon, WalletIcon } from '../components/Icons';
import { GameBottomBar } from '../components/GameBottomBar';
import { GameResultOverlay } from '../components/GameResultOverlay';
import { LivePlayerBadge } from '../components/LivePlayerBadge';
import { SoundToggle } from '../components/SoundToggle';
import {
  playSound,
  startFlightTone,
  stopFlightTone,
  updateFlightTone,
} from '../utils/sound';

/**
 * Aviator — a crash game.
 *
 * Rendering split (deliberate):
 *   • the **plane** is a DOM element (inline SVG) sized in CSS px, so it is big,
 *     crisp and GPU-composited — never at the mercy of canvas scaling;
 *   • the **sky, stars, clouds, speed lines, fire trail and burst** are canvas.
 *
 * Motion: the plane follows the flight arc plus a smooth sine glide
 * `y = arcY(progress) + sin(clock) * amplitude`, evaluated every frame from the
 * animation clock. No randomness and no jitter anywhere: the same function
 * feeds the plane and the trail, so the flame follows the jet exactly.
 */

const DEFAULT_BET = 10;
/** Used only if the config request fails — mirrors the backend constants. */
const FALLBACK_CONFIG: AviatorConfig = { growthTauMs: 5500, crashCap: 100, minCashout: 1.01 };
/** Logical canvas size; CSS scales it to the container. */
const CANVAS_W = 900;
const CANVAS_H = 430;

/** Sine glide: one full up-and-down every ~4.4 s, ±46 canvas units (~37 px). */
const WAVE_PERIOD_MS = 700;
const WAVE_AMPLITUDE = 46;
/** Small pitch that follows the glide (radians). */
const WAVE_PITCH = 0.055;

type Phase = 'idle' | 'starting' | 'flying' | 'settling' | 'cashed_out' | 'crashed';

/** Auto cash-out preference (toggle + target) survives reloads. */
const AUTO_STORAGE_KEY = 'casino.aviator.autoCashout';
const DEFAULT_AUTO_TARGET = '2.00';

/** Reads the saved preference; anything missing or out of range falls back to off @ 2.00x. */
function readAutoCashout(): { enabled: boolean; target: string } {
  try {
    const raw = window.localStorage.getItem(AUTO_STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as { enabled?: unknown; target?: unknown };
      const target = Number(saved.target);

      if (
        typeof saved.enabled === 'boolean' &&
        Number.isFinite(target) &&
        target >= FALLBACK_CONFIG.minCashout &&
        target <= FALLBACK_CONFIG.crashCap
      ) {
        return { enabled: saved.enabled, target: target.toFixed(2) };
      }
    }
  } catch {
    // Private mode or corrupt JSON: use the defaults.
  }

  return { enabled: false, target: DEFAULT_AUTO_TARGET };
}

function money(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  const fractionDigits = rounded % 1 === 0 ? 0 : 2;

  return `$${rounded.toLocaleString('en-US', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: 2,
  })}`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Rounds *down* to the cent, so a live amount is never shown above what pays. */
function floorToCent(value: number): number {
  // The epsilon absorbs float noise (e.g. 22.999999999999996 for a true 23.00).
  return Math.floor(value * 100 + 1e-9) / 100;
}

function multiplierAt(elapsedMs: number, tauMs: number): number {
  return Math.exp(Math.max(0, elapsedMs) / tauMs);
}

/** 0 → 1 progress of the flight, in log space so the curve looks linear. */
function progressOf(multiplier: number, cap: number): number {
  return Math.min(1, Math.max(0, Math.log(Math.max(1, multiplier)) / Math.log(cap)));
}

/**
 * The arc the jet climbs along (canvas units). The margins leave room for the
 * full jet sprite (~105 units each side) so it never clips at the edges.
 */
function curvePoint(progress: number): { x: number; y: number } {
  return {
    x: 120 + progress * 640,
    y: CANVAS_H - 70 - progress ** 0.8 * (CANVAS_H - 190),
  };
}

/**
 * Smooth heading of the arc: fixed central difference (never collapses when two
 * samples coincide) faded in over the first 4% of the flight, so the jet rotates
 * off the runway instead of snapping.
 */
function arcAngle(progress: number): number {
  const span = 0.05;
  const from = curvePoint(Math.max(0, progress - span));
  const to = curvePoint(Math.min(1, progress + span));
  const dx = to.x - from.x;
  const tangent = dx === 0 ? 0 : Math.atan2(to.y - from.y, dx);
  const ramp = Math.min(1, Math.max(0, progress) / 0.04);

  return tangent * ramp;
}

/** Plane position for a flight that started `elapsedMs` ago. */
function planePosition(
  elapsedMs: number,
  tauMs: number,
  cap: number,
  clock: number,
): { x: number; y: number; angle: number } {
  const progress = progressOf(multiplierAt(elapsedMs, tauMs), cap);
  const base = curvePoint(progress);

  // Ramp the wave in so the jet waits still on the runway, then glides.
  const ramp = Math.min(1, progress / 0.05);
  const pace = clock / WAVE_PERIOD_MS;
  const wave = Math.sin(pace) * WAVE_AMPLITUDE * ramp;

  return { x: base.x, y: base.y + wave, angle: arcAngle(progress) + Math.cos(pace) * WAVE_PITCH };
}

/** Where the jet waits before take-off. */
const RUNWAY = curvePoint(0);

async function fetchBalance(): Promise<number> {
  const { data } = await api.get<BalanceResponse>('/wallet/balance');
  return data.balance;
}

async function fetchConfig(): Promise<AviatorConfig> {
  const { data } = await api.get<AviatorConfig>('/game/aviator/config');
  return data;
}

/* ==========================================================================
   Background: night sky, stars, clouds, speed lines
   ========================================================================== */

type Star = { x: number; y: number; radius: number; phase: number; speed: number };
type SpeedLine = { y: number; x: number; length: number; speed: number; alpha: number };
type Cloud = { x: number; y: number; scale: number; speed: number; alpha: number };

/** Deterministic scatter — stable across renders, no Math.random in the loop. */
function scatter(seed: number): () => number {
  let value = seed;
  return () => {
    value = (value * 9301 + 49297) % 233280;
    return value / 233280;
  };
}

const STAR_FIELD: Star[] = (() => {
  const next = scatter(7331);
  return Array.from({ length: 64 }, () => ({
    x: next() * CANVAS_W,
    y: next() * CANVAS_H * 0.82 + 6,
    radius: 0.6 + next() * 1.5,
    phase: next() * Math.PI * 2,
    speed: 900 + next() * 2100,
  }));
})();

const SPEED_LINES: SpeedLine[] = (() => {
  const next = scatter(4177);
  return Array.from({ length: 22 }, () => ({
    y: next() * CANVAS_H,
    x: next() * CANVAS_W,
    length: 40 + next() * 110,
    speed: 260 + next() * 420,
    alpha: 0.05 + next() * 0.14,
  }));
})();

const CLOUDS: Cloud[] = (() => {
  const next = scatter(20261);
  return Array.from({ length: 6 }, () => ({
    x: next() * (CANVAS_W + 300),
    y: 40 + next() * (CANVAS_H - 150),
    scale: 0.55 + next() * 0.7,
    speed: 14 + next() * 26,
    alpha: 0.1 + next() * 0.11,
  }));
})();

let cloudSprite: HTMLCanvasElement | null = null;

/** Soft blob-cluster cloud baked to an offscreen canvas (cheap to re-draw). */
function getCloudSprite(): HTMLCanvasElement | null {
  if (cloudSprite) {
    return cloudSprite;
  }

  if (typeof document === 'undefined') {
    return null;
  }

  const width = 340;
  const height = 190;
  const sprite = document.createElement('canvas');
  sprite.width = width;
  sprite.height = height;

  const paint = sprite.getContext('2d');
  if (!paint) {
    return null;
  }

  const puffs: [number, number, number][] = [
    [0.5, 0.58, 0.42],
    [0.28, 0.66, 0.3],
    [0.72, 0.64, 0.32],
    [0.42, 0.44, 0.26],
    [0.62, 0.46, 0.24],
    [0.5, 0.76, 0.3],
  ];

  for (const [cx, cy, radius] of puffs) {
    const gradient = paint.createRadialGradient(
      cx * width,
      cy * height,
      0,
      cx * width,
      cy * height,
      radius * width,
    );
    gradient.addColorStop(0, 'rgba(214, 224, 245, 0.85)');
    gradient.addColorStop(0.55, 'rgba(186, 200, 232, 0.4)');
    gradient.addColorStop(1, 'rgba(170, 186, 220, 0)');
    paint.fillStyle = gradient;
    paint.beginPath();
    paint.arc(cx * width, cy * height, radius * width, 0, Math.PI * 2);
    paint.fill();
  }

  cloudSprite = sprite;

  return cloudSprite;
}

function drawSky(ctx: CanvasRenderingContext2D): void {
  const sky = ctx.createLinearGradient(0, 0, CANVAS_W * 0.35, CANVAS_H);
  sky.addColorStop(0, '#0b1030');
  sky.addColorStop(0.45, '#0a0f26');
  sky.addColorStop(0.78, '#0d0a20');
  sky.addColorStop(1, '#05060f');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  const nebulaA = ctx.createRadialGradient(140, 60, 10, 140, 60, 340);
  nebulaA.addColorStop(0, 'rgba(99, 102, 241, 0.22)');
  nebulaA.addColorStop(1, 'rgba(99, 102, 241, 0)');
  ctx.fillStyle = nebulaA;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  const nebulaB = ctx.createRadialGradient(760, 40, 10, 760, 40, 320);
  nebulaB.addColorStop(0, 'rgba(168, 85, 247, 0.2)');
  nebulaB.addColorStop(1, 'rgba(168, 85, 247, 0)');
  ctx.fillStyle = nebulaB;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  const horizon = ctx.createLinearGradient(0, CANVAS_H - 90, 0, CANVAS_H);
  horizon.addColorStop(0, 'rgba(56, 189, 248, 0)');
  horizon.addColorStop(1, 'rgba(56, 189, 248, 0.14)');
  ctx.fillStyle = horizon;
  ctx.fillRect(0, CANVAS_H - 90, CANVAS_W, 90);

  // Runway line.
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, CANVAS_H - 30);
  ctx.lineTo(CANVAS_W, CANVAS_H - 30);
  ctx.stroke();
}

function drawStars(ctx: CanvasRenderingContext2D, now: number, intensity: number): void {
  const driftSpeed = Math.min(1.6, intensity);

  for (const star of STAR_FIELD) {
    const travel =
      ((star.x - (now * star.speed * 0.012 * driftSpeed) / 1000) % CANVAS_W + CANVAS_W) % CANVAS_W;
    const twinkle = 0.45 + 0.55 * Math.abs(Math.sin(now / star.speed + star.phase));

    ctx.globalAlpha = twinkle;
    ctx.fillStyle = star.radius > 1.5 ? '#e0f2fe' : '#cbd5e1';
    ctx.beginPath();
    ctx.arc(travel, star.y, star.radius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalAlpha = 1;
}

function drawClouds(ctx: CanvasRenderingContext2D, now: number, intensity: number): void {
  const sprite = getCloudSprite();
  if (!sprite) {
    return;
  }

  const span = CANVAS_W + 360;

  for (const cloud of CLOUDS) {
    const travel = (cloud.x - (now * cloud.speed * Math.min(2.2, intensity)) / 1000) % span;
    const x = ((travel + span) % span) - 180;
    const width = sprite.width * cloud.scale * 0.55;
    const height = sprite.height * cloud.scale * 0.55;

    ctx.globalAlpha = cloud.alpha;
    ctx.drawImage(sprite, x - width / 2, cloud.y - height / 2, width, height);
  }

  ctx.globalAlpha = 1;
}

function drawSpeedLines(ctx: CanvasRenderingContext2D, now: number, intensity: number): void {
  if (intensity <= 0) {
    return;
  }

  ctx.lineCap = 'round';
  for (const line of SPEED_LINES) {
    const travel =
      ((line.x - (now * line.speed * intensity) / 1000) % (CANVAS_W + line.length) +
        CANVAS_W +
        line.length) %
      (CANVAS_W + line.length);
    const x = travel - line.length;

    ctx.strokeStyle = `rgba(186, 230, 253, ${line.alpha * Math.min(1, intensity)})`;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x, line.y);
    ctx.lineTo(x + line.length * (0.5 + intensity * 0.3), line.y);
    ctx.stroke();
  }
}

/* ==========================================================================
   Fire trail + burst
   ========================================================================== */

type Point = { x: number; y: number };

/**
 * Thick glowing fire trail. `points` is the plane's recorded path (one entry per
 * frame), so the flame always sits exactly behind the jet. Three strokes over a
 * single Path2D: wide haze, flame body (lineWidth 18) and a hot core.
 */
function drawTrail(ctx: CanvasRenderingContext2D, points: Point[], fade: number): void {
  if (points.length < 2 || fade <= 0) {
    return;
  }

  const head = points[points.length - 1]!;
  const tail = points[0]!;

  const flame = ctx.createLinearGradient(tail.x, tail.y, head.x, head.y);
  flame.addColorStop(0, `rgba(120, 20, 0, ${0.05 * fade})`);
  flame.addColorStop(0.3, `rgba(220, 38, 38, ${0.32 * fade})`);
  flame.addColorStop(0.65, `rgba(249, 115, 22, ${0.6 * fade})`);
  flame.addColorStop(0.88, `rgba(251, 191, 36, ${0.85 * fade})`);
  flame.addColorStop(1, `rgba(255, 244, 214, ${0.95 * fade})`);

  const path = new Path2D();
  path.moveTo(tail.x, tail.y);
  for (const point of points) {
    path.lineTo(point.x, point.y);
  }

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.shadowColor = 'rgba(249, 115, 22, 0.9)';

  const passes: { width: number; alpha: number; blur: number }[] = [
    { width: 40, alpha: 0.14, blur: 34 },
    { width: 18, alpha: 0.55, blur: 20 },
    { width: 7, alpha: 0.95, blur: 10 },
  ];

  for (const pass of passes) {
    ctx.globalAlpha = Math.min(1, pass.alpha * fade);
    ctx.lineWidth = pass.width;
    ctx.shadowBlur = pass.blur;
    ctx.strokeStyle = flame;
    ctx.stroke(path);
  }

  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;

  // Nozzle flare.
  const flare = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, 46);
  flare.addColorStop(0, `rgba(255, 255, 245, ${0.8 * fade})`);
  flare.addColorStop(0.45, `rgba(251, 146, 60, ${0.4 * fade})`);
  flare.addColorStop(1, 'rgba(239, 68, 68, 0)');
  ctx.fillStyle = flare;
  ctx.beginPath();
  ctx.arc(head.x, head.y, 46, 0, Math.PI * 2);
  ctx.fill();
}

/** Expanding fireball, shockwave ring, 💥 and rising smoke. */
function drawExplosion(ctx: CanvasRenderingContext2D, x: number, y: number, progress: number): void {
  const p = Math.max(0, progress);
  const fade = Math.max(0, 1 - Math.max(0, p - 1) / 0.7);
  if (fade <= 0) {
    return;
  }

  ctx.beginPath();
  ctx.arc(x, y, 10 + p * 80, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(251, 191, 36, ${0.55 * Math.max(0, 1 - p) * fade})`;
  ctx.lineWidth = Math.max(1, 7 * (1 - p));
  ctx.stroke();

  for (let index = 0; index < 18; index += 1) {
    const angle = (index / 18) * Math.PI * 2 + p * 0.7;
    const inner = 8 + p * 26;
    const outer = inner + (36 + (index % 4) * 14) * (1 - p * 0.55);
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(angle) * inner, y + Math.sin(angle) * inner);
    ctx.lineTo(x + Math.cos(angle) * outer, y + Math.sin(angle) * outer);
    ctx.strokeStyle =
      index % 2 === 0
        ? `rgba(253, 224, 71, ${0.85 * Math.max(0, 1 - p) * fade})`
        : `rgba(248, 113, 113, ${0.75 * Math.max(0, 1 - p) * fade})`;
    ctx.lineWidth = Math.max(0.8, 3.4 * (1 - p));
    ctx.stroke();
  }

  const flash = Math.max(0, 1 - p * 1.7);
  if (flash > 0) {
    const core = ctx.createRadialGradient(x, y, 2, x, y, 70 + p * 44);
    core.addColorStop(0, `rgba(255, 255, 255, ${0.95 * flash})`);
    core.addColorStop(0.35, `rgba(253, 186, 116, ${0.6 * flash})`);
    core.addColorStop(1, 'rgba(239, 68, 68, 0)');
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(x, y, 70 + p * 44, 0, Math.PI * 2);
    ctx.fill();
  }

  const bang = Math.max(0, 1 - Math.max(0, p - 0.35) / 0.75);
  if (bang > 0) {
    ctx.save();
    ctx.globalAlpha = bang;
    ctx.translate(x, y);
    ctx.scale(1 + p * 0.5, 1 + p * 0.5);
    ctx.font = '46px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('💥', 0, 0);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  const next = scatter(991);
  for (let index = 0; index < 6; index += 1) {
    const drift = next() * 2 - 1;
    const radius = 9 + p * 28 + next() * 6;
    ctx.fillStyle = `rgba(100, 116, 139, ${0.22 * (1 - Math.min(1, p)) * fade})`;
    ctx.beginPath();
    ctx.arc(x + drift * 36 * p, y - 16 * p - index * 5 * p, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

/* ==========================================================================
   Scene painter (background + trail + burst — the plane is DOM)
   ========================================================================== */

type Scene = {
  now: number;
  phase: Phase;
  crashedAt: number | null;
  /** Recorded plane path in canvas units. */
  trail: Point[];
};

function paintScene(ctx: CanvasRenderingContext2D, scene: Scene): void {
  const { now, phase, crashedAt, trail } = scene;
  const head = trail.length > 0 ? trail[trail.length - 1]! : RUNWAY;

  const throttled = phase === 'flying' || phase === 'settling';
  const sinceCrash = crashedAt === null ? 0 : now - crashedAt;
  const trailFade = phase === 'crashed' ? Math.max(0, 1 - sinceCrash / 1100) : 1;
  const intensity = throttled ? 2.4 : 0.25;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

  drawSky(ctx);
  drawStars(ctx, now, intensity);
  drawClouds(ctx, now, intensity);
  drawSpeedLines(ctx, now, intensity);

  drawTrail(ctx, trail, trailFade);

  if (phase === 'crashed' && crashedAt !== null) {
    drawExplosion(ctx, head.x, head.y, sinceCrash / 620);
  }
}

/** Jet sprite (inline SVG) — sized in CSS px so it is always big and crisp. */
function PlaneSprite() {
  return (
    <svg className="aviator__jet" viewBox="0 0 120 72" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="jetBody" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="45%" stopColor="#dbe3ee" />
          <stop offset="100%" stopColor="#8f9db4" />
        </linearGradient>
        <linearGradient id="jetGlass" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#bae6fd" />
          <stop offset="100%" stopColor="#0369a1" />
        </linearGradient>
        <radialGradient id="jetEngine">
          <stop offset="0%" stopColor="#fff7d6" stopOpacity="0.95" />
          <stop offset="55%" stopColor="#fb923c" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#ef4444" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Engine glow behind the nozzle. */}
      <circle cx="24" cy="36" r="22" fill="url(#jetEngine)" />

      {/* Far wing, tail fin, fuselage, near wing. */}
      <path d="M20 29 L46 9 L54 9 L39 31 Z" fill="#9aa8bd" stroke="#0f172a" strokeOpacity="0.45" />
      <path d="M32 34 L11 14 L3 16 L17 35 Z" fill="#a8b3c4" stroke="#0f172a" strokeOpacity="0.45" />
      <path
        d="M15 31 C41 21 79 23 109 36 C79 49 41 51 15 41 C9 38 9 34 15 31 Z"
        fill="url(#jetBody)"
        stroke="#0f172a"
        strokeOpacity="0.5"
        strokeWidth="1.1"
      />
      <path d="M20 45 L46 65 L54 65 L39 43 Z" fill="#e8eef7" stroke="#0f172a" strokeOpacity="0.45" />
      <path d="M30 39 L96 38" stroke="#d4af37" strokeWidth="2.6" strokeLinecap="round" />
      <ellipse cx="77" cy="32" rx="11" ry="4.6" fill="url(#jetGlass)" />
    </svg>
  );
}

export default function Aviator() {
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);

  const [amount, setAmount] = useState(String(DEFAULT_BET));
  const [config, setConfig] = useState<AviatorConfig | null>(null);
  const table = config ?? FALLBACK_CONFIG;

  const [phase, setPhase] = useState<Phase>('idle');
  const [multiplier, setMultiplier] = useState(1);
  const [roundId, setRoundId] = useState<string | null>(null);
  const [seedHash, setSeedHash] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<AviatorOutcome | null>(null);
  const [showWin, setShowWin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The stake of the round in progress — the live cash-out value is based on it. */
  const [roundStake, setRoundStake] = useState(0);

  // Auto cash-out: the toggle and the target text (a draft, so "2." can be typed).
  const [autoOn, setAutoOn] = useState(() => readAutoCashout().enabled);
  const [autoDraft, setAutoDraft] = useState(() => readAutoCashout().target);

  /** Plane position in canvas units — drives both the DOM jet and the trail. */
  const [plane, setPlane] = useState<Point & { angle: number }>({ ...RUNWAY, angle: 0 });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const startRef = useRef(0);
  const durationRef = useRef(0);
  const tauRef = useRef(FALLBACK_CONFIG.growthTauMs);
  const roundIdRef = useRef<string | null>(null);
  const multiplierRef = useRef(1);
  const phaseRef = useRef<Phase>('idle');
  const crashedAtRef = useRef<number | null>(null);
  const trailRef = useRef<Point[]>([]);
  /** Active auto cash-out target (null = off/invalid); read by the frame loop. */
  const autoTargetRef = useRef<number | null>(null);
  /** Auto cash-out fires at most once per round. */
  const autoFiredRef = useRef(false);
  /** A cash-out request is in flight (manual or auto) — blocks a second one. */
  const cashoutBusyRef = useRef(false);
  /** Always the latest `handleCashout`, so the frame loop never calls a stale copy. */
  const cashoutRef = useRef<(claim?: number) => Promise<void>>(async () => undefined);

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
        if (!cancelled && value.growthTauMs > 0) {
          setConfig(value);
          tauRef.current = value.growthTauMs;
        }
      } catch {
        // The fallback constants match the backend; the game still works.
      }
    }

    void load();
    void loadConfig();

    return () => {
      cancelled = true;
    };
  }, []);

  // Mirror the phase into a ref for the paint loop; stamp the burst time.
  useEffect(() => {
    phaseRef.current = phase;

    if (phase === 'crashed') {
      crashedAtRef.current = crashedAtRef.current ?? performance.now();
    }

    if (phase === 'idle' || phase === 'starting') {
      crashedAtRef.current = null;
    }
  }, [phase]);

  // One animation-frame loop owns the canvas: sky, stars, clouds, speed lines,
  // fire trail and the burst. The jet itself is a DOM element, so the artwork
  // never depends on the React re-renders that update the HUD.
  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) {
      return undefined;
    }

    let frame = 0;

    const render = (now: number) => {
      paintScene(ctx, {
        now,
        phase: phaseRef.current,
        crashedAt: crashedAtRef.current,
        trail: trailRef.current,
      });

      frame = window.requestAnimationFrame(render);
    };

    frame = window.requestAnimationFrame(render);

    return () => window.cancelAnimationFrame(frame);
  }, []);

  /** The plane bursts: freeze the display and forfeit the round on the server. */
  const finishCrash = useCallback(async () => {
    const id = roundIdRef.current;

    stopFlightTone();
    playSound('crash');
    setPhase('crashed');
    setMultiplier(multiplierAt(durationRef.current, tauRef.current));

    if (!id) {
      return;
    }

    try {
      const { data } = await api.post<AviatorOutcome>('/game/aviator/crash', { roundId: id });
      setOutcome(data);
      setMultiplier(data.crashPoint);
      setBalance(data.balanceAfter);
      void refreshBalance();
    } catch {
      // The stake is already debited; the round is closed on the next start.
    }
  }, [refreshBalance]);

  // Flight loop — exponential climb + sine glide until the round bursts.
  useEffect(() => {
    if (phase !== 'flying') {
      return undefined;
    }

    startFlightTone();

    let frame = 0;

    const tick = (now: number) => {
      const elapsed = performance.now() - startRef.current;
      const current = multiplierAt(elapsed, tauRef.current);
      const position = planePosition(elapsed, tauRef.current, table.crashCap, now);

      multiplierRef.current = current;
      setMultiplier(current);
      setPlane(position);
      // The engine hum climbs with the multiplier.
      updateFlightTone(current);

      // Record the flown path so the flame traces exactly what the jet did.
      const trail = trailRef.current;
      trail.push({ x: position.x, y: position.y });
      if (trail.length > 1400) {
        trail.shift();
      }

      if (elapsed >= durationRef.current) {
        void finishCrash();
        return;
      }

      // Auto cash-out: the first frame at/above the target claims exactly the
      // target (not the overshoot). Once per round; a burst above wins the race.
      const target = autoTargetRef.current;
      if (target !== null && !autoFiredRef.current && current >= target) {
        autoFiredRef.current = true;
        void cashoutRef.current(target);
      }

      frame = window.requestAnimationFrame(tick);
    };

    frame = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(frame);
      stopFlightTone();
    };
  }, [phase, finishCrash, table.crashCap]);

  async function placeBet() {
    if (phase === 'starting' || phase === 'flying' || phase === 'settling') {
      return;
    }

    setError(null);

    const stake = Number(amount);
    if (!Number.isFinite(stake) || stake <= 0) {
      setError('Enter a bet amount greater than 0.');
      return;
    }

    autoFiredRef.current = false;
    cashoutBusyRef.current = false;
    setOutcome(null);
    setShowWin(false);
    setRoundStake(round2(stake));
    setMultiplier(1);
    multiplierRef.current = 1;
    setPlane({ ...RUNWAY, angle: 0 });
    trailRef.current = [];
    setPhase('starting');

    // Measure the request so the client's flight starts when the server's did
    // (it bursts slightly early, never late).
    const requestedAt = performance.now();

    try {
      const { data } = await api.post<AviatorStart>('/game/aviator/start', {
        betAmount: stake,
      });

      roundIdRef.current = data.roundId;
      durationRef.current = data.durationMs;
      tauRef.current = data.growthTauMs;
      startRef.current = requestedAt;

      const elapsed = performance.now() - requestedAt;
      multiplierRef.current = multiplierAt(elapsed, data.growthTauMs);
      setPlane(planePosition(elapsed, data.growthTauMs, table.crashCap, performance.now()));

      setRoundId(data.roundId);
      setSeedHash(data.serverSeedHash);
      setMultiplier(multiplierRef.current);
      setBalance(data.balanceAfter);
      setPhase('flying');
    } catch (requestError) {
      setPhase('idle');
      setError(getApiErrorMessage(requestError, 'The bet could not be placed.'));
      void refreshBalance();
    }
  }

  /**
   * Cash out the running round. `claim` (auto cash-out) is the multiplier to be
   * paid at; the manual button omits it and claims the live multiplier. Either
   * way the server pays the lower of the claim and its own multiplier. The busy
   * ref makes a manual click and an auto trigger in the same frame collapse into
   * one request.
   */
  async function handleCashout(claim?: number) {
    const id = roundIdRef.current;
    if (phase !== 'flying' || !id || cashoutBusyRef.current) {
      return;
    }

    cashoutBusyRef.current = true;
    setPhase('settling');
    setError(null);

    try {
      const { data } = await api.post<AviatorOutcome>('/game/aviator/cashout', {
        roundId: id,
        multiplier: round2(claim ?? multiplierRef.current),
      });

      setOutcome(data);
      setMultiplier(data.status === 'cashed_out' ? data.multiplier : data.crashPoint);
      setBalance(data.balanceAfter);
      setPhase(data.status === 'cashed_out' ? 'cashed_out' : 'crashed');
      if (data.status === 'cashed_out') setShowWin(true);

      stopFlightTone();
      playSound(data.status === 'cashed_out' ? 'win' : 'crash');
      void refreshBalance();
    } catch (requestError) {
      // Keep flying: the player can try again (or the round bursts).
      setError(getApiErrorMessage(requestError, 'Cash out failed — try again.'));
      setPhase('flying');
    } finally {
      cashoutBusyRef.current = false;
    }
  }

  // Keep the frame loop pointed at the latest handler (a ref can't be written
  // during render, so it is refreshed after every commit).
  useEffect(() => {
    cashoutRef.current = handleCashout;
  });

  // The armed target: null while the toggle is off or the field is out of range.
  const autoParsed = Number(autoDraft);
  const autoValid =
    autoDraft.trim() !== '' &&
    Number.isFinite(autoParsed) &&
    autoParsed >= table.minCashout &&
    autoParsed <= table.crashCap;
  const autoTarget = autoValid ? round2(autoParsed) : null;

  useEffect(() => {
    autoTargetRef.current = autoOn ? autoTarget : null;
  }, [autoOn, autoTarget]);

  // Persist the toggle and the last valid target (never a half-typed value).
  useEffect(() => {
    if (autoTarget === null) {
      return;
    }

    try {
      window.localStorage.setItem(
        AUTO_STORAGE_KEY,
        JSON.stringify({ enabled: autoOn, target: autoTarget }),
      );
    } catch {
      // Private mode: the preference just won't persist.
    }
  }, [autoOn, autoTarget]);

  /** On blur: snap a number into range at 2 decimals; anything else resets to the default. */
  function commitAutoTarget() {
    if (autoDraft.trim() === '' || !Number.isFinite(autoParsed)) {
      setAutoDraft(DEFAULT_AUTO_TARGET);
      return;
    }

    const snapped = Math.min(Math.max(round2(autoParsed), table.minCashout), table.crashCap);
    setAutoDraft(snapped.toFixed(2));
  }

  const balanceLabel = balance === null ? '···' : money(balance);
  const stake = Number(amount) || 0;
  const previewStake = stake > 0 ? stake : DEFAULT_BET;
  const flying = phase === 'flying';
  const busy = phase === 'starting' || phase === 'settling';
  /** The bet chips and the auto cash-out controls are frozen for the whole round. */
  const roundLocked = busy || flying;
  const canCashOut = flying && multiplier >= table.minCashout;
  /** Live cash-out value (stake × multiplier), floored to the cent. */
  const liveCashout = floorToCent(roundStake * multiplier);

  // Position the DOM jet in % of the canvas box (identical mapping to the trail).
  const planeStyle = {
    left: `${(plane.x / CANVAS_W) * 100}%`,
    top: `${(plane.y / CANVAS_H) * 100}%`,
    transform: `translate(-50%, -50%) rotate(${(plane.angle * 180) / Math.PI}deg)`,
  };

  return (
    <div className="phone-stage">
      <div className="phone-frame">
        <div className="rt rt--aviator">
      <header className="rt__topbar">
        <Link to="/" className="rt__back" aria-label="Back to Lobby">
          <ArrowLeftIcon className="icon icon--sm" />
          <span>Lobby</span>
        </Link>

        <h1 className="rt__title">Aviator</h1>

        <SoundToggle />

        <LivePlayerBadge baseCount={5100} />

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
            className={`aviator${flying ? ' aviator--flying' : ''}${
              phase === 'crashed' ? ' aviator--crashed' : ''
            }`}
          >
            <canvas ref={canvasRef} width={CANVAS_W} height={CANVAS_H} className="aviator__sky" />

            {/* The jet: a DOM element, sized in CSS px, gliding on the sine wave. */}
            <div
              className={`aviator__plane${phase === 'crashed' ? ' aviator__plane--gone' : ''}`}
              style={planeStyle}
            >
              <PlaneSprite />
            </div>

            <div className="aviator__hud">
              <span
                className={`aviator__mult${flying ? ' aviator__mult--flying' : ''}${
                  phase === 'crashed' ? ' aviator__mult--crashed' : ''
                }`}
                role="status"
                aria-live="off"
              >
                {multiplier.toFixed(2)}
                <span className="aviator__x">x</span>
              </span>

              {phase === 'crashed' && (
                <span className="aviator__tag aviator__tag--crash">
                  CRASHED @ {multiplier.toFixed(2)}x
                </span>
              )}
              {phase === 'cashed_out' && outcome && (
                <span className="aviator__tag aviator__tag--win">
                  CASHED OUT @ {outcome.multiplier.toFixed(2)}x
                </span>
              )}
              {(phase === 'idle' || phase === 'starting') && (
                <span className="aviator__tag">Place a bet and jump in</span>
              )}
            </div>
          </div>

          {/* Auto cash-out: locked from the bet until the round settles. */}
          <div className={`aviator-auto${autoOn ? ' aviator-auto--on' : ''}`}>
            <button
              type="button"
              role="switch"
              aria-checked={autoOn}
              aria-label="Auto cash out"
              className="aviator-auto__switch"
              onClick={() => setAutoOn((value) => !value)}
              disabled={roundLocked}
            >
              <span className="aviator-auto__knob" aria-hidden="true" />
            </button>

            <span className="aviator-auto__label">Auto cash out at</span>

            <input
              className={`aviator-auto__input${autoValid ? '' : ' aviator-auto__input--invalid'}`}
              type="number"
              inputMode="decimal"
              value={autoDraft}
              onChange={(event) => setAutoDraft(event.target.value)}
              onBlur={commitAutoTarget}
              min={table.minCashout}
              max={table.crashCap}
              step={0.1}
              disabled={roundLocked}
              aria-label="Auto cash out multiplier"
              aria-invalid={!autoValid}
            />
            <span className="aviator-auto__x" aria-hidden="true">
              x
            </span>
          </div>

          <GameResultOverlay
            isOpen={showWin}
            isWin={outcome?.status === 'cashed_out'}
            amount={outcome?.payout ?? 0}
            multiplier={outcome?.multiplier ?? 0}
            detail={
              outcome?.status === 'cashed_out'
                ? `Cashed out at ${outcome.multiplier.toFixed(2)}x · plane burst at ${outcome.crashPoint.toFixed(2)}x`
                : undefined
            }
            onClose={() => setShowWin(false)}
          />

          <p className="rt__fair">
            {roundId
              ? `Round ${roundId.slice(0, 8)} · seed ${seedHash?.slice(0, 12) ?? 'pending'}…`
              : 'Provably fair · seed hash published before every round'}
          </p>
          {error && <p className="error">{error}</p>}
          {balanceError && <p className="error">{balanceError}</p>}
        </section>
      </main>

      <footer className="rt__dock">
        <GameBottomBar
          betAmount={previewStake}
          onBetChange={(value) => setAmount(String(value))}
          onPlay={() => (flying ? void handleCashout() : void placeBet())}
          playLabel={flying ? (canCashOut ? 'CASH OUT' : 'WAIT') : 'PLACE BET'}
          secondaryText={flying ? `$${liveCashout.toFixed(2)}` : undefined}
          isPlaying={busy}
          disabled={flying && !canCashOut}
          chipsDisabled={busy || flying}
        />
      </footer>
    </div>
      </div>
    </div>
  );
}







