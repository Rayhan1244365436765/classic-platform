import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';

import { api, getApiErrorMessage } from '../api/client';
import type { BalanceResponse, Dice3dConfig, Dice3dResult } from '../api/types';
import { ArrowLeftIcon, WalletIcon } from '../components/Icons';
import { LivePlayerBadge } from '../components/LivePlayerBadge';
import { SoundToggle } from '../components/SoundToggle';
import { GameBottomBar } from '../components/GameBottomBar';
import { GameResultOverlay } from '../components/GameResultOverlay';
import { playSound } from '../utils/sound';

/**
 * 3D Dice — three tumbling dice, one bet on their total.
 *
 * The dice are real CSS cubes (`transform-style: preserve-3d`, six pip faces).
 * Each die tumbles around *its own settled orientation* (`var(--die-settle)` is
 * prepended to every tumble keyframe), so the roll starts and ends in the exact
 * pose the die is about to land in — there is no orientation snap when the
 * animation hands over to the landing bounce.
 *
 * The server settles the roll; this page only replays it: 2 s of tumbling, then
 * the three dice land one after another, 160 ms apart.
 */

const DEFAULT_BET = 5;
/** How long all three dice tumble before the first one lands. */
const ROLL_MS = 2000;
/** Length of the landing bounce. */
const LAND_MS = 620;
/** Gap between the dice hitting the felt. */
const LAND_STAGGER_MS = 160;

type FaceName = 'front' | 'back' | 'right' | 'left' | 'top' | 'bottom';

/** Opposite faces sum to seven, like a real die. */
const DIE_FACES: ReadonlyArray<{ name: FaceName; value: number }> = [
  { name: 'front', value: 1 },
  { name: 'back', value: 6 },
  { name: 'right', value: 3 },
  { name: 'left', value: 4 },
  { name: 'top', value: 2 },
  { name: 'bottom', value: 5 },
];

/** Which of the nine pip slots are lit for each face value. */
const PIP_SLOTS: Readonly<Record<number, readonly number[]>> = {
  1: [5],
  2: [1, 9],
  3: [1, 5, 9],
  4: [1, 3, 7, 9],
  5: [1, 3, 5, 7, 9],
  6: [1, 3, 4, 6, 7, 9],
};

/** Rotation that turns a given face towards the camera. */
const SETTLE_ROTATION: Readonly<Record<number, string>> = {
  1: 'rotateX(0deg) rotateY(0deg)',
  2: 'rotateX(-90deg) rotateY(0deg)',
  3: 'rotateX(0deg) rotateY(-90deg)',
  4: 'rotateX(0deg) rotateY(90deg)',
  5: 'rotateX(90deg) rotateY(0deg)',
  6: 'rotateX(0deg) rotateY(-180deg)',
};

const FALLBACK_CONFIG: Dice3dConfig = {
  dice: 3,
  faces: 6,
  outcomes: 216,
  triplesLoseHighLow: true,
  high: { from: 11, to: 18, pay: 2, chance: 105 / 216, rtp: 35 / 36 },
  low: { from: 3, to: 10, pay: 2, chance: 105 / 216, rtp: 35 / 36 },
  sums: [
    { sum: 3, combos: 1, pay: 210, chance: 1 / 216, rtp: 35 / 36 },
    { sum: 4, combos: 3, pay: 70, chance: 3 / 216, rtp: 35 / 36 },
    { sum: 5, combos: 6, pay: 35, chance: 6 / 216, rtp: 35 / 36 },
    { sum: 6, combos: 10, pay: 21, chance: 10 / 216, rtp: 35 / 36 },
    { sum: 7, combos: 15, pay: 14, chance: 15 / 216, rtp: 35 / 36 },
    { sum: 8, combos: 21, pay: 10, chance: 21 / 216, rtp: 35 / 36 },
    { sum: 9, combos: 25, pay: 8.4, chance: 25 / 216, rtp: 35 / 36 },
    { sum: 10, combos: 27, pay: 7.8, chance: 27 / 216, rtp: 0.975 },
    { sum: 11, combos: 27, pay: 7.8, chance: 27 / 216, rtp: 0.975 },
    { sum: 12, combos: 25, pay: 8.4, chance: 25 / 216, rtp: 35 / 36 },
    { sum: 13, combos: 21, pay: 10, chance: 21 / 216, rtp: 35 / 36 },
    { sum: 14, combos: 15, pay: 14, chance: 15 / 216, rtp: 35 / 36 },
    { sum: 15, combos: 10, pay: 21, chance: 10 / 216, rtp: 35 / 36 },
    { sum: 16, combos: 6, pay: 35, chance: 6 / 216, rtp: 35 / 36 },
    { sum: 17, combos: 3, pay: 70, chance: 3 / 216, rtp: 35 / 36 },
    { sum: 18, combos: 1, pay: 210, chance: 1 / 216, rtp: 35 / 36 },
  ],
};

type BetChoice = 'high' | 'low' | number;
type DiePhase = 'idle' | 'rolling' | 'landed';

function money(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  const digits = rounded % 1 === 0 ? 0 : 2;

  return `$${rounded.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: 2,
  })}`;
}

function multiplierLabel(value: number): string {
  return `${Math.round(value * 100) / 100}×`;
}

function betLabel(bet: BetChoice): string {
  if (bet === 'high') return 'HIGH';
  if (bet === 'low') return 'LOW';

  return `TOTAL ${bet}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

/** One tumble speed per die, so the three never spin in lockstep. */
function randomRollSpeeds(): number[] {
  return Array.from({ length: 3 }, () => Math.round(620 + Math.random() * 220));
}

async function fetchBalance(): Promise<number> {
  const { data } = await api.get<BalanceResponse>('/wallet/balance');
  return data.balance;
}

async function fetchConfig(): Promise<Dice3dConfig> {
  const { data } = await api.get<Dice3dConfig>('/game/dice3d/config');
  return data;
}

/** One-line explanation of how a settled roll paid (or didn't). */
function resultText(result: Dice3dResult): string {
  const faces = result.dice.join(' · ');
  const call = result.betSum === null ? result.betType.toUpperCase() : `TOTAL ${result.betSum}`;

  if (result.won) {
    return `${faces} = ${result.sum} — ${call} wins ${multiplierLabel(result.multiplier)}`;
  }

  if (result.tripleVoided) {
    return `${faces} — a triple always loses high and low`;
  }

  return `${faces} = ${result.sum} — ${call} loses`;
}

/** A single CSS cube: six pip faces, tumbling around its settled pose. */
function Die({
  face,
  phase,
  delayMs,
  rollMs,
}: {
  face: number;
  phase: DiePhase;
  delayMs: number;
  rollMs: number;
}) {
  const style = {
    '--die-settle': SETTLE_ROTATION[face],
    '--die-delay': `${delayMs}ms`,
    '--die-roll': `${rollMs}ms`,
  } as CSSProperties;

  return (
    <div
      className={`d3d-die d3d-die--${phase}`}
      style={style}
      role="img"
      aria-label={`Die showing ${face}`}
    >
      {DIE_FACES.map(({ name, value }) => (
        <div key={name} className={`d3d-die__face d3d-die__face--${name}`} data-value={value}>
          {Array.from({ length: 9 }, (_, slot) => (
            <span
              key={slot}
              className={`d3d-pip${PIP_SLOTS[value]!.includes(slot + 1) ? '' : ' d3d-pip--off'}`}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export default function Dice3D() {
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);

  const [amount, setAmount] = useState(String(DEFAULT_BET));
  const [config, setConfig] = useState<Dice3dConfig>(FALLBACK_CONFIG);
  const [bet, setBet] = useState<BetChoice>('high');

  const [dice, setDice] = useState<number[]>([1, 5, 3]);
  const [phase, setPhase] = useState<DiePhase>('idle');
  const [rollSpeeds, setRollSpeeds] = useState<number[]>(randomRollSpeeds);

  const [rolling, setRolling] = useState(false);
  const [result, setResult] = useState<Dice3dResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [showWin, setShowWin] = useState(false);

  const unmounted = useRef(false);

  useEffect(() => {
    unmounted.current = false;
    return () => {
      unmounted.current = true;
    };
  }, []);

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
        // Keep FALLBACK_CONFIG — the table still works with the mirrored odds.
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
  const total = dice[0]! + dice[1]! + dice[2]!;
  const pays =
    bet === 'high'
      ? config.high.pay
      : bet === 'low'
        ? config.low.pay
        : (config.sums.find((entry) => entry.sum === bet)?.pay ?? 0);

  function choose(next: BetChoice): void {
    if (rolling) return;

    playSound('click');
    setBet(next);
    setResult(null);
  }

  /** Tumble for 2 s, land the dice one by one, then settle the round. */
  async function roll(): Promise<void> {
    if (rolling) return;

    if (validStake <= 0) {
      setError('Enter a bet amount greater than 0.');
      return;
    }

    setRolling(true);
    setError(null);
    setResult(null);
    setShowWin(false);
    setPhase('rolling');
    setRollSpeeds(randomRollSpeeds());
    playSound('click');
    playSound('spin', { durationMs: ROLL_MS });

    const startedAt = performance.now();

    try {
      const { data } = await api.post<Dice3dResult>('/game/dice3d/play', {
        betAmount: validStake,
        betType: bet,
      });

      setBalance(data.balanceAfter);

      // Keep tumbling until the throw has had its ~2 s.
      await delay(Math.max(0, ROLL_MS - (performance.now() - startedAt)));
      if (unmounted.current) return;

      // Reveal the faces: each die bounces down onto its settled pose.
      setDice(data.dice);
      setPhase('landed');

      await delay(LAND_MS + LAND_STAGGER_MS * 2 + 60);
      if (unmounted.current) return;

      setPhase('idle');
      setResult(data);
      playSound(data.payout > 0 ? 'win' : 'lose');

      if (data.payout > 0) setShowWin(true);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'The roll could not be completed.'));
      setPhase('idle');
      void refreshBalance();
    } finally {
      if (!unmounted.current) setRolling(false);
    }
  }

  return (
    <div className="phone-stage">
      <div className="phone-frame">
        <div className="rt rt--d3d">
      <header className="rt__topbar">
        <Link to="/" className="rt__back">
          <ArrowLeftIcon className="icon icon--sm" />
          Back to Lobby
        </Link>

        <h1 className="rt__title">3D Dice 🎲</h1>

        <SoundToggle />

        <LivePlayerBadge baseCount={3700} />

        <span
          className={`balance-pill${balanceError ? ' balance-pill--error' : ''}`}
          title={balanceError ?? 'Current balance'}
        >
          <WalletIcon className="icon icon--sm" />
          {balanceLabel}
        </span>
      </header>

      <main className="rt__body">
        <section className="rt__stage d3d__stage">
          <div className="d3d-table">
            <span className="d3d-table__mark d3d-table__mark--low">LOW · 3–10</span>
            <span className="d3d-table__mark d3d-table__mark--high">HIGH · 11–18</span>

            <div className="d3d-dice">
              {dice.map((face, index) => (
                <Die
                  key={index}
                  face={face}
                  phase={phase}
                  delayMs={index * LAND_STAGGER_MS}
                  rollMs={rollSpeeds[index] ?? 700}
                />
              ))}
            </div>

            <div className={`d3d-total${phase === 'rolling' ? ' d3d-total--rolling' : ''}`}>
              <span className="d3d-total__label">Total</span>
              <span className="d3d-total__value">{phase === 'rolling' ? '–' : total}</span>
            </div>
          </div>

          <p className="d3d-result" role="status" aria-live="polite">
            {phase === 'rolling'
              ? `Rolling… ${betLabel(bet)} at ${multiplierLabel(pays)}`
              : `${betLabel(bet)} pays ${multiplierLabel(pays)} · triples lose high/low`}
          </p>

          <div className="d3d-bets">
            <button
              type="button"
              className={`d3d-bet${bet === 'low' ? ' d3d-bet--active' : ''}`}
              onClick={() => choose('low')}
              disabled={rolling}
              aria-pressed={bet === 'low'}
            >
              <span className="d3d-bet__title">BET LOW</span>
              <span className="d3d-bet__sub">3–10 · {multiplierLabel(config.low.pay)}</span>
            </button>

            <button
              type="button"
              className={`d3d-bet${bet === 'high' ? ' d3d-bet--active' : ''}`}
              onClick={() => choose('high')}
              disabled={rolling}
              aria-pressed={bet === 'high'}
            >
              <span className="d3d-bet__title">BET HIGH</span>
              <span className="d3d-bet__sub">11–18 · {multiplierLabel(config.high.pay)}</span>
            </button>
          </div>

          <label className="d3d-select">
            <span>Exact total</span>
            <select
              value={typeof bet === 'number' ? String(bet) : ''}
              onChange={(event) => {
                const next = event.target.value;
                if (next !== '') choose(Number(next));
              }}
              disabled={rolling}
            >
              <option value="">Choose 3–18…</option>
              {config.sums.map((entry) => (
                <option key={entry.sum} value={entry.sum}>
                  {entry.sum} — pays {multiplierLabel(entry.pay)}
                </option>
              ))}
            </select>
          </label>

          {error && <p className="error">{error}</p>}
        </section>
      </main>

      <footer className="rt__dock">
        <GameBottomBar
          betAmount={validStake}
          onBetChange={(value) => setAmount(String(value))}
          onPlay={() => void roll()}
          playLabel="ROLL"
          isPlaying={rolling}
        />
      </footer>

      {result && (
        <GameResultOverlay
          isOpen={showWin}
          isWin={result.won}
          amount={result.payout}
          multiplier={result.multiplier}
          detail={result.won ? resultText(result) : undefined}
          onClose={() => setShowWin(false)}
        />
      )}
        </div>
      </div>
    </div>
  );
}
