import { useCallback, useEffect, useRef, useState } from 'react';

import { api, getApiErrorMessage } from '../api/client';
import type {
  BalanceResponse,
  DragonTigerBet,
  DragonTigerConfig,
  DragonTigerResult,
} from '../api/types';
import { GameShell } from '../components/GameShell';
import { GameResultOverlay } from '../components/GameResultOverlay';
import { useGameMusic } from '../hooks/useGameMusic';
import { playSound } from '../utils/sound';

const DEFAULT_BET = 10;
const CARD_MS = 380;

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

function parseCard(code: string): { rank: string; suit: string; red: boolean } {
  const rank = code.slice(0, -1);
  const suit = code.slice(-1);
  return { rank: rank === 'T' ? '10' : rank, suit: SUIT_SYMBOL[suit] ?? '?', red: suit === 'H' || suit === 'D' };
}

async function fetchBalance(): Promise<number> {
  const { data } = await api.get<BalanceResponse>('/wallet/balance');
  return data.balance;
}

async function fetchConfig(): Promise<DragonTigerConfig> {
  const { data } = await api.get<DragonTigerConfig>('/game/dragontiger/config');
  return data;
}

function CardView({ code, enter }: { code: string; enter: boolean }) {
  const card = parseCard(code);
  return (
    <div className={`dt-card${card.red ? ' dt-card--red' : ''}${enter ? ' dt-card--enter' : ''}`} aria-label={`${card.rank} of ${card.suit}`}>
      <span className="dt-card__rank">{card.rank}</span>
      <span className="dt-card__suit">{card.suit}</span>
    </div>
  );
}

function CardBack({ label }: { label: string }) {
  return <div className="dt-card dt-card--back" aria-label={`${label} card face down`} />;
}

export default function DragonTiger() {
  useGameMusic('/audio/cards-bgm.mp3', 0.4);

  const [balance, setBalance] = useState<number | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [amount, setAmount] = useState(String(DEFAULT_BET));
  const [config, setConfig] = useState<DragonTigerConfig>(FALLBACK_CONFIG);
  const [betOn, setBetOn] = useState<DragonTigerBet>('dragon');
  const [result, setResult] = useState<DragonTigerResult | null>(null);
  const [revealed, setRevealed] = useState(0);
  const [dealing, setDealing] = useState(false);
  const [showWin, setShowWin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dealTimer = useRef<number | null>(null);

  const stopDeal = useCallback(() => {
    if (dealTimer.current !== null) { window.clearInterval(dealTimer.current); dealTimer.current = null; }
  }, []);
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
  const settled = result !== null && revealed >= 2;
  const dragonUp = revealed >= 1;
  const tigerUp = revealed >= 2;

  async function bet(side: DragonTigerBet) {
    if (dealing) return;
    if (validStake <= 0) { setError('Enter a bet amount greater than 0.'); return; }
    setDealing(true); setError(null); setShowWin(false); playSound('click');
    try {
      const { data } = await api.post<DragonTigerResult>('/game/dragontiger/play', { betAmount: validStake, betOn: side });
      setBalance(data.balanceAfter);
      setResult(data);
      setRevealed(0);
      await new Promise<void>((resolve) => {
        let shown = 0;
        dealTimer.current = window.setInterval(() => {
          shown += 1; setRevealed(shown); playSound('click');
          if (shown >= 2) { stopDeal(); resolve(); }
        }, CARD_MS);
      });
      playSound(data.outcome === 'won' ? 'win' : 'lose');
      if (data.outcome === 'won') setShowWin(true);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'The hand could not be dealt.'));
      void refreshBalance();
    } finally { setDealing(false); }
  }

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
          {(['dragon', 'tie', 'tiger'] as const).map((side) => (
            <button key={side} type="button" className={`chip${betOn === side ? ' chip--active' : ''}`} onClick={() => { playSound('click'); setBetOn(side); }} disabled={dealing} aria-pressed={betOn === side}>
              {side.toUpperCase()}
            </button>
          ))}
        </div>
      }
    >
      <section className="rt__stage">
        <div className={`dt-table${dealing ? ' dt-table--dealing' : ''}`}>
          <p className="dt-table__rule">Highest card wins · a tie loses Dragon &amp; Tiger · {config.decks}-deck shoe</p>
          <div className="dt-table__seats">
            <div className={`dt-seat dt-seat--dragon${settled && result?.winner === 'dragon' ? ' dt-seat--winner' : ''}${settled && result?.winner === 'tie' ? ' dt-seat--tie' : ''}`}>
              <span className="dt-seat__label">Dragon <strong className="dt-seat__rank">{settled && result ? result.dragonRank : dragonUp ? '…' : '–'}</strong></span>
              {dragonUp && result ? <CardView code={result.dragonCard} enter /> : <CardBack label="Dragon" />}
              {settled && result?.betOn === 'dragon' && <span className="dt-seat__bet">your bet</span>}
            </div>
            <div className="dt-table__vs" aria-hidden="true">VS</div>
            <div className={`dt-seat dt-seat--tiger${settled && result?.winner === 'tiger' ? ' dt-seat--winner' : ''}${settled && result?.winner === 'tie' ? ' dt-seat--tie' : ''}`}>
              <span className="dt-seat__label">Tiger <strong className="dt-seat__rank">{settled && result ? result.tigerRank : tigerUp ? '…' : '–'}</strong></span>
              {tigerUp && result ? <CardView code={result.tigerCard} enter /> : <CardBack label="Tiger" />}
              {settled && result?.betOn === 'tiger' && <span className="dt-seat__bet">your bet</span>}
            </div>
          </div>
          <p className="dt-table__note">
            {dealing ? 'Dealing…' : settled && result ? (result.winner === 'tie' ? `Both drew rank ${result.dragonRank} — tie` : `${result.winner === 'dragon' ? 'Dragon' : 'Tiger'} ${Math.max(result.dragonRank, result.tigerRank)} beats ${Math.min(result.dragonRank, result.tigerRank)}`) : 'Place a bet to be dealt in'}
          </p>
        </div>
        <GameResultOverlay
          isOpen={showWin}
          isWin={result?.outcome === 'won'}
          amount={result?.payout ?? 0}
          multiplier={result?.multiplier ?? 0}
          detail={result?.outcome === 'won' ? `You backed ${result.betOn.toUpperCase()} · paid ${result.multiplier}× your bet` : undefined}
          onClose={() => setShowWin(false)}
        />
        {error && <p className="error">{error}</p>}
      </section>
    </GameShell>
  );
}
