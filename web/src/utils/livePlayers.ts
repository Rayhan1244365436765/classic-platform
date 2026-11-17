/**
 * Random-walk maths behind the "players online" badges.
 *
 * Kept out of the component file so the walk can be exercised on its own (and so
 * the component module only exports components, which Fast Refresh requires).
 */

/** Smallest/largest change per tick. */
export const MIN_STEP = 1;
export const MAX_STEP = 5;
/** Delay between ticks: 3–5 s, chosen freshly every time. */
export const MIN_DELAY_MS = 3000;
export const MAX_DELAY_MS = 5000;
/** How far the walk may wander from the base figure. */
export const DRIFT = 0.06;

/** ±(MIN_STEP…MAX_STEP). */
function randomStep(): number {
  const magnitude = MIN_STEP + Math.floor(Math.random() * (MAX_STEP - MIN_STEP + 1));

  return Math.random() < 0.5 ? -magnitude : magnitude;
}

/**
 * One tick of the walk: move 1–5 in a random direction, clamped to
 * `[floor, ceiling]`. A step that would leave the band turns around instead, so
 * the figure never freezes against a bound.
 */
export function nextLiveCount(current: number, floor: number, ceiling: number): number {
  if (ceiling <= floor) {
    return current;
  }

  const stepped = Math.min(ceiling, Math.max(floor, current + randomStep()));
  if (stepped !== current) {
    return stepped;
  }

  return current + (current <= floor ? 1 : -1);
}

/** The band the walk is allowed to occupy for a base figure (±`DRIFT`). */
export function liveCountBand(baseCount: number): { floor: number; ceiling: number } {
  const reach = Math.round(baseCount * DRIFT);

  return { floor: -reach, ceiling: reach };
}

/**
 * A face from `pool` that is not currently on screen, so every swap is visible.
 * Falls back to any face when the pool is no bigger than the visible set.
 */
export function pickAvatar(pool: readonly string[], visible: readonly string[]): string {
  if (pool.length === 0) {
    return '';
  }

  const hidden = pool.filter((face) => !visible.includes(face));
  const candidates = hidden.length > 0 ? hidden : pool;

  return candidates[Math.floor(Math.random() * candidates.length)];
}
