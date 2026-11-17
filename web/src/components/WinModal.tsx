import { useEffect, useMemo, useRef, type CSSProperties } from 'react';

/**
 * Celebratory win dialog.
 *
 * Reusable and game-agnostic: it takes the amount won and a close callback,
 * renders a blurred overlay with a gold-bordered card that springs in, and rains
 * confetti behind it. Everything is CSS — the reward animation must not depend on
 * a motion library.
 *
 * It is a **pure celebration**: no buttons. It shows the message and the amount,
 * then dismisses itself after `AUTO_CLOSE_MS` (the thin bar along its bottom edge
 * is that countdown). Escape and the backdrop also dismiss it early. The timeout
 * is cleared whenever the dialog closes or unmounts, so nothing fires twice.
 *
 * Accessibility: `role="dialog"` + `aria-modal`, Escape closes, the backdrop
 * closes, focus moves onto the card on open, and the page behind is scroll-locked
 * while it is up.
 */

type WinModalProps = {
  isOpen: boolean;
  /** Amount won, in the player's currency. */
  winAmount: number;
  /** Called by the auto-dismiss timer (and by Escape / backdrop). Required. */
  onClose: () => void;
};

/** How long the celebration stays up before it closes itself (ms). */
export const AUTO_CLOSE_MS = 1500;

/** `52` → `$52.00`, `1534.5` → `$1,534.50`. */
function formatWin(value: number): string {
  const rounded = Math.round(value * 100) / 100;

  return `$${rounded.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
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

/** Fresh confetti every time the dialog opens, so it never falls in a pattern. */
function buildConfetti(): ConfettiPiece[] {
  return Array.from({ length: CONFETTI_PIECES }, () => ({
    left: Math.random() * 100,
    // Timed for the AUTO_CLOSE_MS window: every piece enters almost immediately
    // and finishes its fall inside the ~1.5s the dialog is on screen.
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

export function WinModal({ isOpen, winAmount, onClose }: WinModalProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  // Kept in a ref so swapping the callback identity never re-runs the open effect
  // (which would steal focus and re-toggle the scroll lock mid-dialog).
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  // Escape closes, the page behind must not scroll, and the dialog dismisses
  // itself after AUTO_CLOSE_MS. The cleanup clears the timer on close/unmount, so
  // a manual close can never be followed by a second onClose.
  useEffect(() => {
    if (!isOpen) return undefined;

    function handleKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') closeRef.current();
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKey);
    cardRef.current?.focus({ preventScroll: true });

    const autoClose = window.setTimeout(() => closeRef.current(), AUTO_CLOSE_MS);

    return () => {
      window.clearTimeout(autoClose);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKey);
    };
  }, [isOpen]);

  // Built once per opening so re-renders don't reshuffle the confetti mid-fall.
  const confetti = useMemo(() => (isOpen ? buildConfetti() : []), [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="win-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="win-modal-title"
      aria-describedby="win-modal-amount"
    >
      <button
        type="button"
        className="win-modal__backdrop"
        aria-label="Close the win dialog"
        onClick={onClose}
      />

      <div className="win-modal__confetti" aria-hidden="true">
        {confetti.map((piece, index) => (
          <span key={index} style={confettiStyle(piece)} />
        ))}
      </div>

      <div className="win-modal__card" ref={cardRef} tabIndex={-1}>
        <div className="win-modal__glow" aria-hidden="true" />

        <div className="win-modal__stars" aria-hidden="true">
          <span>★</span>
          <span>★</span>
          <span>★</span>
        </div>

        <h2 className="win-modal__title" id="win-modal-title">
          CONGRATULATIONS!
        </h2>

        <p className="win-modal__caption">You won</p>

        <p className="win-modal__amount" id="win-modal-amount">
          {formatWin(winAmount)}
        </p>

        {/* Countdown to the auto-dismiss; the duration comes from AUTO_CLOSE_MS. */}
        <div className="win-modal__timer" aria-hidden="true">
          <span style={{ animationDuration: `${AUTO_CLOSE_MS}ms` }} />
        </div>
      </div>
    </div>
  );
}

export default WinModal;
