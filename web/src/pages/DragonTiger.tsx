import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { api, getApiErrorMessage } from '../api/client';
import type {
  BalanceResponse,
  DragonTigerBet,
  DragonTigerConfig,
  DragonTigerResult,
} from '../api/types';
import { ArrowLeftIcon, WalletIcon } from '../components/Icons';
import { LivePlayerBadge } from '../components/LivePlayerBadge';
import { SoundToggle } from '../components/SoundToggle';
import { playSound } from '../utils/sound';

/**
 * Dragon Tiger — one card each, highest rank wins (A = 1 … K = 13).
 *
 * The server deals and settles; this page replays the two cards one at a time
 * with a slide from the shoe, counts the ranks up, then glows the winning side.
 * A tie loses Dragon and Tiger bets, so a tie only pays the Tie bet.
 *
 * The shoe is the standard 8-deck Dragon Tiger shoe and the payouts (2× / 2× /
 * 8×) come from `GET /game/dragontiger/config` together with the exact odds, so
 * the table always prints what settled the hand.
 */

const CHIPS = [1, 5, 10, 50, 100];
/** Preview stake used before the player types one. */
const DEFAULT_BET = 10;
/** Gap between the Dragon card and the Tiger card. */
const CARD_MS = 380;

/** Used only if the config request fails — mirrors the backend defaults. */
const FALLBACK_CONFIG: DragonTigerConfig = {
  decks: 8,
  shoeSize: 416,
  payouts: { dragon: 2, tiger: 2, tie: 8 },
  tieLosesSides: true,
  probabilities: { dragon: 0.462651, tiger: 0.462651, tie: 0.074699 },
  rtp: { dragon: 0.9253, tiger: 0.9253, tie: 0.5976 },
  alternatives: [
    { decks: 1, rtp: { dragon: 0.9412, tiger: 0.9412, tie: 0.4706 } },
    { decks: 8, rtp: { dragon: 0.9253, tiger: 0.9253, tie: 0.5976 } },
  ],
};

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

async function fetchBalance(): Promise<number> {
  const { data } = await api.get<BalanceResponse>('/wallet/balance');
  return data.balance;
}

async function fetchConfig(): Promise<DragonTigerConfig> {
  const { data } = await api.get<DragonTigerConfig>('/game/dragontiger/config');
  return data;
}

/** A face-up card; `enter` adds the slide-in when it just landed. */
function CardView({ code, enter }: { code: string; enter: boolean }) {
  const card = parseCard(code);

  return (
    <div
      className={`dt-card${card.red ? ' dt-card--red' : ''}${enter ? ' dt-card--enter' : ''}`}
      aria-label={`${card.rank} of ${card.suit}`}
    >
      <span className="dt-card__rank">{card.rank}</span>
      <span className="dt-card__suit">{card.suit}</span>
    </div>
  );
}

/** The undealt slot while the card is still in the shoe. */
function CardBack({ label }: { label: string }) {
  return <div className="dt-card dt-card--back" aria-label={`${label} card face down`} />;
}

export default function DragonTiger() {
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);

  const [amount, setAmount] = useState(String(DEFAULT_BET));
  const [config, setConfig] = useState<DragonTigerConfig>(FALLBACK_CONFIG);

  const [result, setResult] = useState<DragonTigerResult | null>(null);
  /** 0 = both face down, 1 = Dragon revealed, 2 = both revealed. */
  const [revealed, setRevealed] = useState(0);
  const [dealing, setDealing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dealTimer = useRef<number | null>(null);

  const stopDeal = useCallback(() => {
    if (dealTimer.current !== null) {
      window.clearInterval(dealTimer.current);
      dealTimer.current = null;
    }
  }, []);

  // Never leave a timer behind when the page unmounts.
  useEffect(() => stopDeal, [stopDeal]);

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
        if (!cancelled) setBalance(value);
      } catch (requestError) {
        if (!cancelled) {
          setBalanceError(getApiErrorMessage(requestError, 'Could not load your balance.'));
        }
      }

      try {
        const next = await fetchConfig();
        if (!cancelled) setConfig(next);
      } catch {
        // Keep FALLBACK_CONFIG — the table still works with the mirrored numbers.
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  const stake = Number(amount);
  const validStake = Number.isFinite(stake) && stake > 0 ? Math.round(stake * 100) / 100 : 0;
  const balanceLabel = balance === null ? '—' : money(balance);

  const settled = result !== null && revealed >= 2;
  const dragonUp = revealed >= 1;
  const tigerUp = revealed >= 2;

  async function bet(side: DragonTigerBet) {
    if (dealing) return;

    if (validStake <= 0) {
      setError('Enter a bet amount greater than 0.');
      return;
    }

    setDealing(true);
    setError(null);
    playSound('click');

    try {
      const { data } = await api.post<DragonTigerResult>('/game/dragontiger/play', {
        betAmount: validStake,
        betOn: side,
      });

      setBalance(data.balanceAfter);
      setResult(data);
      setRevealed(0);

      // Dragon first, then Tiger — one card per tick.
      await new Promise<void>((resolve) => {
        let shown = 0;
        dealTimer.current = window.setInterval(() => {
          shown += 1;
          setRevealed(shown);
          playSound('click');

          if (shown >= 2) {
            stopDeal();
            resolve();
          }
        }, CARD_MS);
      });

      if (data.outcome === 'won') {
        playSound('win');
      } else {
        playSound('lose');
      }
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'The hand could not be dealt.'));
      void refreshBalance();
    } finally {
      setDealing(false);
    }
  }

  return (
    <div className="rt">
      <header className="rt__topbar">
        <Link to="/" className="rt__back">
          <ArrowLeftIcon className="icon icon--sm" />
          Back to Lobby
        </Link>

        <h1 className="rt__title">Dragon Tiger 🐉</h1>

        <SoundToggle />

        <LivePlayerBadge baseCount={3300} />

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
          <div className={`dt-table${dealing ? ' dt-table--dealing' : ''}`}>
            <p className="dt-table__rule">
              Highest card wins · a tie loses Dragon &amp; Tiger · {config.decks}-deck shoe
            </p>

            <div className="dt-table__seats">
              <div
                className={`dt-seat dt-seat--dragon${
                  settled && result.winner === 'dragon' ? ' dt-seat--winner' : ''
                }${settled && result.winner === 'tie' ? ' dt-seat--tie' : ''}`}
              >
                <span className="dt-seat__label">
                  Dragon
                  <strong className="dt-seat__rank">
                    {settled ? result.dragonRank : dragonUp ? '…' : '–'}
                  </strong>
                </span>

                {dragonUp && result ? (
                  <CardView code={result.dragonCard} enter />
                ) : (
                  <CardBack label="Dragon" />
                )}

                {settled && result.betOn === 'dragon' && (
                  <span className="dt-seat__bet">your bet</span>
                )}
              </div>

              <div className="dt-table__vs" aria-hidden="true">
                VS
              </div>

              <div
                className={`dt-seat dt-seat--tiger${
                  settled && result.winner === 'tiger' ? ' dt-seat--winner' : ''
                }${settled && result.winner === 'tie' ? ' dt-seat--tie' : ''}`}
              >
                <span className="dt-seat__label">
                  Tiger
                  <strong className="dt-seat__rank">
                    {settled ? result.tigerRank : tigerUp ? '…' : '–'}
                  </strong>
                </span>

                {tigerUp && result ? (
                  <CardView code={result.tigerCard} enter />
                ) : (
                  <CardBack label="Tiger" />
                )}

                {settled && result.betOn === 'tiger' && (
                  <span className="dt-seat__bet">your bet</span>
                )}
              </div>
            </div>

            <p className="dt-table__note">
              {dealing
                ? 'Dealing…'
                : settled
                  ? result.winner === 'tie'
                    ? `Both drew rank ${result.dragonRank} — tie`
                    : `${result.winner === 'dragon' ? 'Dragon' : 'Tiger'} ${Math.max(
                        result.dragonRank,
                        result.tigerRank,
                      )} beats ${Math.min(result.dragonRank, result.tigerRank)}`
                  : 'Place a bet to be dealt in'}
            </p>
          </div>

          {result && settled && (
            <div
              className={`dt-result dt-result--${result.outcome}`}
              role="status"
              aria-live="polite"
            >
              <p className="dt-result__headline">
                {result.winner === 'tie' ? 'TIE' : `${result.winner.toUpperCase()} WINS`}
              </p>
              <p className="dt-result__amount">
                {result.outcome === 'won'
                  ? `+${money(result.payout - result.betAmount)}`
                  : `-${money(result.betAmount)}`}
              </p>
              <p className="dt-result__caption">
                You backed {result.betOn.toUpperCase()} ·{' '}
                {result.outcome === 'won'
                  ? `paid ${result.multiplier}× your bet`
                  : result.winner === 'tie'
                    ? 'a tie loses Dragon and Tiger bets'
                    : `${result.winner.toUpperCase()} took it`}
              </p>
            </div>
          )}
        </section>

        <aside className="rt__panel">
          <div className="panel-block">
            <div className="panel-label">
              Bet amount
              <span className="panel-value">{money(validStake)}</span>
            </div>
            <div className="chips">
              {CHIPS.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  className={`chip${validStake === chip ? ' chip--active' : ''}`}
                  onClick={() => {
                    playSound('click');
                    setAmount(String(chip));
                  }}
                  disabled={dealing}
                  aria-pressed={validStake === chip}
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
                disabled={dealing}
                aria-label="Custom bet amount"
              />
            </div>
          </div>

          <div className="panel-block">
            <div className="panel-label">
              Paytable
              <span className="panel-value">
                {config.payouts.dragon}× / {config.payouts.tie}×
              </span>
            </div>
            <ul className="dt-odds">
              {(['dragon', 'tiger', 'tie'] as const).map((side) => (
                <li key={side} className="dt-odds__row">
                  <span className="dt-odds__side">{side}</span>
                  <span className="dt-odds__pay">{config.payouts[side]}×</span>
                  <span className="dt-odds__rtp">{(config.rtp[side] * 100).toFixed(2)}% RTP</span>
                </li>
              ))}
            </ul>
            <p className="rt__meta rt__meta--left">
              {config.decks}-deck shoe · ties are {(config.probabilities.tie * 100).toFixed(2)}% of
              hands
            </p>
          </div>

          <div className="dt-actions">
            <button
              type="button"
              className="dt-action dt-action--dragon"
              onClick={() => void bet('dragon')}
              disabled={dealing || validStake <= 0}
            >
              <span className="dt-action__title">BET DRAGON</span>
              <span className="dt-action__sub">
                {config.payouts.dragon}× · {money(validStake * config.payouts.dragon)}
              </span>
            </button>

            <button
              type="button"
              className="dt-action dt-action--tie"
              onClick={() => void bet('tie')}
              disabled={dealing || validStake <= 0}
            >
              <span className="dt-action__title">BET TIE</span>
              <span className="dt-action__sub">
                {config.payouts.tie}× · {money(validStake * config.payouts.tie)}
              </span>
            </button>

            <button
              type="button"
              className="dt-action dt-action--tiger"
              onClick={() => void bet('tiger')}
              disabled={dealing || validStake <= 0}
            >
              <span className="dt-action__title">BET TIGER</span>
              <span className="dt-action__sub">
                {config.payouts.tiger}× · {money(validStake * config.payouts.tiger)}
              </span>
            </button>
          </div>

          {error && <p className="error">{error}</p>}

          <p className="rt__meta">
            {result
              ? `Round ${result.roundId.slice(0, 8)} · seed ${result.serverSeedHash.slice(0, 12)}…`
              : 'Provably fair · one committed deal per hand'}
          </p>
        </aside>
      </main>
    </div>
  );
}
