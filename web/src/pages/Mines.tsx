import { useCallback, useEffect, useState } from 'react';
import { api, getApiErrorMessage } from '../api/client';
import type { BalanceResponse, MinesCashout, MinesReveal, MinesStart } from '../api/types';
import { GameShell } from '../components/GameShell';
import { GameResultOverlay } from '../components/GameResultOverlay';
import { playSound } from '../utils/sound';

/**
 * Mines — 5×5 board, server-held layout, provably-fair shuffle.
 *
 * The server never sends the layout before the game settles; this page only
 * renders what it is told (revealed indices, multiplier, and — once the game is
 * over — the mine positions so every bomb can be shown).
 */

const DEFAULT_BET = 10;
const GRID_SIZE = 25;
const MIN_MINES = 1;
const MAX_MINES = 24;
const MINE_PRESETS = [1, 3, 5, 10, 24];

type Status = 'idle' | 'active' | 'won' | 'lost';

/** Shape of GET /game/mines/current (the resumable board). */
type MinesCurrent = {
  game: {
    gameId: string;
    betAmount: number;
    minesCount: number;
    multiplier: number;
    revealedTiles: number[];
    safeTiles: number;
  } | null;
};

function money(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  const fractionDigits = rounded % 1 === 0 ? 0 : 2;

  return `$${rounded.toLocaleString('en-US', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: 2,
  })}`;
}

async function fetchBalance(): Promise<number> {
  const { data } = await api.get<BalanceResponse>('/wallet/balance');
  return data.balance;
}

export default function Mines() {
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);

  const [amount, setAmount] = useState(String(DEFAULT_BET));
  const [minesCount, setMinesCount] = useState(3);

  const [status, setStatus] = useState<Status>('idle');
  const [gameId, setGameId] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<number[]>([]);
  const [mines, setMines] = useState<number[]>([]);
  const [bombIndex, setBombIndex] = useState<number | null>(null);
  const [multiplier, setMultiplier] = useState(1);
  const [payout, setPayout] = useState(0);
  const [busy, setBusy] = useState(false);
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

    // Re-attach to a board that was left open (page reload, second tab, …).
    async function resume() {
      try {
        const { data } = await api.get<MinesCurrent>('/game/mines/current');
        if (cancelled || !data.game) {
          return;
        }

        setGameId(data.game.gameId);
        setMinesCount(data.game.minesCount);
        setAmount(String(data.game.betAmount));
        setMultiplier(data.game.multiplier);
        setRevealed(data.game.revealedTiles);
        setStatus('active');
      } catch {
        // No resumable board — the player just sees a fresh table.
      }
    }

    void load();
    void resume();

    return () => {
      cancelled = true;
    };
  }, []);

  function resetBoard() {
    setGameId(null);
    setRevealed([]);
    setMines([]);
    setBombIndex(null);
    setMultiplier(1);
    setPayout(0);
    setShowWin(false);
  }

  async function startGame() {
    if (busy || status === 'active') {
      return;
    }

    setError(null);

    const stake = Number(amount);
    if (!Number.isFinite(stake) || stake <= 0) {
      setError('Enter a bet amount greater than 0.');
      return;
    }

    if (!Number.isInteger(minesCount) || minesCount < MIN_MINES || minesCount > MAX_MINES) {
      setError(`Mines must be a whole number between ${MIN_MINES} and ${MAX_MINES}.`);
      return;
    }

    setBusy(true);
    resetBoard();
    setStatus('idle');

    try {
      const { data } = await api.post<MinesStart>('/game/mines/start', {
        betAmount: stake,
        minesCount,
      });

      setGameId(data.gameId);
      setMultiplier(data.multiplier);
      setBalance(data.balanceAfter);
      setStatus('active');
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'The game could not be started.'));
      void refreshBalance();
    } finally {
      setBusy(false);
    }
  }

  async function revealTile(index: number) {
    if (!gameId || status !== 'active' || busy || revealed.includes(index)) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const { data } = await api.post<MinesReveal>('/game/mines/reveal', {
        gameId,
        tileIndex: index,
      });

      setRevealed(data.revealedTiles);
      setMultiplier(data.multiplier);
      setBalance(data.balanceAfter);

      if (data.status === 'lost') {
        setStatus('lost');
        setBombIndex(data.bombIndex ?? index);
        setMines(data.mines ?? []);
        setPayout(0);
        playSound('crash');
      } else if (data.status === 'won') {
        setStatus('won');
        setMines(data.mines ?? []);
        setPayout(data.payout);
        setShowWin(true);
        playSound('win');
      } else {
        playSound('click');
      }
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'That tile could not be opened.'));
    } finally {
      setBusy(false);
    }
  }

  async function cashout() {
    if (!gameId || status !== 'active' || busy || revealed.length === 0) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const { data } = await api.post<MinesCashout>('/game/mines/cashout', { gameId });

      setStatus('won');
      setMultiplier(data.multiplier);
      setPayout(data.payout);
      setMines(data.mines);
      setRevealed(data.revealedTiles);
      setBalance(data.balanceAfter);
      setShowWin(true);
      playSound('win');
      void refreshBalance();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Cash out failed — try again.'));
      void refreshBalance();
    } finally {
      setBusy(false);
    }
  }

  const stake = Number(amount) || 0;
  const previewStake = stake > 0 ? stake : DEFAULT_BET;
  const active = status === 'active';
  const settled = status === 'won' || status === 'lost';
  const revealedSet = new Set(revealed);
  const mineSet = new Set(mines);
  const cashoutValue = previewStake * multiplier;

  /** A tile is face-up when it was opened, or when the board is settled. */
  function tileFace(index: number): { open: boolean; glyph: string; kind: string } {
    const isRevealed = revealedSet.has(index);
    const isMine = mineSet.has(index);

    if (isRevealed) {
      return { open: true, glyph: '💎', kind: 'safe' };
    }

    if (settled && isMine) {
      return {
        open: true,
        glyph: '💣',
        kind: index === bombIndex ? 'boom' : 'mine',
      };
    }

    return { open: false, glyph: '', kind: 'hidden' };
  }

  const canCashout = active && !busy && revealed.length > 0;
  const actionLabel = active ? (canCashout ? 'CASH OUT' : 'PICK TILE') : busy ? 'STARTING…' : 'START';
  const actionDisabled = active ? !canCashout : busy;

  return (
    <GameShell
      balance={balance}
      balanceError={balanceError}
      betAmount={previewStake}
      setBetAmount={(value) => setAmount(String(value))}
      onSpin={() => {
        if (active) void cashout();
        else void startGame();
      }}
      spinLabel={actionLabel}
      isSpinning={busy}
      disabled={actionDisabled}
      controls={
        <div className="chips" style={{ flexWrap: 'nowrap' }}>
          <span className="panel-label" style={{ marginRight: 8 }}>Mines</span>
          {MINE_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              className={`chip${minesCount === preset ? ' chip--active' : ''}`}
              onClick={() => setMinesCount(preset)}
              disabled={active || busy}
              aria-pressed={minesCount === preset}
            >
              {preset}
            </button>
          ))}
        </div>
      }
    >
      <section className="rt__stage">
        <div className={`mines${active ? ' mines--active' : ''}`}>
          <div className="mines__grid" role="grid" aria-label="Mines board">
            {Array.from({ length: GRID_SIZE }, (_, index) => {
              const face = tileFace(index);
              const disabled = !active || busy || face.open;

              return (
                <button
                  key={index}
                  type="button"
                  role="gridcell"
                  className={`mines-tile${face.open ? ` mines-tile--open mines-tile--${face.kind}` : ''}`}
                  onClick={() => void revealTile(index)}
                  disabled={disabled}
                  aria-label={face.open ? `Tile ${index + 1}: ${face.kind}` : `Open tile ${index + 1}`}
                >
                  <span className="mines-tile__inner">
                    <span className="mines-tile__face mines-tile__face--front" aria-hidden="true" />
                    <span className="mines-tile__face mines-tile__face--back" aria-hidden="true">
                      {face.glyph}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <GameResultOverlay
          isOpen={showWin}
          isWin={status === 'won'}
          amount={status === 'won' ? payout : 0}
          multiplier={status === 'won' ? multiplier : 0}
          detail={status === 'won' ? `${revealed.length} gems at ${multiplier.toFixed(2)}× your bet` : undefined}
          onClose={() => setShowWin(false)}
        />

        <p className="rt__fair">
          {active
            ? `Gems ${revealed.length}/${GRID_SIZE - minesCount} · ${multiplier.toFixed(2)}× · ${money(cashoutValue)}`
            : `${GRID_SIZE - minesCount} safe tiles · pick mines and start`}
        </p>
        {error && <p className="error">{error}</p>}
      </section>
    </GameShell>
  );
}


