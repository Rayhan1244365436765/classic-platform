import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { api, getApiErrorMessage } from '../api/client';
import type { GameHistoryResponse, GameHistoryRound, PaymentRequest } from '../api/types';
import { ArrowLeftIcon } from '../components/Icons';

const PAGE_SIZE = 20;

/** Maps backend bet_type / game slugs to friendly names. */
const GAME_LABELS: Record<string, string> = {
  spin: 'Spin to Win', slots: 'Lucky Slots', dice: 'Dice', dice3d: '3D Dice',
  aviator: 'Aviator', mines: 'Mines', plinko: 'Plinko', keno: 'Keno',
  blackjack: 'Blackjack', baccarat: 'Baccarat', dragontiger: 'Dragon Tiger',
  teenpatti: 'Teen Patti', cascade: 'Showdown', classic_roulette: 'Classic Roulette',
  fruit_bonanza: 'Fruit Bonanza', boxing_king: 'Boxing King', fortune_gems: 'Fortune Gems',
  red: 'Roulette', black: 'Roulette', green: 'Roulette', even: 'Roulette',
  odd: 'Roulette', low: 'Roulette', high: 'Roulette', number: 'Roulette',
};

function money(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return `$${rounded.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function signedMoney(value: number): string {
  return `${value >= 0 ? '+' : ''}${money(value)}`;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

function gameLabel(game: string): string {
  return GAME_LABELS[game] ?? game;
}

export default function History() {
  const navigate = useNavigate();
  const [rounds, setRounds] = useState<GameHistoryRound[]>([]);
  const [total, setTotal] = useState(0);
  const [payments, setPayments] = useState<PaymentRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadInitial() {
      try {
        const [roundsRes, paymentsRes] = await Promise.all([
          api.get<GameHistoryResponse>(`/game/history?limit=${PAGE_SIZE}&offset=0`),
          api.get<{ payments: PaymentRequest[] }>('/payment/mine'),
        ]);
        if (cancelled) return;
        setRounds(roundsRes.data.rounds ?? []);
        setTotal(roundsRes.data.total ?? 0);
        setPayments(paymentsRes.data.payments ?? []);
      } catch (requestError) {
        if (!cancelled) setError(getApiErrorMessage(requestError, 'Could not load your history.'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadInitial();
    return () => {
      cancelled = true;
    };
  }, []);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const { data } = await api.get<GameHistoryResponse>(
        `/game/history?limit=${PAGE_SIZE}&offset=${rounds.length}`,
      );
      setRounds((prev) => [...prev, ...(data.rounds ?? [])]);
      setTotal(data.total ?? total);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Could not load more history.'));
    } finally {
      setLoadingMore(false);
    }
  }

  const hasMore = rounds.length < total;

  return (
    <div className="history">
      <header className="history__top">
        <button type="button" className="history__back" onClick={() => navigate('/')}>
          <ArrowLeftIcon className="icon icon--sm" />
          <span>Lobby</span>
        </button>
        <h1 className="history__title">History</h1>
      </header>

      <main className="history__main">
        {error && <p className="error">{error}</p>}

        <section className="history-section">
          <h2>Deposits &amp; Withdrawals</h2>
          {payments.length === 0 ? (
            <p className="history-empty">{loading ? 'Loading…' : 'No deposit or withdrawal requests yet.'}</p>
          ) : (
            <ul className="history-list">
              {payments.map((payment) => (
                <li key={payment.id} className="history-row">
                  <span className={`history-badge history-badge--${payment.type}`}>{payment.type}</span>
                  <span className="history-amount">{money(payment.amount)}</span>
                  <span className="history-status">{payment.status}</span>
                  <span className="history-date">{formatDate(payment.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="history-section">
          <h2>Game Bets</h2>
          {rounds.length === 0 ? (
            <p className="history-empty">{loading ? 'Loading…' : 'No bets yet. Play a game to see it here.'}</p>
          ) : (
            <ul className="history-list">
              {rounds.map((round) => {
                const net = round.payout - round.betAmount;
                const lost = round.payout === 0;
                const push = !lost && Math.abs(net) < 0.005;
                return (
                  <li key={round.id} className="history-row">
                    <span className="history-game">{gameLabel(round.game)}</span>
                    <span className="history-amount">{lost ? `-${money(round.betAmount)}` : signedMoney(net)}</span>
                    <span className={`history-result${lost ? ' history-result--lost' : ' history-result--won'}`}>
                      {lost ? 'Lost' : push ? 'Push' : 'Won'}
                    </span>
                    {round.multiplier !== null && <span className="history-mult">{round.multiplier}×</span>}
                    <span className="history-date">{formatDate(round.createdAt)}</span>
                  </li>
                );
              })}
            </ul>
          )}
          {hasMore && (
            <button type="button" className="history-more" onClick={() => void loadMore()} disabled={loadingMore}>
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          )}
        </section>
      </main>
    </div>
  );
}