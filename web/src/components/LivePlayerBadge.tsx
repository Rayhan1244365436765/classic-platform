import { useCallback, useEffect, useState } from 'react';

import {
  MAX_DELAY_MS,
  MIN_DELAY_MS,
  liveCountBand,
  nextLiveCount,
  pickAvatar,
} from '../utils/livePlayers';

/**
 * Social-proof "players online" badge for the top bar:
 *
 *     [🧑‍💼][👩‍🦰][🧔][👨‍🦱] ● 5,098 Players Online
 *
 * Three things move, independently, so the badge never looks like a static label:
 *
 *  * the **avatars** — a stack of overlapping faces, one of which is replaced by a
 *    new person every 2–3 s. The outgoing face fades/scales out on top of the
 *    incoming one (a real cross-fade: both are in the DOM for ~320 ms), which is
 *    what makes it read as people arriving and leaving rather than a slideshow.
 *  * the **count** — a mean-reverting walk of ±1–5 players every 3–5 s, clamped
 *    to ±6 % of `baseCount` (see `utils/livePlayers.ts`).
 *  * the **dot** — a CSS sonar ring that never stops.
 *
 * Both timers re-schedule themselves with a fresh random delay (3–5 s / 2–3 s)
 * instead of using a fixed `setInterval`, because a constant period settles into
 * a visible metronome after a few seconds — the opposite of "live". They are
 * cleared on unmount, and every state update happens inside a timer callback, so
 * nothing renders synchronously from an effect.
 *
 * The figures are cosmetic — no API calls — but each page passes its own base so
 * two tabs never show the same number.
 */

/**
 * The rotating cast. Kept to single-glyph emoji (with ZWJ/hair modifiers) so every
 * one renders as one face on Windows, macOS and Android.
 */
const AVATAR_POOL = ['🧑‍💼', '👩‍🦰', '🧔', '👨‍🦱', '👩🏽‍💻', '🧑‍🎨', '👩‍🦳'];

/** Faces visible at once. */
const AVATAR_SLOTS = 4;
/** One face changes every 2–3 s. */
const AVATAR_MIN_DELAY_MS = 2000;
const AVATAR_MAX_DELAY_MS = 3000;

export type LivePlayerTone = 'live' | 'total';

type LivePlayerBadgeProps = {
  /** Headline figure for this table, e.g. 3600 for roulette. */
  baseCount: number;
  /** `live` = red dot (a game), `total` = green dot (the whole lobby). */
  tone?: LivePlayerTone;
  /** Caption after the number. */
  label?: string;
  className?: string;
};

/**
 * One avatar slot: the face on screen, the face currently fading out over it, and
 * a revision number that remounts the faces so their CSS animations restart.
 */
type AvatarSlot = {
  current: string;
  previous: string | null;
  rev: number;
};

/** 5098 → "5,098". */
function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

/** Four distinct faces, so the stack never starts with a duplicate. */
function initialSlots(): AvatarSlot[] {
  const pool = [...AVATAR_POOL];
  const slots: AvatarSlot[] = [];

  for (let slot = 0; slot < AVATAR_SLOTS && pool.length > 0; slot += 1) {
    const index = Math.floor(Math.random() * pool.length);
    const [face] = pool.splice(index, 1);
    slots.push({ current: face, previous: null, rev: 0 });
  }

  return slots;
}

export function LivePlayerBadge({
  baseCount,
  tone = 'live',
  label = 'Players Online',
  className = '',
}: LivePlayerBadgeProps) {
  const [offset, setOffset] = useState(0);
  const [slots, setSlots] = useState<AvatarSlot[]>(initialSlots);

  // --- the count: ±1-5 every 3-5 s, inside ±6% of the base --------------------
  useEffect(() => {
    const { floor, ceiling } = liveCountBand(baseCount);

    let timer: number | undefined;
    let cancelled = false;

    const scheduleTick = (): void => {
      timer = window.setTimeout(
        () => {
          if (cancelled) return;

          setOffset((current) => nextLiveCount(current, floor, ceiling));
          scheduleTick();
        },
        MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS),
      );
    };

    scheduleTick();

    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [baseCount]);

  // --- the avatars: one random face walks out and a new one walks in ----------
  useEffect(() => {
    let timer: number | undefined;
    let cancelled = false;

    const scheduleSwap = (): void => {
      timer = window.setTimeout(
        () => {
          if (cancelled) return;

          setSlots((current) => {
            const index = Math.floor(Math.random() * current.length);
            const face = pickAvatar(
              AVATAR_POOL,
              current.map((slot) => slot.current),
            );

            return current.map((slot, position) =>
              position === index
                ? { current: face, previous: slot.current, rev: slot.rev + 1 }
                : slot,
            );
          });

          scheduleSwap();
        },
        AVATAR_MIN_DELAY_MS + Math.random() * (AVATAR_MAX_DELAY_MS - AVATAR_MIN_DELAY_MS),
      );
    };

    scheduleSwap();

    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  /** The outgoing face is only kept while it animates; drop it when it lands. */
  const clearPrevious = useCallback((position: number): void => {
    setSlots((current) =>
      current.map((slot, index) =>
        index === position && slot.previous ? { ...slot, previous: null } : slot,
      ),
    );
  }, []);

  const count = baseCount + offset;

  return (
    <span
      className={`live-players live-players--${tone}${className ? ` ${className}` : ''}`}
      title={`${formatCount(count)} ${label.toLowerCase()} right now`}
    >
      <span className="live-players__avatars" aria-hidden="true">
        {slots.map((slot, position) => (
          <span className="live-players__avatar" key={`${position}-${slot.rev}`}>
            {slot.previous !== null && (
              <span
                className="live-players__face live-players__face--out"
                onAnimationEnd={() => clearPrevious(position)}
              >
                {slot.previous}
              </span>
            )}
            <span className="live-players__face live-players__face--in">{slot.current}</span>
          </span>
        ))}
      </span>

      <span className="live-players__dot" aria-hidden="true" />
      <span className="live-players__count">{formatCount(count)}</span>
      <span className="live-players__label">{label}</span>
    </span>
  );
}

export default LivePlayerBadge;
