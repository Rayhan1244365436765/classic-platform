import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';

/**
 * Non-blocking game-result toast — the standard win/loss notification for every
 * game. It is the Showdown ("Cascade") celebration, generalized: the exact gold
 * card, confetti, star twinkle, spring/bounce and countdown-bar animations from
 * `WinModal` are reused, now with a loss variant and a multiplier badge.
 *
 * Unlike `WinModal`, it is **click-transparent**: the wrapper is
 * `pointer-events: none`, so the player can hit SPIN / the bottom bar / the
 * board while the message is on screen. It renders through a portal to `<body>`
 * so no game container can clip or transform it, and it dismisses itself after
 * `durationMs` (the thin bar along the bottom edge is that countdown). The timer
 * is cleared on close/unmount so it never fires twice.
 *
 * Accessibility: `role="status"` (an implicit polite live region) announces the
 * outcome without stealing focus or scroll — no `aria-modal`, because nothing is
 * blocked.
 */

type GameResultOverlayProps = {
  isOpen: boolean;
  /** True → "CONGRATULATIONS!" gold card; false → "BETTER LUCK NEXT TIME". */
  isWin: boolean;
  /** Absolute amount: the payout on a win, the stake on a loss. */
  amount: number;
  /** The multiplier that hit (0 on a loss). Drives the `×N` badge. */
  multiplier: number;
  /** Optional secondary line under the amount (game-specific detail). */
  detail?: string;
  /** Called after the auto-dismiss timer fires. */
  onClose: () => void;
  /** How long the toast stays up before it fades out and closes. */
  durationMs?: number;
};

/** Keep the fast loop snappy but readable — inside the requested 2–3 s window. */
export const GAME_RESULT_DURATION_MS = 2400;

/** `52` → `$52.00`, `1534.5` → `$1,534.50` (same as the Showdown dialog). */
function formatMoney(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return `$${rounded.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** `2` → `2×`, `0.5` → `0.5×`, `32.4` → `32.4×`. */
function formatMultiplier(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return `${rounded}×`;
}

const CONFETTI_COLORS = ['#f4c430', '#f6d97a', '#ffffff', '#34d399', '#60a5fa', '#f472b6'];
const CONFETTI_PIECES = 32;

type ConfettiPiece = {
  left: number;
  delay: number;
  duration: number;
  size: number;
  spin: number;
  drift: number;
  color: string;
};

/** Fresh confetti every time the toast opens, so it never falls in a pattern. */
function buildConfetti(): ConfettiPiece[] {
  return Array.from({ length: CONFETTI_PIECES }, () => ({
    left: Math.random() * 100,
    delay: Math.random() * 0.5,
    duration: 1 + Math.random() * 0.7,
    size: 6 + Math.random() * 6,
    spin: 320 + Math.random() * 460,
    drift: (Math.random() - 0.5) * 140,
    color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)]!,
  }));
}

function confettiStyle(piece: ConfettiPiece): CSSProperties {
  return {
    left: `${piece.left}%`,
    '--confetti-size': `${piece.size}px`,
    '--confetti-color': piece.color,
    '--confetti-duration': `${piece.duration}s`,
    '--confetti-delay': `${piece.delay}s`,
    '--confetti-spin': `${piece.spin}deg`,
    '--confetti-drift': `${piece.drift}px`,
  } as CSSProperties;
}

export function GameResultOverlay({
  isOpen,
  isWin,
  amount,
  multiplier,
  detail,
  onClose,
  durationMs = GAME_RESULT_DURATION_MS,
}: GameResultOverlayProps) {
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return undefined;

    const close = window.setTimeout(() => closeRef.current(), durationMs);
    return () => window.clearTimeout(close);
  }, [isOpen, durationMs]);

  // Built once per opening so re-renders don't reshuffle the confetti mid-fall.
  const confetti = useMemo(() => (isOpen && isWin ? buildConfetti() : []), [isOpen, isWin]);

  if (!isOpen) return null;

  const signed = `${isWin ? '+' : '-'}${formatMoney(amount)}`;

  return createPortal(
    <div
      className={`game-result${isWin ? ' game-result--win' : ' game-result--lose'}`}
      role="status"
      style={{ animationDuration: `${durationMs}ms` }}
    >
      <div className="game-result__backdrop" aria-hidden="true" />

      {isWin && (
        <div className="game-result__confetti" aria-hidden="true">
          {confetti.map((piece, index) => (
            <span key={index} style={confettiStyle(piece)} />
          ))}
        </div>
      )}

      <div className="game-result__card">
        <div className="game-result__glow" aria-hidden="true" />

        {isWin && (
          <div className="game-result__stars" aria-hidden="true">
            <span>★</span>
            <span>★</span>
            <span>★</span>
          </div>
        )}

        <h2 className="game-result__title">
          {isWin ? 'CONGRATULATIONS!' : 'BETTER LUCK NEXT TIME'}
        </h2>

        <p className="game-result__caption">{isWin ? 'You won' : 'You lost'}</p>

        {multiplier > 0 && <span className="game-result__mult">{formatMultiplier(multiplier)}</span>}

        <p className="game-result__amount">{signed}</p>

        {detail && <p className="game-result__detail">{detail}</p>}

        {/* Countdown to the auto-dismiss; the duration comes from the prop. */}
        <div className="game-result__timer" aria-hidden="true">
          <span style={{ animationDuration: `${durationMs}ms` }} />
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default GameResultOverlay;