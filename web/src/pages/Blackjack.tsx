import { useCallback, useEffect, useState } from 'react';

import { api, getApiErrorMessage } from '../api/client';
import type { BalanceResponse, BlackjackState } from '../api/types';
import { GameShell } from '../components/GameShell';
import { GameResultOverlay } from '../components/GameResultOverlay';
import { useGameMusic } from '../hooks/useGameMusic';
import { playSound } from '../utils/sound';

/**
 * Blackjack — one player against the dealer, single 52-card shoe.
 *
 * The hole card and the undealt cards stay on the server until the hand ends;
 * this page only renders what it is told (the up-card, your hand, totals).
 */

const DEFAULT_BET = 10;

const SUIT_SYMBOL: Record<string, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };

/** Card code → face details. */
function parseCard(code: string): { rank: string; suit: string; red: boolean } {
  const rank = code.slice(0, -1);
  const suit = code.slice(-1);

  return {
    rank: rank === 'T' ? '10' : rank,
    suit: SUIT_SYMBOL[suit] ?? '?',
    red: suit === 'H' || suit === 'D',
  };
}

function CardView({
  code,
  index,
  hidden = false,
}: {
  code?: string;
  index: number;
  hidden?: boolean;
}) {
  const style = { animationDelay: `${index * 90}ms` };

  if (hidden || !code) {
    return <div className="bj-card bj-card--back" style={style} aria-label="Hidden card" />;
  }

  const card = parseCard(code);

  return (
    <div
      className={`bj-card${card.red ? ' bj-card--red' : ''}`}
      style={style}
      aria-label={`${card.rank} of ${card.suit}`}
    >
      <span className="bj-card__rank">{card.rank}</span>
      <span className="bj-card__suit">{card.suit}</span>
    </div>
  );
}

async function fetchBalance(): Promise<number> {
  const { data } = await api.get<BalanceResponse>('/wallet/balance');
  return data.balance;
}

export default function Blackjack() {
  useGameMusic('/audio/cards-bgm.mp3', 0.4);

  const [balance, setBalance] = useState<number | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);

  const [amount, setAmount] = useState(String(DEFAULT_BET));
  const [game, setGame] = useState<BlackjackState | null>(null);
  const [showWin, setShowWin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshBalance = useCallback(async () => {
    try {
      setBalance(await fetchBalance());
      setBalanceError(null);
    } catch (requestError) {
      setBalanceError(getApiErrorMessage(requestError, 'Could not load your balance.'));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const value = await fetchBalance();
        if (!cancelled) {
          setBalance(value);
          setBalanceError(null);
        }
      } catch (requestError) {
        if (!cancelled) {
          setBalanceError(getApiErrorMessage(requestError, 'Could not load your balance.'));
        }
      }
    }

    // Re-attach to a hand left open by a reload / second tab.
    async function resume() {
      try {
        const { data } = await api.get<{ game: BlackjackState | null }>('/game/blackjack/current');
        if (!cancelled && data.game) {
          setGame(data.game);
          setAmount(String(data.game.betAmount));
        }
      } catch {
        // No resumable hand — a fresh table is fine.
      }
    }

    void load();
    void resume();

    return () => {
      cancelled = true;
    };
  }, []);

  async function deal() {
    if (busy || game?.status === 'active') {
      return;
    }

    setError(null);

    const stake = Number(amount);
    if (!Number.isFinite(stake) || stake <= 0) {
      setError('Enter a bet amount greater than 0.');
      return;
    }

    setBusy(true);
    setGame(null);
    setShowWin(false);

    try {
      const { data } = await api.post<BlackjackState>('/game/blackjack/start', {
        betAmount: stake,
      });

      setGame(data);
      setBalance(data.balanceAfter);
      playSound('click');

      if (data.status !== 'active') {
        // A natural settled immediately.
        if (data.status === 'won') setShowWin(true);
        playSound(data.status === 'won' ? 'win' : data.status === 'push' ? 'click' : 'lose');
        void refreshBalance();
      }
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'The hand could not be dealt.'));
      void refreshBalance();
    } finally {
      setBusy(false);
    }
  }

  async function act(action: 'hit' | 'stand') {
    if (!game || game.status !== 'active' || busy) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const { data } = await api.post<BlackjackState>(`/game/blackjack/${action}`, {
        gameId: game.gameId,
      });

      setGame(data);
      setBalance(data.balanceAfter);
      playSound('click');

      if (data.status !== 'active') {
        if (data.status === 'won') setShowWin(true);
        playSound(data.status === 'won' ? 'win' : data.status === 'push' ? 'click' : 'lose');
        void refreshBalance();
      }
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'That move was not accepted.'));
      void refreshBalance();
    } finally {
      setBusy(false);
    }
  }

  const stake = Number(amount) || 0;
  const previewStake = stake > 0 ? stake : DEFAULT_BET;
  const active = game?.status === 'active';
  const dealerHidden = active;

  return (
    <GameShell
      balance={balance}
      balanceError={balanceError}
      betAmount={active ? (game?.betAmount ?? previewStake) : previewStake}
      setBetAmount={(value) => setAmount(String(value))}
      onSpin={() => void (active ? act('stand') : deal())}
      spinLabel={active ? 'STAND' : busy ? 'DEALING…' : 'DEAL'}
      isSpinning={busy}
      controls={
        active ? (
          <div className="bj-actions" style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="chip chip--active"
              onClick={() => void act('hit')}
              disabled={busy}
            >
              HIT
            </button>
            <button type="button" className="chip" onClick={() => void act('stand')} disabled={busy}>
              STAND
            </button>
          </div>
        ) : null
      }
    >
      <section className="rt__stage">
        <div className={`bj-table${active ? ' bj-table--active' : ''}`}>
          <div className="bj-table__felt">
            <p className="bj-table__rule">Blackjack pays 2× · dealer stands on 17</p>

            <div className="bj-seat">
              <span className="bj-seat__label">
                Dealer
                <strong className="bj-seat__total">
                  {game ? (game.dealerTotal ?? `${game.dealerHand.length} card`) : '—'}
                </strong>
              </span>
              <div className="bj-hand" key={`dealer-${game?.gameId ?? 'none'}`}>
                {game ? (
                  <>
                    {game.dealerHand.map((code, index) => (
                      <CardView key={`${code}-${index}`} code={code} index={index} />
                    ))}
                    {dealerHidden && <CardView index={game.dealerHand.length} hidden />}
                  </>
                ) : (
                  <span className="bj-hand__empty">no cards</span>
                )}
              </div>
            </div>

            <div className="bj-table__divider" aria-hidden="true" />

            <div className="bj-seat bj-seat--player">
              <div className="bj-hand" key={`player-${game?.gameId ?? 'none'}`}>
                {game ? (
                  game.playerHand.map((code, index) => (
                    <CardView key={`${code}-${index}`} code={code} index={index} />
                  ))
                ) : (
                  <span className="bj-hand__empty">place a bet to be dealt in</span>
                )}
              </div>
              <span className="bj-seat__label">
                You
                <strong
                  className={`bj-seat__total${
                    game && game.playerTotal > 21 ? ' bj-seat__total--bust' : ''
                  }`}
                >
                  {game ? game.playerTotal : '—'}
                </strong>
              </span>
            </div>
          </div>
        </div>

        {game && (
          <GameResultOverlay
            isOpen={showWin}
            isWin={game.status === 'won'}
            amount={game.status === 'won' ? game.payout : 0}
            multiplier={game.betAmount > 0 ? Math.round((game.payout / game.betAmount) * 100) / 100 : 0}
            detail={`You ${game.playerTotal} · dealer ${game.dealerTotal ?? '—'}`}
            onClose={() => setShowWin(false)}
          />
        )}

        <p className="rt__fair">
          Provably fair shoe · the hole card and the deck never leave the server
        </p>
        {error && <p className="error">{error}</p>}
      </section>
    </GameShell>
  );
}


