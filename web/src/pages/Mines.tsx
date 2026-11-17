import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { api, getApiErrorMessage } from '../api/client';
import type { BalanceResponse, MinesCashout, MinesReveal, MinesStart } from '../api/types';
import { ArrowLeftIcon, WalletIcon } from '../components/Icons';
import { LivePlayerBadge } from '../components/LivePlayerBadge';
import { SoundToggle } from '../components/SoundToggle';
import { playSound } from '../utils/sound';

/**
 * Mines — 5×5 board, server-held layout, provably-fair shuffle.
 *
 * The server never sends the layout before the game settles; this page only
 * renders what it is told (revealed indices, multiplier, and — once the game is
 * over — the mine positions so every bomb can be shown).
 */

const CHIPS = [1, 5, 10, 50, 100];
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
      playSound('win');
      void refreshBalance();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Cash out failed — try again.'));
      void refreshBalance();
    } finally {
      setBusy(false);
    }
  }

  const balanceLabel = balance === null ? '···' : money(balance);
  const stake = Number(amount) || 0;
  const previewStake = stake > 0 ? stake : DEFAULT_BET;
  const active = status === 'active';
  const settled = status === 'won' || status === 'lost';
  const revealedSet = new Set(revealed);
  const mineSet = new Set(mines);
  const cashoutValue = previewStake * multiplier;
  const currentStake = status === 'idle' ? previewStake : stake;

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

  return (
    <div className="rt">
      <header className="rt__topbar">
        <Link to="/" className="rt__back">
          <ArrowLeftIcon className="icon icon--sm" />
          Back to Lobby
        </Link>

        <h1 className="rt__title">Mines</h1>

        <SoundToggle />

        <LivePlayerBadge baseCount={2700} />

        <span
          className={`balance-pill${balanceError ? ' balance-pill--error' : ''}`}
          title={balanceError ?? 'Current balance'}
        >
          <WalletIcon className="icon icon--sm" />
          {balanceLabel}
        </span>
      </header>

      <main className="rt__body rt__body--controls-left">
        <aside className="rt__panel">
          <div className="panel-block">
            <div className="panel-label">
              Bet amount
              <span className="panel-value">{money(currentStake)}</span>
            </div>
            <div className="chips">
              {CHIPS.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  className={`chip${stake === chip ? ' chip--active' : ''}`}
                  onClick={() => setAmount(String(chip))}
                  disabled={active || busy}
                  aria-pressed={stake === chip}
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
                disabled={active || busy}
                aria-label="Custom bet amount"
              />
            </div>
          </div>

          <div className="panel-block">
            <div className="panel-label">
              Mines
              <span className="panel-value">{minesCount}</span>
            </div>
            <div className="chips">
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
              <input
                className="chips__custom"
                type="number"
                value={minesCount}
                onChange={(event) => setMinesCount(Number(event.target.value))}
                min={MIN_MINES}
                max={MAX_MINES}
                step={1}
                disabled={active || busy}
                aria-label="Number of mines"
              />
            </div>
            <p className="rt__meta rt__meta--left">
              {GRID_SIZE - minesCount} safe tiles · more mines, bigger multipliers.
            </p>
          </div>

          <div className="panel-block">
            <div className="panel-label">
              Multiplier
              <span className="panel-value">{multiplier.toFixed(2)}×</span>
            </div>
            <div className="payout">
              <span className="payout__amount payout__amount--gold">
                <span className="payout__label">Cash out</span>
                {money(active ? cashoutValue : payout)}
              </span>
              <span className="payout__amount payout__amount--gray">
                <span className="payout__label">Gems</span>
                {revealed.length}/{GRID_SIZE - minesCount}
              </span>
            </div>
          </div>

          {active ? (
            <button
              type="button"
              className="aviator-action aviator-action--cashout"
              onClick={() => void cashout()}
              disabled={busy || revealed.length === 0}
            >
              <span className="aviator-action__title">
                {revealed.length === 0 ? 'OPEN A TILE FIRST' : `CASH OUT ${money(cashoutValue)}`}
              </span>
              <span className="aviator-action__sub">{multiplier.toFixed(2)}×</span>
            </button>
          ) : (
            <button
              type="button"
              className="aviator-action"
              onClick={() => void startGame()}
              disabled={busy}
            >
              <span className="aviator-action__title">{busy ? 'STARTING…' : 'START GAME'}</span>
              <span className="aviator-action__sub">{money(previewStake)}</span>
            </button>
          )}

          {error && <p className="error">{error}</p>}

          <p className="rt__meta">
            Provably fair shuffle · the mine layout never leaves the server until the game ends
          </p>
        </aside>

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
                    aria-label={
                      face.open ? `Tile ${index + 1}: ${face.kind}` : `Open tile ${index + 1}`
                    }
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

          {settled && (
            <div
              className={`mines-result${status === 'won' ? ' mines-result--win' : ' mines-result--lose'}`}
              role="status"
              aria-live="polite"
            >
              <p className="mines-result__headline">{status === 'won' ? 'Cashed out!' : 'BOOM!'}</p>
              <p className="mines-result__amount">
                {status === 'won' ? `+${money(payout)}` : `-${money(stake)}`}
              </p>
              <p className="mines-result__caption">
                {status === 'won'
                  ? `${revealed.length} gems at ${multiplier.toFixed(2)}× your bet`
                  : `You hit a mine after ${revealed.length} gem${revealed.length === 1 ? '' : 's'}`}
              </p>
            </div>
          )}

          <p className="rt__fair">
            {active
              ? 'Click any tile — cash out before you hit a mine'
              : 'Pick your bet and mines, then start a board'}
          </p>
          {balanceError && <p className="error">{balanceError}</p>}
        </section>

      </main>
    </div>
  );
}


