import { isMuted, subscribeMuted } from './sound';

/**
 * Background-music engine — a single looping `<audio>` element owned outside
 * React so the bed keeps its place while screens switch. It obeys the same
 * persisted mute flag as the SFX (via `subscribeMuted`) and retries a track the
 * autoplay policy blocked on the first user gesture.
 */

let element: HTMLAudioElement | null = null;
let currentSrc: string | null = null;
let volume = 0.5;
let muted = isMuted();

function applyVolume(): void {
  if (element) element.volume = muted ? 0 : volume;
}

/** Start (or switch) the looping background track. */
export function playBgTrack(src: string, options: { loop?: boolean; volume?: number } = {}): void {
  volume = options.volume ?? 0.5;

  if (!element) {
    element = new Audio();
    element.preload = 'auto';
  }

  element.loop = options.loop ?? true;
  element.src = src;
  currentSrc = src;
  applyVolume();

  // Start now; if the browser blocks it, the gesture listener below retries.
  void element.play().catch(() => {});
}

/** Stop and clear the background track. */
export function stopBgTrack(): void {
  currentSrc = null;

  if (element) {
    element.pause();
    element.removeAttribute('src');
    element.load();
  }
}

// Muted means silent immediately: follow the shared flag, and the configured
// volume comes straight back when the player unmutes.
subscribeMuted((nextMuted) => {
  muted = nextMuted;
  applyVolume();
});

// Autoplay unlock: the first pointerdown/keydown retries a blocked track.
if (typeof document !== 'undefined') {
  const unlock = () => {
    if (currentSrc && element?.paused) {
      void element.play().catch(() => {});
    }
  };
  const options: AddEventListenerOptions = { once: true, passive: true };
  document.addEventListener('pointerdown', unlock, options);
  document.addEventListener('keydown', unlock, options);
}