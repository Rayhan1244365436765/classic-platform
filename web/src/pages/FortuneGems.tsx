import { useCallback, useEffect, useState } from 'react';

import { GameShell } from '../components/GameShell';
import { GameResultOverlay } from '../components/GameResultOverlay';
import { api, getApiErrorMessage } from '../api/client';
import type { BalanceResponse, FortuneGemsConfig, FortuneGemsResult } from '../api/types';
import { useGameMusic } from '../hooks/useGameMusic';
import { playSound } from '../utils/sound';

/**
 * Fortune Gems — a 4×3 cluster-pays slot.
 *
 *   row 0 → cells 0 1 2 3
 *   row 1 → cells 4 5 6 7
 *   row 2 → cells 8 9 10 11
 *
 * The server draws twelve independent symbols and pays every orthogonal group of
 * four or more (diagonals never connect). This page only animates the reveal,
 * then winning cells get a golden pulse and the result line lists the clusters.
 */

const DEFAULT_BET = 5;
const STAGGER_MS = 90;
const CELLS = 12;

const FALLBACK_SYMBOLS = ['🪙', '💰', '🧧', '🎋', '🏮', '👑', '💎', '8️⃣'];

/** Mirrors the backend constants so the page still renders if config fails. */
const FALLBACK_CONFIG: FortuneGemsConfig = {
  symbols: FALLBACK_SYMBOLS,
  cols: 4,
  rows: 3,
  cells: CELLS,
  outcomes: 8 ** 12,
  minCluster: 4,
  pays: { small: 11, medium: 26, large: 80, huge: 265 },
  briefPays: { small: 2, medium: 5, large: 15, huge: 50 },
  frequency: { small: 0.08049, medium: 0.003336, large: 0.00007, huge: 0.00000025 },
  hitRate: 0.083203,
  rtp: 0.97779,
  houseEdge: 0.02221,
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function randomGrid(symbols: readonly string[]): string[] {
  return Array.from({ length: CELLS }, () => symbols[Math.floor(Math.random() * symbols.length)]);
}

async function fetchBalance(): Promise<number> {
  const { data } = await api.get<BalanceResponse>('/wallet/balance');
  return data.balance;
}

async function fetchConfig(): Promise<FortuneGemsConfig> {
  const { data } = await api.get<FortuneGemsConfig>('/game/fortune_gems/config');
  return data;
}

export default function FortuneGems() {
  useGameMusic('/audio/lucky-slots.mp3', 0.4);

  const [balance, setBalance] = useState<number | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);

  const [amount, setAmount] = useState(String(DEFAULT_BET));
  const [config, setConfig] = useState<FortuneGemsConfig>(FALLBACK_CONFIG);

  // `null` = that cell is still rolling in.
  const [cells, setCells] = useState<(string | null)[]>(() => randomGrid(FALLBACK_SYMBOLS));
  const [winningCells, setWinningCells] = useState<number[]>([]);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<FortuneGemsResult | null>(null);
  const [showWin, setShowWin] = useState(false);
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

    async function loadBalance() {
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

    async function loadConfig() {
      try {
        const next = await fetchConfig();
        if (!cancelled && next.symbols.length > 0) {
          setConfig(next);
          setCells(randomGrid(next.symbols));
        }
      } catch {
        // Keep FALLBACK_CONFIG
      }
    }

    void loadBalance();
    void loadConfig();

    return () => {
      cancelled = true;
    };
  }, []);

  const stake = Number(amount);
  const validStake = Number.isFinite(stake) && stake > 0 ? Math.round(stake * 100) / 100 : 0;

  async function spin(): Promise<void> {
    if (spinning) return;

    if (validStake <= 0) {
      setError('Enter a bet amount greater than 0.');
      return;
    }

    setSpinning(true);
    setError(null);
    setResult(null);
    setShowWin(false);
    setWinningCells([]);
    setCells(Array(CELLS).fill(null));
    playSound('spin');

    try {
      const { data } = await api.post<FortuneGemsResult>('/game/fortune_gems/play', {
        betAmount: validStake,
      });

      for (let cell = 0; cell < CELLS; cell += 1) {
        const symbol = data.grid[cell] ?? '💎';
        setCells((previous) => {
          const next = [...previous];
          next[cell] = symbol;
          return next;
        });
        if (cell < CELLS - 1) await delay(STAGGER_MS);
      }

      setWinningCells(data.winningCells);
      setResult(data);
      if (data.won) setShowWin(true);
      setBalance(data.balanceAfter);
      playSound(data.won ? 'win' : 'lose');
      void refreshBalance();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'The spin could not be placed.'));
      setCells(randomGrid(config.symbols));
      void refreshBalance();
    } finally {
      setSpinning(false);
    }
  }

  const idleText = `Cluster ${config.minCluster}+ pays ${config.pays.small}×–${config.pays.huge}× · ${Math.round(config.rtp * 100)}% RTP`;

  return (
    <GameShell
      balance={balance}
      balanceError={balanceError}
      betAmount={validStake}
      setBetAmount={(value) => setAmount(String(value))}
      onSpin={() => void spin()}
      spinLabel="SPIN"
      isSpinning={spinning}
    >
      <section className="rt__stage fg__stage">
        {error && <p className="error">{error}</p>}

        <div className="fg-cabinet">
          <div
            className="fg-grid"
            role="img"
            aria-label={
              result && !spinning
                ? `Board: ${result.grid.join(' ')}`
                : spinning
                  ? 'Reels spinning'
                  : 'Ready to spin'
            }
          >
            {Array.from({ length: CELLS }, (_, cell) => {
              const symbol = cells[cell];
              const rolling = symbol === null;
              const isWin = winningCells.includes(cell);

              return (
                <div
                  key={cell}
                  className={`fg-cell${rolling ? ' fg-cell--rolling' : ''}${isWin ? ' fg-cell--win' : ''}`}
                >
                  {rolling ? (
                    <span className="fg-cell__glyph" aria-hidden="true">✦</span>
                  ) : (
                    <span className="fg-cell__symbol">{symbol}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <p className="fg-result" role="status" aria-live="polite">
          {spinning ? 'Spinning…' : idleText}
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

        <p className="rt__fair">Provably fair · seed hash published before every spin</p>
      </section>
    </GameShell>
  );
}