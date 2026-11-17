import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { api, getApiErrorMessage } from '../api/client';
import type {
  BalanceResponse,
  BaccaratBet,
  BaccaratCard,
  BaccaratConfig,
  BaccaratResult,
} from '../api/types';
import { ArrowLeftIcon, WalletIcon } from '../components/Icons';
import { LivePlayerBadge } from '../components/LivePlayerBadge';
import { SoundToggle } from '../components/SoundToggle';
import { playSound } from '../utils/sound';

/**
 * Baccarat (Punto Banco) — one 52-card deck, bet on Player, Banker or Tie.
 *
 * The server settles the whole hand and returns both hands plus the payout; this
 * page only replays the deal. Cards slide in one at a time in real deal order
 * (Player, Banker, Player, Banker, then any third cards), the totals count up as
 * they land, and the winning side gets the felt glow. Because the artwork is
 * driven by the server's hands, the table can never show a result that wasn't
 * paid.
 *
 * Totals are mod 10 (7 + 8 = 5); a tie returns Player/Banker stakes. Payouts are
 * 2× Player, 1.95× Banker (5% commission) and 8× Tie — see
 * `GET /game/baccarat/config` for the exact odds the backend computed.
 */

const CHIPS = [1, 5, 10, 50, 100];
/** Preview stake used before the player types one. */
const DEFAULT_BET = 10;
/** Gap between dealt cards. */
const CARD_MS = 320;

/** Used only if the config request fails — mirrors the backend defaults. */
const FALLBACK_CONFIG: BaccaratConfig = {
  deckSize: 52,
  naturalTotal: 8,
  playerDrawsAt: 5,
  payouts: { player: 2, banker: 1.95, tie: 8 },
  bankerCommission: 0.05,
  pushOnTie: true,
  probabilities: { player: 0.44676, banker: 0.459624, tie: 0.093615 },
  rtp: { player: 0.9871, banker: 0.9899, tie: 0.7489 },
};

const SUIT_SYMBOL: Record<string, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };

/** One card in the order it hits the felt. */
type DealStep = { side: 'player' | 'banker'; index: number };

function money(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  const fractionDigits = rounded % 1 === 0 ? 0 : 2;

  return `$${rounded.toLocaleString('en-US', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: 2,
  })}`;
}

/** Card code → face details. */
function parseCard(code: BaccaratCard): { rank: string; suit: string; red: boolean } {
  const rank = code.slice(0, -1);
  const suit = code.slice(-1);

  return {
    rank: rank === 'T' ? '10' : rank,
    suit: SUIT_SYMBOL[suit] ?? '?',
    red: suit === 'H' || suit === 'D',
  };
}

/**
 * Player, Banker, Player, Banker — then the player's third card, then the
 * banker's, exactly like a real shoe.
 */
function buildDealSequence(playerCount: number, bankerCount: number): DealStep[] {
  const sequence: DealStep[] = [];
  const opening = Math.min(2, playerCount, bankerCount);

  for (let index = 0; index < opening; index += 1) {
    sequence.push({ side: 'player', index });
    sequence.push({ side: 'banker', index });
  }

  for (let index = opening; index < playerCount; index += 1) {
    sequence.push({ side: 'player', index });
  }
  for (let index = opening; index < bankerCount; index += 1) {
    sequence.push({ side: 'banker', index });
  }

  return sequence;
}

async function fetchBalance(): Promise<number> {
  const { data } = await api.get<BalanceResponse>('/wallet/balance');
  return data.balance;
}

async function fetchConfig(): Promise<BaccaratConfig> {
  const { data } = await api.get<BaccaratConfig>('/game/baccarat/config');
  return data;
}

/** A face-up card; `enter` adds the slide-in when it just landed. */
function CardView({ code, enter }: { code: BaccaratCard; enter: boolean }) {
  const card = parseCard(code);

  return (
    <div
      className={`bac-card${card.red ? ' bac-card--red' : ''}${enter ? ' bac-card--enter' : ''}`}
      aria-label={`${card.rank} of ${card.suit}`}
    >
      <span className="bac-card__rank">{card.rank}</span>
      <span className="bac-card__suit">{card.suit}</span>
    </div>
  );
}

/** An undealt slot — keeps the row from jumping as cards arrive. */
function CardBack() {
  return <div className="bac-card bac-card--back" aria-hidden="true" />;
}

/** Baccarat value of one card: A = 1, 2–9 face, T/J/Q/K = 0. */
function cardValue(code: BaccaratCard): number {
  const rank = code.slice(0, -1);

  if (rank === 'A') return 1;
  if (rank === 'T' || rank === 'J' || rank === 'Q' || rank === 'K') return 0;

  return Number(rank);
}

export default function Baccarat() {
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);

  const [amount, setAmount] = useState(String(DEFAULT_BET));
  const [config, setConfig] = useState<BaccaratConfig>(FALLBACK_CONFIG);

  const [result, setResult] = useState<BaccaratResult | null>(null);
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

  /** Every card that will hit the felt this hand, in order. */
  const sequence = result ? buildDealSequence(result.playerHand.length, result.bankerHand.length) : [];
  const settled = result !== null && revealed >= sequence.length;
  const visibleSteps = sequence.slice(0, revealed);

  const isVisible = (side: 'player' | 'banker', index: number): boolean =>
    visibleSteps.some((step) => step.side === side && step.index === index);

  const justLanded = (side: 'player' | 'banker', index: number): boolean => {
    const last = sequence[revealed - 1];
    return last !== undefined && last.side === side && last.index === index;
  };

  /** Running total of the cards already on the felt. */
  const runningTotal = (side: 'player' | 'banker'): string => {
    if (!result) return '–';

    const hand = side === 'player' ? result.playerHand : result.bankerHand;
    const visible = hand.filter((_, index) => isVisible(side, index));
    if (visible.length === 0) return '–';

    return String(visible.reduce((sum, card) => sum + cardValue(card), 0) % 10);
  };

  async function bet(side: BaccaratBet) {
    if (dealing) return;

    if (validStake <= 0) {
      setError('Enter a bet amount greater than 0.');
      return;
    }

    setDealing(true);
    setError(null);
    playSound('click');

    try {
      const { data } = await api.post<BaccaratResult>('/game/baccarat/play', {
        betAmount: validStake,
        betOn: side,
      });

      setBalance(data.balanceAfter);
      setResult(data);
      setRevealed(0);

      // Replay the deal: one card every CARD_MS, in real shoe order.
      const steps = buildDealSequence(data.playerHand.length, data.bankerHand.length).length;
      await new Promise<void>((resolve) => {
        let shown = 0;
        dealTimer.current = window.setInterval(() => {
          shown += 1;
          setRevealed(shown);
          playSound('click');

          if (shown >= steps) {
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

  const seatCards = (side: 'player' | 'banker'): BaccaratCard[] =>
    result ? (side === 'player' ? result.playerHand : result.bankerHand) : [];

  return (
    <div className="rt">
      <header className="rt__topbar">
        <Link to="/" className="rt__back">
          <ArrowLeftIcon className="icon icon--sm" />
          Back to Lobby
        </Link>

        <h1 className="rt__title">Baccarat ♠️</h1>

        <SoundToggle />

        <LivePlayerBadge baseCount={2600} />

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
          <div className={`bac-table${dealing ? ' bac-table--dealing' : ''}`}>
            <p className="bac-table__rule">
              Tie returns Player &amp; Banker stakes · totals count mod 10
            </p>

            <div className="bac-table__seats">
              <div
                className={`bac-seat${
                  settled && result.winner === 'player' ? ' bac-seat--winner' : ''
                }`}
              >
                <span className="bac-seat__label">
                  Player
                  <strong className="bac-seat__total">{runningTotal('player')}</strong>
                </span>

                <div className="bac-hand">
                  {result
                    ? seatCards('player').map((code, index) =>
                        isVisible('player', index) ? (
                          <CardView
                            key={`p-${index}`}
                            code={code}
                            enter={justLanded('player', index)}
                          />
                        ) : (
                          <CardBack key={`p-${index}`} />
                        ),
                      )
                    : [0, 1].map((slot) => <CardBack key={`p-slot-${slot}`} />)}
                </div>

                {settled && result.betOn === 'player' && (
                  <span className="bac-seat__bet">your bet</span>
                )}
              </div>

              <div className="bac-table__vline" aria-hidden="true" />

              <div
                className={`bac-seat${
                  settled && result.winner === 'banker' ? ' bac-seat--winner' : ''
                }`}
              >
                <span className="bac-seat__label">
                  Banker
                  <strong className="bac-seat__total">{runningTotal('banker')}</strong>
                </span>

                <div className="bac-hand">
                  {result
                    ? seatCards('banker').map((code, index) =>
                        isVisible('banker', index) ? (
                          <CardView
                            key={`b-${index}`}
                            code={code}
                            enter={justLanded('banker', index)}
                          />
                        ) : (
                          <CardBack key={`b-${index}`} />
                        ),
                      )
                    : [0, 1].map((slot) => <CardBack key={`b-slot-${slot}`} />)}
                </div>

                {settled && result.betOn === 'banker' && (
                  <span className="bac-seat__bet">your bet</span>
                )}
              </div>
            </div>

            <p className="bac-table__note">
              {dealing
                ? 'Dealing…'
                : settled && result.natural
                  ? 'Natural 8 or 9 — both sides stand'
                  : settled
                    ? `Player ${result.playerTotal} · Banker ${result.bankerTotal}`
                    : 'Player draws on 0–5 · Banker follows the table'}
            </p>
          </div>

          {result && settled && (
            <div
              className={`bac-result bac-result--${result.outcome}`}
              role="status"
              aria-live="polite"
            >
              <p className="bac-result__headline">
                {result.winner === 'tie' ? 'TIE' : `${result.winner.toUpperCase()} WINS`}
              </p>
              <p className="bac-result__amount">
                {result.outcome === 'won'
                  ? `+${money(result.payout - result.betAmount)}`
                  : result.outcome === 'push'
                    ? `stake returned · ${money(result.payout)}`
                    : `-${money(result.betAmount)}`}
              </p>
              <p className="bac-result__caption">
                You backed {result.betOn.toUpperCase()} ·{' '}
                {result.outcome === 'won'
                  ? `paid ${result.multiplier}× your bet`
                  : result.outcome === 'push'
                    ? 'a tie returns Player and Banker stakes'
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
              Table limits
              <span className="panel-value">
                {config.payouts.player}× / {config.payouts.banker}× / {config.payouts.tie}×
              </span>
            </div>
            <ul className="bac-odds">
              {(['player', 'banker', 'tie'] as const).map((side) => (
                <li key={side} className="bac-odds__row">
                  <span className="bac-odds__side">{side}</span>
                  <span className="bac-odds__pay">{config.payouts[side]}×</span>
                  <span className="bac-odds__rtp">{(config.rtp[side] * 100).toFixed(2)}% RTP</span>
                </li>
              ))}
            </ul>
            <p className="rt__meta rt__meta--left">
              Banker pays 1.95× — the 2× win less a {Math.round(config.bankerCommission * 100)}%
              commission.
            </p>
          </div>

          <div className="bac-actions">
            <button
              type="button"
              className="bac-action bac-action--player"
              onClick={() => void bet('player')}
              disabled={dealing || validStake <= 0}
            >
              <span className="bac-action__title">BET PLAYER</span>
              <span className="bac-action__sub">
                {config.payouts.player}× · {money(validStake * config.payouts.player)}
              </span>
            </button>

            <button
              type="button"
              className="bac-action bac-action--tie"
              onClick={() => void bet('tie')}
              disabled={dealing || validStake <= 0}
            >
              <span className="bac-action__title">BET TIE</span>
              <span className="bac-action__sub">
                {config.payouts.tie}× · {money(validStake * config.payouts.tie)}
              </span>
            </button>

            <button
              type="button"
              className="bac-action bac-action--banker"
              onClick={() => void bet('banker')}
              disabled={dealing || validStake <= 0}
            >
              <span className="bac-action__title">BET BANKER</span>
              <span className="bac-action__sub">
                {config.payouts.banker}× · {money(validStake * config.payouts.banker)}
              </span>
            </button>
          </div>

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
