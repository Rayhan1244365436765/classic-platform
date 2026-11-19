import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { api, getApiErrorMessage } from '../api/client';
import type {
  AdminGameConfigResponse,
  AdminGamesResponse,
  GameConfigSummary,
  RouletteGameConfig,
  SlotsGameConfig,
} from '../api/types';

const pct = (value: number): string => `${(value * 100).toFixed(2)}%`;

function isSlots(config: unknown): config is SlotsGameConfig {
  return typeof config === 'object' && config !== null && typeof (config as { lineMultiplier?: unknown }).lineMultiplier === 'number';
}

function isRoulette(config: unknown): config is RouletteGameConfig {
  return typeof config === 'object' && config !== null && Array.isArray((config as { segments?: unknown }).segments);
}

export default function GameConfig() {
  const [games, setGames] = useState<GameConfigSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [slotsMult, setSlotsMult] = useState('');
  const [rouletteSegments, setRouletteSegments] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function loadGames() {
      try {
        const { data } = await api.get<AdminGamesResponse>('/admin/games');
        if (cancelled) return;

        const list = data.games ?? [];
        setGames(list);

        const slots = list.find((game) => game.id === 'slots');
        const roulette = list.find((game) => game.id === 'roulette');
        if (slots && isSlots(slots.config)) {
          setSlotsMult(String(slots.config.lineMultiplier));
        }
        if (roulette && isRoulette(roulette.config)) {
          setRouletteSegments(roulette.config.segments.join(', '));
        }

        setError(null);
      } catch (requestError) {
        if (!cancelled) {
          setError(getApiErrorMessage(requestError, 'Could not load game configs.'));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadGames();

    return () => {
      cancelled = true;
    };
  }, []);

  const slotsPreview = (() => {
    const value = Number(slotsMult);
    return Number.isFinite(value) && value > 0 ? value / 12 : null;
  })();

  const roulettePreview = (() => {
    const numbers = rouletteSegments.split(',').map((part) => Number(part.trim()));
    if (numbers.length !== 20 || numbers.some((n) => !Number.isFinite(n) || n < 0)) return null;
    return numbers.reduce((sum, n) => sum + n, 0) / 20;
  })();

  async function saveSlots() {
    const value = Number(slotsMult);
    if (!Number.isFinite(value) || value <= 0) {
      setError('Slots: enter a positive line multiplier.');
      return;
    }
    setBusy('slots');
    setError(null);
    setNotice(null);
    try {
      const { data } = await api.put<AdminGameConfigResponse>('/admin/games/slots/config', {
        config: { lineMultiplier: value },
      });
      setGames((prev) => prev.map((g) => (g.id === 'slots' ? data.game : g)));
      setNotice(`Slots saved — RTP ${pct(data.game.rtp)}`);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Could not save slots config.'));
    } finally {
      setBusy(null);
    }
  }

  async function saveRoulette() {
    const numbers = rouletteSegments.split(',').map((part) => Number(part.trim()));
    if (numbers.length !== 20 || numbers.some((n) => !Number.isFinite(n) || n < 0)) {
      setError('Roulette: enter exactly 20 non-negative numbers.');
      return;
    }
    setBusy('roulette');
    setError(null);
    setNotice(null);
    try {
      const { data } = await api.put<AdminGameConfigResponse>('/admin/games/roulette/config', {
        config: { segments: numbers },
      });
      setGames((prev) => prev.map((g) => (g.id === 'roulette' ? data.game : g)));
      setNotice(`Roulette saved — RTP ${pct(data.game.rtp)}`);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Could not save roulette config.'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>Game Config</h1>
          <p className="muted">Admin-tunable RTP / house edge</p>
        </div>
        <div className="row">
          <Link to="/" className="button button--ghost">Back to dashboard</Link>
        </div>
      </header>

      <main className="container">
        {error && <p className="error">{error}</p>}
        {notice && <p role="status" style={{ color: '#4ade80' }}>{notice}</p>}

        <section className="panel">
          <div className="panel__head">
            <h2>Configured games</h2>
            <span className="muted">{loading ? 'Loading…' : `${games.length} games`}</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Game</th>
                  <th className="num">RTP</th>
                  <th className="num">House Edge</th>
                </tr>
              </thead>
              <tbody>
                {games.map((game) => (
                  <tr key={game.id}>
                    <td className="mono">{game.id}</td>
                    <td className="num">{pct(game.rtp)}</td>
                    <td className="num">{pct(game.houseEdge)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          <div className="panel__head">
            <h2>Slots</h2>
            <span className="muted">RTP = line multiplier / 12</span>
          </div>
          <label className="field">
            <span>Line multiplier</span>
            <input type="number" min="0" step="0.1" value={slotsMult} onChange={(event) => setSlotsMult(event.target.value)} />
          </label>
          <p className="muted">Preview RTP: {slotsPreview === null ? '—' : pct(slotsPreview)}</p>
          <button type="button" className="button button--primary" onClick={() => void saveSlots()} disabled={busy === 'slots'}>
            {busy === 'slots' ? 'Saving…' : 'Save Slots'}
          </button>
        </section>

        <section className="panel">
          <div className="panel__head">
            <h2>Roulette (Spin to Win)</h2>
            <span className="muted">RTP = Σ(segments) / 20</span>
          </div>
          <label className="field">
            <span>20 segment multipliers (comma-separated)</span>
            <input value={rouletteSegments} onChange={(event) => setRouletteSegments(event.target.value)} placeholder="10, 3, 2, 1, 0.5, …" />
          </label>
          <p className="muted">Preview RTP: {roulettePreview === null ? '—' : pct(roulettePreview)}</p>
          <button type="button" className="button button--primary" onClick={() => void saveRoulette()} disabled={busy === 'roulette'}>
            {busy === 'roulette' ? 'Saving…' : 'Save Roulette'}
          </button>
        </section>
      </main>
    </div>
  );
}