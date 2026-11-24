import { useEffect, useMemo, useState } from 'react';

import { api, getApiErrorMessage } from '../api/client';
import type {
  AdminGameConfigResponse,
  AdminGamePreviewResponse,
  GameConfigPreview,
  GameConfigSummary,
} from '../api/types';
import { configToForm, formToConfig, pct, type FormValues } from '../pages/gameConfigForm';
import { GameConfigFields } from './GameConfigFields';
import { RtpPreview } from './RtpPreview';

type Props = {
  game: GameConfigSummary;
  onSaved: (game: GameConfigSummary, message: string) => void;
};

type PreviewState = { key: string; data: GameConfigPreview } | { key: string; error: string };

const PREVIEW_DELAY_MS = 350;

/**
 * The form for one game. Mount it with a `key` that changes whenever the saved
 * game changes, so the inputs reset to the saved values.
 */
export function GameEditor({ game, onSaved }: Props) {
  const [values, setValues] = useState<FormValues>(() => configToForm(game.fields, game.config));
  const [busy, setBusy] = useState<'save' | 'reset' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);

  const parsed = useMemo(() => formToConfig(game.fields, values), [game.fields, values]);
  const key = parsed.ok ? JSON.stringify(parsed.config) : '';

  // "Calculate RTP": ask the server (the real game maths) shortly after typing stops.
  useEffect(() => {
    if (!parsed.ok) return;

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const { data } = await api.post<AdminGamePreviewResponse>(
          `/admin/game-configs/${game.id}/preview`,
          { config: parsed.config },
        );
        if (!cancelled) setPreview({ key, data: data.preview });
      } catch (requestError) {
        if (!cancelled) setPreview({ key, error: getApiErrorMessage(requestError, 'Could not calculate RTP.') });
      }
    }, PREVIEW_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [game.id, parsed, key]);

  const current = preview && preview.key === key ? preview : null;
  const data = current && 'data' in current ? current.data : null;
  const previewError = current && 'error' in current ? current.error : null;
  const overHundred = data !== null && data.lines.some((line) => line.rtp > 1);

  let message: string | null = null;
  if (!parsed.ok) message = parsed.error;
  else if (previewError) message = previewError;
  else if (!data) message = 'Calculating…';

  async function save() {
    if (!parsed.ok) return;
    setBusy('save');
    setError(null);
    try {
      const { data: saved } = await api.post<AdminGameConfigResponse>(
        `/admin/game-configs/${game.id}`,
        { config: parsed.config },
      );
      const rtp = saved.game.rtp;
      onSaved(saved.game, `${saved.game.label} saved${rtp === null ? '' : ` — RTP ${pct(rtp)}`}`);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Could not save.'));
    } finally {
      setBusy(null);
    }
  }

  async function reset() {
    if (!window.confirm(`Restore ${game.label} to its built-in table?`)) return;
    setBusy('reset');
    setError(null);
    try {
      const { data: restored } = await api.post<AdminGameConfigResponse>(
        `/admin/game-configs/${game.id}/reset`,
      );
      onSaved(restored.game, `${restored.game.label} restored to defaults`);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Could not reset.'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <p className="muted">{game.description}</p>

      <GameConfigFields
        fields={game.fields}
        values={values}
        disabled={busy !== null}
        onChange={(field, value) => setValues((previous) => ({ ...previous, [field]: value }))}
      />

      <RtpPreview
        title="Preview (not saved yet)"
        lines={data?.lines ?? []}
        rtp={data?.rtp ?? null}
        note={data?.note ?? null}
        message={message}
      />

      {error && <p className="error">{error}</p>}

      <div className="row">
        <button
          type="button"
          className="button button--primary"
          onClick={() => void save()}
          disabled={busy !== null || !parsed.ok || data === null || overHundred}
        >
          {busy === 'save' ? 'Saving…' : `Save ${game.label}`}
        </button>
        <button
          type="button"
          className="button button--ghost"
          onClick={() => void reset()}
          disabled={busy !== null || game.isDefault}
        >
          {busy === 'reset' ? 'Restoring…' : 'Restore defaults'}
        </button>
      </div>
    </>
  );
}
