import { useCallback, useEffect, useRef, useState } from 'react';

import { api, getApiErrorMessage } from '../api/client';
import type {
  BalanceResponse,
  BaccaratBet,
  BaccaratCard,
  BaccaratConfig,
  BaccaratResult,
} from '../api/types';
import { GameShell } from '../components/GameShell';
import { GameResultOverlay } from '../components/GameResultOverlay';
import { useGameMusic } from '../hooks/useGameMusic';
import { playSound } from '../utils/sound';

/**
 * Baccarat (Punto Banco) — one 52-card deck, bet on Player, Banker or Tie.
 */

const DEFAULT_BET = 10;
const CARD_MS = 320;

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

type DealStep = { side: 'player' | 'banker'; index: number };

function parseCard(code: BaccaratCard): { rank: string; suit: string; red: boolean } {
  const rank = code.slice(0, -1);
  const suit = code.slice(-1);

  return {
    rank: rank === 'T' ? '10' : rank,
    suit: SUIT_SYMBOL[suit] ?? '?',
    red: suit === 'H' || suit === 'D',
  };
}

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

function CardBack() {
  return <div className="bac-card bac-card--back" aria-hidden="true" />;
}

function cardValue(code: BaccaratCard): number {
  const rank = code.slice(0, -1);

  if (rank === 'A') return 1;
  if (rank === 'T' || rank === 'J' || rank === 'Q' || rank === 'K') return 0;

  return Number(rank);
}

export default function Baccarat() {
  useGameMusic('/audio/cards-bgm.mp3', 0.4);

  const [balance, setBalance] = useState<number | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);

  const [amount, setAmount] = useState(String(DEFAULT_BET));
  const [config, setConfig] = useState<BaccaratConfig>(FALLBACK_CONFIG);
  const [betOn, setBetOn] = useState<BaccaratBet>('player');

  const [result, setResult] = useState<BaccaratResult | null>(null);
  const [revealed, setRevealed] = useState(0);
  const [dealing, setDealing] = useState(false);
  const [showWin, setShowWin] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dealTimer = useRef<number | null>(null);

  const stopDeal = useCallback(() => {
    if (dealTimer.current !== null) {
      window.clearInterval(dealTimer.current);
      dealTimer.current = null;
    }
  }, []);

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
        // Keep FALLBACK_CONFIG
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  const stake = Number(amount);
  const validStake = Number.isFinite(stake) && stake > 0 ? Math.round(stake * 100) / 100 : 0;

  const sequence = result ? buildDealSequence(result.playerHand.length, result.bankerHand.length) : [];
  const settled = result !== null && revealed >= sequence.length;
  const visibleSteps = sequence.slice(0, revealed);

  const isVisible = (side: 'player' | 'banker', index: number): boolean =>
    visibleSteps.some((step) => step.side === side && step.index === index);

  const justLanded = (side: 'player' | 'banker', index: number): boolean => {
    const last = sequence[revealed - 1];
    return last !== undefined && last.side === side && last.index === index;
  };

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
    setShowWin(false);
    playSound('click');

    try {
      const { data } = await api.post<BaccaratResult>('/game/baccarat/play', {
        betAmount: validStake,
        betOn: side,
      });

      setBalance(data.balanceAfter);
      setResult(data);
      setRevealed(0);

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
        setShowWin(true);
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
    <GameShell
      balance={balance}
      balanceError={balanceError}
      betAmount={validStake}
      setBetAmount={(value) => setAmount(String(value))}
      onSpin={() => void bet(betOn)}
      spinLabel={dealing ? 'DEALING…' : `BET ${betOn.toUpperCase()}`}
      isSpinning={dealing}
      controls={
        <div className="chips" style={{ flexWrap: 'nowrap' }}>
          {(['player', 'tie', 'banker'] as const).map((side) => (
            <button
              key={side}
              type="button"
              className={`chip${betOn === side ? ' chip--active' : ''}`}
              onClick={() => {
                playSound('click');
                setBetOn(side);
              }}
              disabled={dealing}
              aria-pressed={betOn === side}
            >
              {side.toUpperCase()}
            </button>
          ))}
        </div>
      }
    >
      <section className="rt__stage">
        <div className={`bac-table${dealing ? ' bac-table--dealing' : ''}`}>
          <p className="bac-table__rule">
            Tie returns Player &amp; Banker stakes · totals count mod 10
          </p>

          <div className="bac-table__seats">
            <div
              className={`bac-seat${
                settled && result?.winner === 'player' ? ' bac-seat--winner' : ''
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

              {settled && result?.betOn === 'player' && <span className="bac-seat__bet">your bet</span>}
            </div>

            <div className="bac-table__vline" aria-hidden="true" />

            <div
              className={`bac-seat${
                settled && result?.winner === 'banker' ? ' bac-seat--winner' : ''
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

              {settled && result?.betOn === 'banker' && <span className="bac-seat__bet">your bet</span>}
            </div>
          </div>

          <p className="bac-table__note">
            {dealing
              ? 'Dealing…'
              : settled && result?.natural
                ? 'Natural 8 or 9 — both sides stand'
                : settled && result
                  ? `Player ${result.playerTotal} · Banker ${result.bankerTotal}`
                  : `Player ${config.payouts.player}× · Banker ${config.payouts.banker}× · Tie ${config.payouts.tie}×`}
          </p>
        </div>

        <GameResultOverlay
          isOpen={showWin}
          isWin={result?.outcome === 'won'}
          amount={result?.payout ?? 0}
          multiplier={result?.multiplier ?? 0}
          detail={
            result?.outcome === 'won'
              ? `You backed ${result.betOn.toUpperCase()} · paid ${result.multiplier}× your bet`
              : undefined
          }
          onClose={() => setShowWin(false)}
        />

        {error && <p className="error">{error}</p>}
      </section>
    </GameShell>
  );
}
