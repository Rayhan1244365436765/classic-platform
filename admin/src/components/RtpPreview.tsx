import type { RtpLine } from '../api/types';
import { pct } from '../pages/gameConfigForm';

type Props = {
  title: string;
  lines: RtpLine[];
  rtp: number | null;
  note: string | null;
  /** Shown instead of figures while the form is invalid or loading. */
  message?: string | null;
};

/** RTP / house-edge figures, flagged when they leave a sane range. */
export function RtpPreview({ title, lines, rtp, note, message }: Props) {
  const level = rtp === null ? '' : rtp > 1 ? ' rtp--bad' : rtp > 0.995 ? ' rtp--warn' : rtp < 0.5 ? ' rtp--warn' : '';

  return (
    <div className="rtp">
      <p className="rtp__title">{title}</p>

      {message ? (
        <p className="muted">{message}</p>
      ) : lines.length === 0 ? (
        <p className="muted">RTP cannot be calculated for this game.</p>
      ) : (
        <>
          <p className={`rtp__headline${level}`}>
            RTP {rtp === null ? '—' : pct(rtp)}
            <span className="muted"> · house edge {rtp === null ? '—' : pct(1 - rtp)}</span>
          </p>
          {lines.length > 1 && (
            <ul className="rtp__lines">
              {lines.map((line) => (
                <li key={line.label}>
                  <span>{line.label}</span>
                  <span className={line.rtp > 1 ? 'rtp--bad' : ''}>{pct(line.rtp)}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {rtp !== null && rtp > 1 && (
        <p className="error">Above 100% — players would win money over time. Saving is blocked.</p>
      )}
      {note && <p className="hint">{note}</p>}
    </div>
  );
}
