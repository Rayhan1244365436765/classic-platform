import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { api, getApiErrorMessage } from '../api/client';
import type { BalanceResponse, TeenPattiConfig, TeenPattiResult } from '../api/types';
import { ArrowLeftIcon, WalletIcon } from '../components/Icons';
import { LivePlayerBadge } from '../components/LivePlayerBadge';
import { SoundToggle } from '../components/SoundToggle';
import { playSound } from '../utils/sound';

/**
 * Teen Patti — 3 cards each against the dealer.
 *
 * The server deals and settles; this page replays the six cards one at a time,
 * alternating Player / Dealer like a real table, then reveals both hand types
 * and glows the winner. A tie refunds the stake.
 *
 * Hand order (best first) and the payouts come from `GET /game/teenpatti/config`,
 * together with the exact odds the server computed — so the legend on screen is
 * the ranking that settled the hand.
 */

const CHIPS = [1, 5, 10, 50, 100];
/** Preview stake used before the player types one. */
const DEFAULT_BET = 10;
/** Gap between dealt cards. */
const CARD_MS = 260;
/** Cards per hand. */
const HAND_SIZE = 3;

/** Used only if the config request fails — mirrors the backend defaults. */
const FALLBACK_CONFIG: TeenPattiConfig = {
  deckSize: 52,
  handSize: 3,
  winMultiplier: 2,
  rake: 0.05,
  payoutMultiplier: 1.95,
  tieRefunds: true,
  ranking: [
    { id: 'trail', label: 'Trail' },
    { id: 'pureSequence', label: 'Pure Sequence' },
    { id: 'sequence', label: 'Sequence' },
    { id: 'colour', label: 'Colour' },
    { id: 'pair', label: 'Pair' },
    { id: 'high', label: 'High Card' },
  ],
  odds: {
    tieRate: 0.0011,
    winRate: 0.4994,
    loseRate: 0.4994,
    rtp: 0.975,
    houseEdge: 0.025,
    rtpWithoutRake: 1,
    hands: 22100,
    orderedPairs: 407170400,
    tiePairs: 450528,
    frequencies: {
      trail: 0.0024,
      pureSequence: 0.0022,
      sequence: 0.0326,
      colour: 0.0496,
      pair: 0.1694,
      high: 0.7439,
    },
  },
};

const SUIT_SYMBOL: Record<string, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };

/** One card in the order it hits the felt. */
type DealStep = { side: 'player' | 'dealer'; index: number };

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

/** Player, Dealer, Player, Dealer… — one card each, three times. */
function buildDealSequence(): DealStep[] {
  const sequence: DealStep[] = [];

  for (let index = 0; index < HAND_SIZE; index += 1) {
    sequence.push({ side: 'player', index });
    sequence.push({ side: 'dealer', index });
  }

  return sequence;
}

async function fetchBalance(): Promise<number> {
  const { data } = await api.get<BalanceResponse>('/wallet/balance');
  return data.balance;
}

async function fetchConfig(): Promise<TeenPattiConfig> {
  const { data } = await api.get<TeenPattiConfig>('/game/teenpatti/config');
  return data;
}

/** A face-up card; `enter` adds the slide-in when it just landed. */
function CardView({ code, enter }: { code: string; enter: boolean }) {
  const card = parseCard(code);

  return (
    <div
      className={`tp-card${card.red ? ' tp-card--red' : ''}${enter ? ' tp-card--enter' : ''}`}
      aria-label={`${card.rank} of ${card.suit}`}
    >
      <span className="tp-card__rank">{card.rank}</span>
      <span className="tp-card__suit">{card.suit}</span>
    </div>
  );
}

/** An undealt slot, so the row doesn't jump while the hand arrives. */
function CardBack({ label }: { label: string }) {
  return <div className="tp-card tp-card--back" aria-label={`${label} card face down`} />;
}

export default function TeenPatti() {
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);

  const [amount, setAmount] = useState(String(DEFAULT_BET));
  const [config, setConfig] = useState<TeenPattiConfig>(FALLBACK_CONFIG);

  const [result, setResult] = useState<TeenPattiResult | null>(null);
  /** How many of the six cards have landed (0–6). */
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

  const sequence = buildDealSequence();
  const settled = result !== null && revealed >= sequence.length;
  const visibleSteps = sequence.slice(0, revealed);

  const isVisible = (side: 'player' | 'dealer', index: number): boolean =>
    visibleSteps.some((step) => step.side === side && step.index === index);

  const justLanded = (side: 'player' | 'dealer', index: number): boolean => {
    const last = sequence[revealed - 1];
    return last !== undefined && last.side === side && last.index === index;
  };

  async function play() {
    if (dealing) return;

    if (validStake <= 0) {
      setError('Enter a bet amount greater than 0.');
      return;
    }

    setDealing(true);
    setError(null);
    playSound('click');

    try {
      const { data } = await api.post<TeenPattiResult>('/game/teenpatti/play', {
        betAmount: validStake,
      });

      setBalance(data.balanceAfter);
      setResult(data);
      setRevealed(0);

      // Six cards, alternating Player / Dealer.
      await new Promise<void>((resolve) => {
        let shown = 0;
        dealTimer.current = window.setInterval(() => {
          shown += 1;
          setRevealed(shown);
          playSound('click');

          if (shown >= sequence.length) {
            stopDeal();
            resolve();
          }
        }, CARD_MS);
      });

      if (data.outcome === 'won') {
        playSound('win');
      } else if (data.outcome === 'lost') {
        playSound('lose');
      }
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'The hand could not be dealt.'));
      void refreshBalance();
    } finally {
      setDealing(false);
    }
  }

  const cardsFor = (side: 'player' | 'dealer') =>
    result ? (side === 'player' ? result.playerHand : result.dealerHand) : [];

  return (
    <div className="rt">
      <header className="rt__topbar">
        <Link to="/" className="rt__back">
          <ArrowLeftIcon className="icon icon--sm" />
          Back to Lobby
        </Link>

        <h1 className="rt__title">Teen Patti 🃏</h1>

        <SoundToggle />

        <LivePlayerBadge baseCount={4000} />

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
          <div className={`tp-table${dealing ? ' tp-table--dealing' : ''}`}>
            <p className="tp-table__rule">
              Trail &gt; Pure Sequence &gt; Sequence &gt; Colour &gt; Pair &gt; High Card · a tie
              refunds
            </p>

            <div className="tp-table__seats">
              <div
                className={`tp-seat tp-seat--player${
                  settled && result.winner === 'player' ? ' tp-seat--winner' : ''
                }${settled && result.winner === 'tie' ? ' tp-seat--tie' : ''}`}
              >
                <span className="tp-seat__label">
                  Player
                  {settled && (
                    <em className="tp-seat__hand">{result.playerHandLabel}</em>
                  )}
                </span>

                <div className="tp-hand">
                  {result
                    ? cardsFor('player').map((code, index) =>
                        isVisible('player', index) ? (
                          <CardView
                            key={`p-${index}`}
                            code={code}
                            enter={justLanded('player', index)}
                          />
                        ) : (
                          <CardBack key={`p-${index}`} label="Player" />
                        ),
                      )
                    : [0, 1, 2].map((slot) => <CardBack key={`p-slot-${slot}`} label="Player" />)}
                </div>
              </div>

              <div className="tp-table__vs" aria-hidden="true">
                VS
              </div>

              <div
                className={`tp-seat tp-seat--dealer${
                  settled && result.winner === 'dealer' ? ' tp-seat--winner' : ''
                }${settled && result.winner === 'tie' ? ' tp-seat--tie' : ''}`}
              >
                <span className="tp-seat__label">
                  Dealer
                  {settled && (
                    <em className="tp-seat__hand">{result.dealerHandLabel}</em>
                  )}
                </span>

                <div className="tp-hand">
                  {result
                    ? cardsFor('dealer').map((code, index) =>
                        isVisible('dealer', index) ? (
                          <CardView
                            key={`d-${index}`}
                            code={code}
                            enter={justLanded('dealer', index)}
                          />
                        ) : (
                          <CardBack key={`d-${index}`} label="Dealer" />
                        ),
                      )
                    : [0, 1, 2].map((slot) => <CardBack key={`d-slot-${slot}`} label="Dealer" />)}
                </div>
              </div>
            </div>

            <p className="tp-table__note">
              {dealing
                ? `Dealing… ${revealed}/${sequence.length}`
                : settled
                  ? `${result.playerHandLabel} vs ${result.dealerHandLabel}`
                  : 'Place a bet to be dealt in'}
            </p>
          </div>

          {result && settled && (
            <div
              className={`tp-result tp-result--${result.outcome}`}
              role="status"
              aria-live="polite"
            >
              <p className="tp-result__headline">
                {result.winner === 'tie'
                  ? `Tie — both ${result.playerHandLabel}`
                  : `${result.winner === 'player' ? 'Player' : 'Dealer'} wins with a ${
                      result.winner === 'player' ? result.playerHandLabel : result.dealerHandLabel
                    }!`}
              </p>
              <p className="tp-result__amount">
                {result.outcome === 'won'
                  ? `+${money(result.payout - result.betAmount)}`
                  : result.outcome === 'push'
                    ? `stake returned · ${money(result.payout)}`
                    : `-${money(result.betAmount)}`}
              </p>
              <p className="tp-result__caption">
                {result.outcome === 'won'
                  ? `Paid ${result.multiplier}× your bet (2× less the ${Math.round(
                      config.rake * 100,
                    )}% rake)`
                  : result.outcome === 'push'
                    ? 'Identical hands — a tie refunds the stake'
                    : `${result.dealerHandLabel} beat your ${result.playerHandLabel}`}
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
              Hand order
              <span className="panel-value">{config.payoutMultiplier}× on a win</span>
            </div>
            <ol className="tp-ranking">
              {config.ranking.map((entry) => (
                <li key={entry.id} className="tp-ranking__row">
                  <span className="tp-ranking__label">{entry.label}</span>
                  <span className="tp-ranking__freq">
                    {(config.odds.frequencies[entry.id] * 100).toFixed(2)}%
                  </span>
                </li>
              ))}
            </ol>
            <p className="rt__meta rt__meta--left">
              Ties are {(config.odds.tieRate * 100).toFixed(2)}% of hands and refund the stake · RTP{' '}
              {(config.odds.rtp * 100).toFixed(2)}%
            </p>
          </div>

          <button
            type="button"
            className="aviator-action"
            onClick={() => void play()}
            disabled={dealing || validStake <= 0}
          >
            <span className="aviator-action__title">{dealing ? 'DEALING…' : 'PLAY'}</span>
            <span className="aviator-action__sub">
              {money(validStake)} · pays {money(validStake * config.payoutMultiplier)}
            </span>
          </button>

          {error && <p className="error">{error}</p>}

          <p className="rt__meta">
            {result
              ? `Round ${result.roundId.slice(0, 8)} · seed ${result.serverSeedHash.slice(0, 12)}…`
              : 'Provably fair · one committed shuffle per hand'}
          </p>
        </aside>
      </main>
    </div>
  );
}
