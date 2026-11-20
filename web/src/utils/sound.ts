/**
 * Synthetic casino sounds — Web Audio API, no assets.
 *
 * Design rules:
 *   • the `AudioContext` is created **lazily**, on the first user gesture, so
 *     browsers never block it (autoplay policy);
 *   • everything is generated from oscillators/noise buffers, so there are no
 *     mp3 files to ship or 404 on;
 *   • the mute preference lives in `localStorage` and notifies subscribers, so
 *     the toggle stays in sync across every top bar;
 *   • muted means *silent immediately*: the master gain drops to 0 and any
 *     long-running tone (spin ticks, flight hum) is stopped.
 *
 * There is no background music: `startBackgroundMusic` / `stopBackgroundMusic`
 * are exported no-ops so screens keep a stable seam if a bed is added later.
 */

export type SoundType = 'click' | 'spin' | 'win' | 'lose' | 'crash' | 'punch';

const STORAGE_KEY = 'casino.sound.muted';
/** Master volume (0–1). */
const MASTER_VOLUME = 0.85;

type Listener = (muted: boolean) => void;

let context: AudioContext | null = null;
let master: GainNode | null = null;
let muted = readMuted();
let spinTimer: number | null = null;
let flightOsc: OscillatorNode | null = null;
let flightGain: GainNode | null = null;

const listeners = new Set<Listener>();

/**
 * Per-call loudness multiplier for the synthesized effects (blips and noise).
 * `playSound` sets it for the duration of one call (the sounds are scheduled
 * synchronously) and always resets it to 1, so nothing leaks between games.
 */
let sfxScale = 1;
/** Hard ceiling for a single note's peak, so boosted effects can't clip. */
const MAX_PEAK = 0.8;

function readMuted(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/** True when sound is turned off. */
export function isMuted(): boolean {
  return muted;
}

/** Subscribe to mute changes (returns an unsubscribe function). */
export function subscribeMuted(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Turn sound on/off and persist the choice. */
export function setMuted(next: boolean): void {
  muted = next;

  try {
    window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
  } catch {
    // Private mode: the preference just won't persist.
  }

  if (master && context) {
    master.gain.setTargetAtTime(next ? 0 : MASTER_VOLUME, context.currentTime, 0.02);
  }

  if (next) {
    stopSpin();
    stopFlightTone();
  }

  listeners.forEach((listener) => listener(next));
}

export function toggleMuted(): boolean {
  setMuted(!muted);
  return muted;
}

/**
 * Create (or resume) the audio graph. Only ever called from a user gesture —
 * every entry point below runs from a click/keypress handler.
 */
function ensureContext(): AudioContext | null {
  if (typeof window === 'undefined') {
    return null;
  }

  if (!context) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

    if (!Ctor) {
      return null;
    }

    context = new Ctor();
    master = context.createGain();
    master.gain.value = muted ? 0 : MASTER_VOLUME;
    master.connect(context.destination);
  }

  if (context.state === 'suspended') {
    void context.resume();
  }

  return context;
}

/**
 * Prime the context on the very first interaction anywhere in the app, so the
 * first sound effect is never swallowed by the autoplay policy.
 */
if (typeof document !== 'undefined') {
  const unlock = () => {
    ensureContext();
    document.removeEventListener('pointerdown', unlock);
    document.removeEventListener('keydown', unlock);
  };

  document.addEventListener('pointerdown', unlock, { once: true });
  document.addEventListener('keydown', unlock, { once: true });
}

type BlipOptions = {
  freq: number;
  /** Sweep target (exponential). Omit for a steady tone. */
  to?: number;
  duration: number;
  type?: OscillatorType;
  peak?: number;
  delay?: number;
};

/** One enveloped oscillator note. */
function blip(ctx: AudioContext, options: BlipOptions): void {
  if (!master) {
    return;
  }

  const at = ctx.currentTime + (options.delay ?? 0);
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = options.type ?? 'triangle';
  osc.frequency.setValueAtTime(Math.max(20, options.freq), at);

  if (options.to !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, options.to), at + options.duration);
  }

  const peak = Math.min(MAX_PEAK, Math.max(0.0005, (options.peak ?? 0.22) * sfxScale));
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(peak, at + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + options.duration);

  osc.connect(gain);
  gain.connect(master);
  osc.start(at);
  osc.stop(at + options.duration + 0.03);
}

/** Filtered noise burst — the explosion / crash voice. */
function noiseBurst(ctx: AudioContext, duration = 0.6): void {
  if (!master) {
    return;
  }

  const frames = Math.floor(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);

  for (let index = 0; index < frames; index += 1) {
    const decay = 1 - index / frames;
    data[index] = (Math.random() * 2 - 1) * decay * decay;
  }

  const at = ctx.currentTime;
  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(2600, at);
  filter.frequency.exponentialRampToValueAtTime(160, at + duration);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(Math.min(MAX_PEAK, 0.55 * sfxScale), at);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(master);
  source.start(at);
}

/** Short tick used by the spin loop. */
function tick(ctx: AudioContext, progress: number): void {
  blip(ctx, {
    freq: 940 - progress * 260,
    duration: 0.035,
    type: 'square',
    peak: 0.16 - progress * 0.08,
  });
}

/**
 * A heavy boxing impact: the *body* is a sine that drops from ~150 Hz to ~42 Hz in
 * a quarter of a second (a bass drum with the skin loosened), and the *crack* is a
 * 90 ms white-noise burst through a low-pass that slams shut, so it reads as leather
 * on bone rather than a hiss.
 *
 * `pitch` scales both voices, so the same punch can land heavy (0.78) or light
 * (1.1); `volume` scales the whole hit.
 */
function punchSound(ctx: AudioContext, volume: number, pitch: number): void {
  if (!master) {
    return;
  }

  const at = ctx.currentTime;
  const level = Math.max(0.02, Math.min(1, volume));

  // Body: the thump you feel in your chest.
  const body = ctx.createOscillator();
  body.type = 'sine';
  body.frequency.setValueAtTime(Math.max(40, 150 * pitch), at);
  body.frequency.exponentialRampToValueAtTime(Math.max(25, 42 * pitch), at + 0.22);

  const bodyGain = ctx.createGain();
  bodyGain.gain.setValueAtTime(0.0001, at);
  bodyGain.gain.exponentialRampToValueAtTime(0.6 * level, at + 0.008);
  bodyGain.gain.exponentialRampToValueAtTime(0.0001, at + 0.26);

  body.connect(bodyGain);
  bodyGain.connect(master);
  body.start(at);
  body.stop(at + 0.3);

  // Crack: white noise, cubed so it dies almost instantly.
  const frames = Math.floor(ctx.sampleRate * 0.09);
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);

  for (let index = 0; index < frames; index += 1) {
    const decay = 1 - index / frames;
    data[index] = (Math.random() * 2 - 1) * decay * decay * decay;
  }

  const crack = ctx.createBufferSource();
  crack.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(5200 * pitch, at);
  filter.frequency.exponentialRampToValueAtTime(380 * pitch, at + 0.08);
  filter.Q.value = 0.9;

  const crackGain = ctx.createGain();
  crackGain.gain.setValueAtTime(0.55 * level, at);
  crackGain.gain.exponentialRampToValueAtTime(0.0001, at + 0.09);

  crack.connect(filter);
  filter.connect(crackGain);
  crackGain.connect(master);
  crack.start(at);
}

/**
 * Rapid ticking for a spinning wheel / reel set. Ticks slow down as the
 * animation approaches its end. Any previous spin is cancelled first.
 */
export function startSpin(durationMs = 1200): void {
  stopSpin();

  if (muted) {
    return;
  }

  const ctx = ensureContext();
  if (!ctx) {
    return;
  }

  const total = Math.max(300, durationMs);
  let elapsed = 0;

  const step = () => {
    const progress = Math.min(1, elapsed / total);
    tick(ctx, progress);

    // 45ms between ticks at the start, ~165ms at the end (deceleration).
    const delay = 45 + progress * progress * 120;
    elapsed += delay;

    if (elapsed >= total) {
      spinTimer = null;
      return;
    }

    spinTimer = window.setTimeout(step, delay);
  };

  step();
}

/** Cancels the ticking loop (mute, navigation, new spin). */
export function stopSpin(): void {
  if (spinTimer !== null) {
    window.clearTimeout(spinTimer);
    spinTimer = null;
  }
}

/** Low rising engine hum used while the Aviator plane is climbing. */
export function startFlightTone(): void {
  if (muted || flightOsc) {
    return;
  }

  const ctx = ensureContext();
  if (!ctx || !master) {
    return;
  }

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 1100;

  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.value = 150;

  const gain = ctx.createGain();
  gain.gain.value = 0.05;

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(master);
  osc.start();

  flightOsc = osc;
  flightGain = gain;
}

/** Glides the engine hum up with the multiplier. */
export function updateFlightTone(multiplier: number): void {
  if (!flightOsc || !context) {
    return;
  }

  const target = 150 + Math.min(950, Math.log(Math.max(1, multiplier)) * 430);
  flightOsc.frequency.setTargetAtTime(target, context.currentTime, 0.08);
}

export function stopFlightTone(): void {
  const osc = flightOsc;
  const gain = flightGain;

  flightOsc = null;
  flightGain = null;

  if (!osc || !context) {
    return;
  }

  try {
    gain?.gain.setTargetAtTime(0.0001, context.currentTime, 0.05);
    osc.stop(context.currentTime + 0.25);
  } catch {
    // Already stopped.
  }
}

type SoundOptions = { durationMs?: number; volume?: number; pitch?: number; gain?: number };

/**
 * Play a game sound.
 *
 * `spin` accepts `durationMs` so a long animation (wheel, reels) gets ticking
 * for exactly as long as it spins. `punch` accepts `volume` (0–1) and `pitch`
 * (a frequency multiplier: 0.8 is heavy, 1.1 is light) so the same impact can
 * land differently every time it is used.
 *
 * `gain` (default 1) scales the loudness of `click`, `win`, `lose` and `crash`
 * for that one call, so a single game can run its effects louder without
 * touching the master volume or any other game. Each note's peak is capped, so
 * large values get no louder than the cap rather than distorting. It does not
 * apply to `spin` ticks (scheduled later) or `punch` (which has `volume`).
 */
export function playSound(type: SoundType, options: SoundOptions = {}): void {
  sfxScale = Math.max(0, options.gain ?? 1);

  try {
    playSoundNow(type, options);
  } finally {
    sfxScale = 1;
  }
}

function playSoundNow(type: SoundType, options: SoundOptions): void {
  if (muted) {
    return;
  }

  const ctx = ensureContext();
  if (!ctx) {
    return;
  }

  switch (type) {
    case 'click': {
      // Two very short high blips — a crisp UI tick.
      blip(ctx, { freq: 1250, duration: 0.05, type: 'triangle', peak: 0.35 });
      blip(ctx, { freq: 1850, duration: 0.03, type: 'triangle', peak: 0.18, delay: 0.03 });
      break;
    }

    case 'punch': {
      punchSound(ctx, options.volume ?? 1, options.pitch ?? 1);
      break;
    }

    case 'spin': {
      startSpin(options.durationMs ?? 1200);
      break;
    }

    case 'win': {
      // C5 – E5 – G5 – C6, happy ascending arpeggio.
      [523.25, 659.25, 783.99, 1046.5].forEach((freq, index) => {
        blip(ctx, {
          freq,
          duration: 0.16,
          type: 'triangle',
          peak: 0.45,
          delay: index * 0.085,
        });
      });
      blip(ctx, { freq: 2093, duration: 0.22, type: 'sine', peak: 0.18, delay: 0.34 });
      break;
    }

    case 'lose': {
      // Two descending saw tones, low and dull.
      blip(ctx, { freq: 330, to: 220, duration: 0.24, type: 'sawtooth', peak: 0.3 });
      blip(ctx, { freq: 220, to: 130, duration: 0.36, type: 'sawtooth', peak: 0.25, delay: 0.2 });
      break;
    }

    case 'crash': {
      noiseBurst(ctx, 0.6);
      // Sub-bass thump under the noise.
      blip(ctx, { freq: 120, to: 45, duration: 0.35, type: 'sine', peak: 0.45 });
      break;
    }

    default:
      break;
  }
}

/**
 * Background music is disabled.
 *
 * The audio bed was removed because it did not fit the game. These stay
 * exported as no-ops so screens keep a stable seam if music returns — nothing
 * is loaded, played or synthesised.
 */
export function startBackgroundMusic(): void {
  // Intentionally empty: no background music.
}

export function stopBackgroundMusic(): void {
  // Intentionally empty: no background music.
}
