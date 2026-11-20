import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { GameShell } from '../components/GameShell';
import { GameResultOverlay } from '../components/GameResultOverlay';
import { api, getApiErrorMessage } from '../api/client';
import type { BalanceResponse, BoxingKingConfig, BoxingKingResult } from '../api/types';
import { playSound } from '../utils/sound';

const DEFAULT_BET = 5;
const SPIN_MS = 1500;
const STAGGER_MS = 110;
const STRIP_LENGTH = 4;
const SPARKS = 18;
const SPARK_MS = 1400;

const FALLBACK_SYMBOLS = ['🥊', '🏆', '🤴', '💪', '💥', '🩳'];

const FALLBACK_CONFIG: BoxingKingConfig = {
  symbols: FALLBACK_SYMBOLS,
  cells: 9,
  outcomes: 6 ** 9,
  minCluster: 3,
  pays: { small: 2, medium: 8.5, large: 30 },
  frequency: { small: 0.380295, medium: 0.023354, large: 0.000504 },
  hitRate: 0.378676,
  rtp: 0.974219,
  houseEdge: 0.025781,
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function randomGrid(symbols: readonly string[]): string[] {
  return Array.from({ length: 9 }, () => symbols[Math.floor(Math.random() * symbols.length)]);
}

function randomStrip(symbols: readonly string[]): string[] {
  return Array.from(
    { length: STRIP_LENGTH },
    () => symbols[Math.floor(Math.random() * symbols.length)],
  );
}

function randomRollSpeeds(): number[] {
  return Array.from({ length: 9 }, () => Math.round(260 + Math.random() * 100));
}

function randomSparks(): CSSProperties[] {
  return Array.from({ length: SPARKS }, () => {
    const angle = Math.random() * Math.PI * 2;
    const distance = 70 + Math.random() * 120;

    return {
      '--spark-x': `${Math.cos(angle) * distance}px`,
      '--spark-y': `${Math.sin(angle) * distance}px`,
      '--spark-delay': `${Math.random() * 0.15}s`,
      '--spark-size': `${4 + Math.random() * 6}px`,
    } as CSSProperties;
  });
}

async function fetchBalance(): Promise<number> {
  const { data } = await api.get<BalanceResponse>('/wallet/balance');
  return data.balance;
}

async function fetchConfig(): Promise<BoxingKingConfig> {
  const { data } = await api.get<BoxingKingConfig>('/game/boxing_king/config');
  return data;
}

export default function BoxingKing() {
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);

  const [amount, setAmount] = useState(String(DEFAULT_BET));
  const [config, setConfig] = useState<BoxingKingConfig>(FALLBACK_CONFIG);

  const [grid, setGrid] = useState<string[]>(() => randomGrid(FALLBACK_SYMBOLS));
  const [strips, setStrips] = useState<string[][]>(() =>
    Array.from({ length: 9 }, () => randomStrip(FALLBACK_SYMBOLS)),
  );
  const [rollSpeeds, setRollSpeeds] = useState<number[]>(randomRollSpeeds);
  const [settled, setSettled] = useState<boolean[]>(() => Array(9).fill(true));

  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<BoxingKingResult | null>(null);
  const [showWin, setShowWin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sparks, setSparks] = useState<CSSProperties[] | null>(null);
  const [isCurtainOpen, setIsCurtainOpen] = useState(false);

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
        if (cancelled) return;

        setConfig(next);
        setGrid(randomGrid(next.symbols));
        setStrips(Array.from({ length: 9 }, () => randomStrip(next.symbols)));
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
  const winningCells = new Set(result?.winningCells ?? []);

  async function fight(): Promise<void> {
    if (spinning) return;

    if (validStake <= 0) {
      setError('Enter a bet amount greater than 0.');
      return;
    }

    setSpinning(true);
    setError(null);
    setResult(null);
    setShowWin(false);
    setSparks(null);
    setIsCurtainOpen(true);
    playSound('punch');
    playSound('spin', { durationMs: SPIN_MS + STAGGER_MS * 9 });

    const startedAt = performance.now();
    setSettled(Array(9).fill(false));
    setStrips(Array.from({ length: 9 }, () => randomStrip(config.symbols)));
    setRollSpeeds(randomRollSpeeds());

    try {
      const { data } = await api.post<BoxingKingResult>('/game/boxing_king/play', {
        betAmount: validStake,
      });

      setBalance(data.balanceAfter);

      await delay(Math.max(0, SPIN_MS - (performance.now() - startedAt)));
      if (unmounted.current) return;

      for (let cell = 0; cell < 9; cell += 1) {
        if (unmounted.current) return;

        const symbol = data.grid[cell]!;
        setGrid((previous) => {
          const next = [...previous];
          next[cell] = symbol;
          return next;
        });
        setSettled((previous) => {
          const next = [...previous];
          next[cell] = true;
          return next;
        });

        playSound('punch', { volume: 0.45 + cell * 0.04, pitch: 1.05 - cell * 0.02 });

        if (cell < 8) await delay(STAGGER_MS);
      }

      if (unmounted.current) return;

      setResult(data);
      setShowWin(data.payout > 0);

      if (data.payout > 0) {
        playSound('punch', { volume: 1, pitch: 0.76 });
        window.setTimeout(() => playSound('win'), 140);
      } else {
        playSound('lose');
      }

      if (data.biggestCluster >= 5) {
        setSparks(randomSparks());
        window.setTimeout(() => {
          if (!unmounted.current) setSparks(null);
        }, SPARK_MS);
      }
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'The round could not be completed.'));
      setSettled(Array(9).fill(true));
      void refreshBalance();
    } finally {
      if (!unmounted.current) setSpinning(false);
    }
  }

  return (
    <GameShell
      balance={balance}
      balanceError={balanceError}
      onBack={() => window.history.back()}
      betAmount={validStake}
      setBetAmount={(amount: number) => setAmount(String(amount))}
      onSpin={() => void fight()}
      spinLabel="FIGHT"
      isSpinning={spinning}
    >
      <section className="rt__stage bk__stage">
        {error && <p className="error">{error}</p>}
        <div className="bk-ring">
          <div className="bk-ring__ropes" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <span className="bk-ring__post bk-ring__post--tl" aria-hidden="true" />
          <span className="bk-ring__post bk-ring__post--tr" aria-hidden="true" />
          <span className="bk-ring__post bk-ring__post--bl" aria-hidden="true" />
          <span className="bk-ring__post bk-ring__post--br" aria-hidden="true" />

          <div className="bk-mat">
            <div className="bk-fire-border" aria-hidden="true" />

            <div className="bk-grid" role="img" aria-label={`Board: ${grid.join(' ')}`}>
              {grid.map((symbol, cell) => {
                const isSettled = settled[cell];
                const punching = isSettled && winningCells.has(cell);

                return (
                  <div
                    key={cell}
                    className={`bk-cell${punching ? ' bk-cell--win' : ''}${
                      isSettled ? '' : ' bk-cell--rolling'
                    }`}
                  >
                    {isSettled ? (
                      <span className="bk-cell__symbol">{symbol}</span>
                    ) : (
                      <span
                        className="bk-strip bk-reel--spinning"
                        style={{ animationDuration: `${rollSpeeds[cell] ?? 300}ms` }}
                        aria-hidden="true"
                      >
                        {[...strips[cell]!, strips[cell]![0]!].map((face, index) => (
                          <span key={index} className="bk-strip__face">
                            {face}
                          </span>
                        ))}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="bk-curtains" aria-hidden="true">
              <div
                className={`bk-curtain bk-curtain--left${isCurtainOpen ? ' bk-curtain--open' : ''}`}
              />
              <div
                className={`bk-curtain bk-curtain--right${isCurtainOpen ? ' bk-curtain--open' : ''}`}
              />
            </div>

            {sparks && (
              <div className="bk-sparks" aria-hidden="true">
                {sparks.map((style, index) => (
                  <span key={index} style={style} />
                ))}
              </div>
            )}
          </div>
        </div>

        <p className="bk-result" role="status" aria-live="polite">
          {spinning
            ? 'Fighting…'
            : `${config.pays.small}× for 3–4 · ${config.pays.medium}× for 5–6 · ${config.pays.large}× for 7+`}
        </p>

        {result && (
          <GameResultOverlay
            isOpen={showWin}
            isWin={result.won}
            amount={result.payout}
            multiplier={result.multiplier}
            detail={`${result.clusters.length} cluster${result.clusters.length > 1 ? 's' : ''} · best ${result.biggestCluster}`}
            onClose={() => setShowWin(false)}
          />
        )}
      </section>
    </GameShell>
  );
}
