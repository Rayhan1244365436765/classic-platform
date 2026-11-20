import { useCallback, useEffect, useRef, useState } from 'react';

import { api, getApiErrorMessage } from '../api/client';
import type { BalanceResponse, TeenPattiConfig, TeenPattiResult } from '../api/types';
import { GameShell } from '../components/GameShell';
import { GameResultOverlay } from '../components/GameResultOverlay';
import { playSound } from '../utils/sound';

const DEFAULT_BET = 10;
const CARD_MS = 260;
const HAND_SIZE = 3;

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
    tieRate: 0.0011, winRate: 0.4994, loseRate: 0.4994, rtp: 0.975, houseEdge: 0.025,
    rtpWithoutRake: 1, hands: 22100, orderedPairs: 407170400, tiePairs: 450528,
    frequencies: { trail: 0.0024, pureSequence: 0.0022, sequence: 0.0326, colour: 0.0496, pair: 0.1694, high: 0.7439 },
  },
};

const SUIT_SYMBOL: Record<string, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };
type DealStep = { side: 'player' | 'dealer'; index: number };

function parseCard(code: string): { rank: string; suit: string; red: boolean } {
  const rank = code.slice(0, -1);
  const suit = code.slice(-1);
  return { rank: rank === 'T' ? '10' : rank, suit: SUIT_SYMBOL[suit] ?? '?', red: suit === 'H' || suit === 'D' };
}

function buildDealSequence(): DealStep[] {
  const sequence: DealStep[] = [];
  for (let index = 0; index < HAND_SIZE; index += 1) {
    sequence.push({ side: 'player', index });
    sequence.push({ side: 'dealer', index });
  }
  return sequence;
}

async function fetchBalance(): Promise<number> { const { data } = await api.get<BalanceResponse>('/wallet/balance'); return data.balance; }
async function fetchConfig(): Promise<TeenPattiConfig> { const { data } = await api.get<TeenPattiConfig>('/game/teenpatti/config'); return data; }

function CardView({ code, enter }: { code: string; enter: boolean }) {
  const card = parseCard(code);
  return (
    <div className={`tp-card${card.red ? ' tp-card--red' : ''}${enter ? ' tp-card--enter' : ''}`} aria-label={`${card.rank} of ${card.suit}`}>
      <span className="tp-card__rank">{card.rank}</span>
      <span className="tp-card__suit">{card.suit}</span>
    </div>
  );
}
function CardBack({ label }: { label: string }) { return <div className="tp-card tp-card--back" aria-label={`${label} card face down`} />; }

export default function TeenPatti() {
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [amount, setAmount] = useState(String(DEFAULT_BET));
  const [config, setConfig] = useState<TeenPattiConfig>(FALLBACK_CONFIG);
  void config; // kept in sync with server config for future UI use
  const [result, setResult] = useState<TeenPattiResult | null>(null);
  const [revealed, setRevealed] = useState(0);
  const [dealing, setDealing] = useState(false);
  const [showWin, setShowWin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dealTimer = useRef<number | null>(null);

  const stopDeal = useCallback(() => { if (dealTimer.current !== null) { window.clearInterval(dealTimer.current); dealTimer.current = null; } }, []);
  useEffect(() => stopDeal, [stopDeal]);

  const refreshBalance = useCallback(async () => {
    try { setBalance(await fetchBalance()); setBalanceError(null); }
    catch (requestError) { setBalanceError(getApiErrorMessage(requestError, 'Could not load your balance.')); }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try { const value = await fetchBalance(); if (!cancelled) setBalance(value); }
      catch (requestError) { if (!cancelled) setBalanceError(getApiErrorMessage(requestError, 'Could not load your balance.')); }
      try { const next = await fetchConfig(); if (!cancelled) setConfig(next); } catch { /* fallback */ }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  const stake = Number(amount);
  const validStake = Number.isFinite(stake) && stake > 0 ? Math.round(stake * 100) / 100 : 0;
  const sequence = buildDealSequence();
  const settled = result !== null && revealed >= sequence.length;
  const visibleSteps = sequence.slice(0, revealed);
  const isVisible = (side: 'player' | 'dealer', index: number): boolean => visibleSteps.some((step) => step.side === side && step.index === index);
  const justLanded = (side: 'player' | 'dealer', index: number): boolean => { const last = sequence[revealed - 1]; return last !== undefined && last.side === side && last.index === index; };

  async function play() {
    if (dealing) return;
    if (validStake <= 0) { setError('Enter a bet amount greater than 0.'); return; }
    setDealing(true); setError(null); setShowWin(false); playSound('click');
    try {
      const { data } = await api.post<TeenPattiResult>('/game/teenpatti/play', { betAmount: validStake });
      setBalance(data.balanceAfter);
      setResult(data);
      setRevealed(0);
      await new Promise<void>((resolve) => {
        let shown = 0;
        dealTimer.current = window.setInterval(() => {
          shown += 1; setRevealed(shown); playSound('click');
          if (shown >= sequence.length) { stopDeal(); resolve(); }
        }, CARD_MS);
      });
      if (data.outcome === 'won') { playSound('win'); setShowWin(true); } else if (data.outcome === 'lost') playSound('lose');
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'The hand could not be dealt.'));
      void refreshBalance();
    } finally { setDealing(false); }
  }

  const cardsFor = (side: 'player' | 'dealer') => (result ? (side === 'player' ? result.playerHand : result.dealerHand) : []);

  return (
    <GameShell balance={balance} balanceError={balanceError} betAmount={validStake} setBetAmount={(value) => setAmount(String(value))} onSpin={() => void play()} spinLabel={dealing ? 'DEALING…' : 'PLAY'} isSpinning={dealing}>
      <section className="rt__stage">
        <div className={`tp-table${dealing ? ' tp-table--dealing' : ''}`}>
          <p className="tp-table__rule">Trail &gt; Pure Sequence &gt; Sequence &gt; Colour &gt; Pair &gt; High Card · a tie refunds</p>
          <div className="tp-table__seats">
            <div className={`tp-seat tp-seat--player${settled && result?.winner === 'player' ? ' tp-seat--winner' : ''}${settled && result?.winner === 'tie' ? ' tp-seat--tie' : ''}`}>
              <span className="tp-seat__label">Player {settled && result && <em className="tp-seat__hand">{result.playerHandLabel}</em>}</span>
              <div className="tp-hand">
                {result ? cardsFor('player').map((code, index) => isVisible('player', index) ? <CardView key={`p-${index}`} code={code} enter={justLanded('player', index)} /> : <CardBack key={`p-${index}`} label="Player" />) : [0, 1, 2].map((slot) => <CardBack key={`p-slot-${slot}`} label="Player" />)}
              </div>
            </div>
            <div className="tp-table__vs" aria-hidden="true">VS</div>
            <div className={`tp-seat tp-seat--dealer${settled && result?.winner === 'dealer' ? ' tp-seat--winner' : ''}${settled && result?.winner === 'tie' ? ' tp-seat--tie' : ''}`}>
              <span className="tp-seat__label">Dealer {settled && result && <em className="tp-seat__hand">{result.dealerHandLabel}</em>}</span>
              <div className="tp-hand">
                {result ? cardsFor('dealer').map((code, index) => isVisible('dealer', index) ? <CardView key={`d-${index}`} code={code} enter={justLanded('dealer', index)} /> : <CardBack key={`d-${index}`} label="Dealer" />) : [0, 1, 2].map((slot) => <CardBack key={`d-slot-${slot}`} label="Dealer" />)}
              </div>
            </div>
          </div>
          <p className="tp-table__note">{dealing ? `Dealing… ${revealed}/${sequence.length}` : settled && result ? `${result.playerHandLabel} vs ${result.dealerHandLabel}` : 'Place a bet to be dealt in'}</p>
        </div>
        <GameResultOverlay
          isOpen={showWin}
          isWin={result?.outcome === 'won'}
          amount={result?.payout ?? 0}
          multiplier={result?.multiplier ?? 0}
          detail={result?.outcome === 'won' ? `Paid ${result.multiplier}× your bet` : undefined}
          onClose={() => setShowWin(false)}
        />
        {error && <p className="error">{error}</p>}
      </section>
    </GameShell>
  );
}
