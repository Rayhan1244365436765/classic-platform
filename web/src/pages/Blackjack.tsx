import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { api, getApiErrorMessage } from '../api/client';
import type { BalanceResponse, BlackjackState } from '../api/types';
import { ArrowLeftIcon, WalletIcon } from '../components/Icons';
import { LivePlayerBadge } from '../components/LivePlayerBadge';
import { SoundToggle } from '../components/SoundToggle';
import { playSound } from '../utils/sound';

/**
 * Blackjack — one player against the dealer, single 52-card shoe.
 *
 * The hole card and the undealt cards stay on the server until the hand ends;
 * this page only renders what it is told (the up-card, your hand, totals).
 */

const CHIPS = [1, 5, 10, 50, 100];
const DEFAULT_BET = 10;

const SUIT_SYMBOL: Record<string, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };

function money(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  const fractionDigits = rounded % 1 === 0 ? 0 : 2;

  return `$${rounded.toLocaleString('en-US', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: 2,
  })}`;
}

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
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);

  const [amount, setAmount] = useState(String(DEFAULT_BET));
  const [game, setGame] = useState<BlackjackState | null>(null);
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

    try {
      const { data } = await api.post<BlackjackState>('/game/blackjack/start', {
        betAmount: stake,
      });

      setGame(data);
      setBalance(data.balanceAfter);
      playSound('click');

      if (data.status !== 'active') {
        // A natural settled immediately.
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

  const balanceLabel = balance === null ? '···' : money(balance);
  const stake = Number(amount) || 0;
  const previewStake = stake > 0 ? stake : DEFAULT_BET;
  const active = game?.status === 'active';
  const settled = game !== null && game.status !== 'active';
  const dealerHidden = active;

  const outcomeText = !game
    ? ''
    : game.status === 'won'
      ? game.playerBlackjack
        ? 'BLACKJACK!'
        : 'You win!'
      : game.status === 'push'
        ? 'Push — bet returned'
        : game.playerTotal > 21
          ? 'Bust!'
          : 'Dealer wins';

  return (
    <div className="rt">
      <header className="rt__topbar">
        <Link to="/" className="rt__back">
          <ArrowLeftIcon className="icon icon--sm" />
          Back to Lobby
        </Link>

        <h1 className="rt__title">Blackjack</h1>

        <SoundToggle />

        <LivePlayerBadge baseCount={3500} />

        <span
          className={`balance-pill${balanceError ? ' balance-pill--error' : ''}`}
          title={balanceError ?? 'Current balance'}
        >
          <WalletIcon className="icon icon--sm" />
          {balanceLabel}
        </span>
      </header>

      <main className="rt__body">
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

          {settled && game && (
            <div
              className={`bj-result${
                game.status === 'won'
                  ? ' bj-result--win'
                  : game.status === 'push'
                    ? ' bj-result--push'
                    : ' bj-result--lose'
              }`}
              role="status"
              aria-live="polite"
            >
              <p className="bj-result__headline">{outcomeText}</p>
              <p className="bj-result__amount">
                {game.status === 'won'
                  ? `+${money(game.payout - game.betAmount)}`
                  : game.status === 'push'
                    ? `${money(game.payout)} returned`
                    : `-${money(game.betAmount)}`}
              </p>
              <p className="bj-result__caption">
                You {game.playerTotal} · dealer {game.dealerTotal ?? '—'}
              </p>
            </div>
          )}

          <p className="rt__fair">
            Provably fair shoe · the hole card and the deck never leave the server
          </p>
          {balanceError && <p className="error">{balanceError}</p>}
        </section>

        <aside className="rt__panel">
          <div className="panel-block">
            <div className="panel-label">
              Bet amount
              <span className="panel-value">{money(active ? (game?.betAmount ?? 0) : previewStake)}</span>
            </div>
            <div className="chips">
              {CHIPS.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  className={`chip${stake === chip ? ' chip--active' : ''}`}
                  onClick={() => setAmount(String(chip))}
                  disabled={active || busy}
                  aria-pressed={stake === chip}
                >
                  ${chip}
                </button>
              ))}
              <input
                className="chips__custom"
                type="number"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                min={0.5}
                step={0.5}
                disabled={active || busy}
                aria-label="Custom bet amount"
              />
            </div>
          </div>

          <div className="panel-block">
            <div className="panel-label">
              Hand
              <span className="panel-value">
                {game ? (game.dealerTotal === null ? 'in play' : `${game.playerTotal} vs ${game.dealerTotal}`) : '—'}
              </span>
            </div>
            <div className="payout">
              <span className="payout__amount payout__amount--gold">
                <span className="payout__label">Win pays</span>
                {money((game?.betAmount ?? previewStake) * 2)}
              </span>
              <span className="payout__amount payout__amount--gray">
                <span className="payout__label">Push</span>
                {money(game?.betAmount ?? previewStake)}
              </span>
            </div>
          </div>

          {active ? (
            <div className="bj-actions">
              <button
                type="button"
                className="aviator-action aviator-action--cashout"
                onClick={() => void act('hit')}
                disabled={busy}
              >
                <span className="aviator-action__title">HIT</span>
                <span className="aviator-action__sub">take a card</span>
              </button>
              <button
                type="button"
                className="aviator-action"
                onClick={() => void act('stand')}
                disabled={busy}
              >
                <span className="aviator-action__title">STAND</span>
                <span className="aviator-action__sub">stay on {game?.playerTotal}</span>
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="aviator-action"
              onClick={() => void deal()}
              disabled={busy}
            >
              <span className="aviator-action__title">{busy ? 'DEALING…' : 'DEAL'}</span>
              <span className="aviator-action__sub">{money(previewStake)}</span>
            </button>
          )}

          {error && <p className="error">{error}</p>}

          <p className="rt__meta">
            {game
              ? `Hand ${game.gameId.slice(0, 8)}${game.serverSeedHash ? ` · seed ${game.serverSeedHash.slice(0, 12)}…` : ''}`
              : 'The server publishes a seed hash before every hand'}
          </p>
        </aside>

      </main>
    </div>
  );
}


