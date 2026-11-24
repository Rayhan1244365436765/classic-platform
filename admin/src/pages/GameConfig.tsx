import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { api, getApiErrorMessage } from '../api/client';
import type { AdminGamesResponse, GameConfigSummary } from '../api/types';
import { GameEditor } from '../components/GameEditor';
import { pct } from './gameConfigForm';

export default function GameConfig() {
  const [games, setGames] = useState<GameConfigSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadGames() {
      try {
        const { data } = await api.get<AdminGamesResponse>('/admin/game-configs');
        if (cancelled) return;

        const list = data.games ?? [];
        setGames(list);
        setSelectedId((current) => current || list[0]?.id || '');
        setError(null);
      } catch (requestError) {
        if (!cancelled) setError(getApiErrorMessage(requestError, 'Could not load game configs.'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadGames();

    return () => {
      cancelled = true;
    };
  }, []);

  const selected = games.find((game) => game.id === selectedId) ?? null;

  function handleSaved(game: GameConfigSummary, message: string) {
    setGames((previous) => previous.map((entry) => (entry.id === game.id ? game : entry)));
    setNotice(message);
  }

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>Game Config</h1>
          <p className="muted">RTP / house edge for every game — changes apply to new rounds immediately</p>
        </div>
        <div className="row">
          <Link to="/" className="button button--ghost">
            Back to dashboard
          </Link>
        </div>
      </header>

      <main className="container">
        {error && <p className="error">{error}</p>}
        {notice && (
          <p role="status" className="notice">
            {notice}
          </p>
        )}

        <section className="panel">
          <div className="panel__head">
            <h2>All games</h2>
            <span className="muted">{loading ? 'Loading…' : `${games.length} games`}</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Game</th>
                  <th className="num">RTP</th>
                  <th className="num">House edge</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {games.map((game) => (
                  <tr
                    key={game.id}
                    className={`row-link${game.id === selectedId ? ' row-link--active' : ''}`}
                    onClick={() => {
                      setSelectedId(game.id);
                      setNotice(null);
                    }}
                  >
                    <td>{game.label}</td>
                    <td className="num">{game.rtp === null ? '—' : pct(game.rtp)}</td>
                    <td className="num">{game.houseEdge === null ? '—' : pct(game.houseEdge)}</td>
                    <td className="muted">{game.isDefault ? 'built-in' : 'custom'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          <div className="panel__head">
            <h2>Edit game</h2>
            <select
              className="select"
              value={selectedId}
              onChange={(event) => {
                setSelectedId(event.target.value);
                setNotice(null);
              }}
              aria-label="Game"
            >
              {games.map((game) => (
                <option key={game.id} value={game.id}>
                  {game.label}
                </option>
              ))}
            </select>
          </div>

          {selected ? (
            <GameEditor key={`${selected.id}:${selected.updatedAt ?? 'default'}`} game={selected} onSaved={handleSaved} />
          ) : (
            <p className="empty">{loading ? 'Loading…' : 'No games.'}</p>
          )}
        </section>
      </main>
    </div>
  );
}
