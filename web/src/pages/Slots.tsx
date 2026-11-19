import { useCallback, useEffect, useState } from 'react';
import { GameShell } from '../components/GameShell';
import { api, getApiErrorMessage } from '../api/client';
import type { BalanceResponse, SlotsConfig, SlotsResult } from '../api/types';
import { playSound } from '../utils/sound';

/**
 * Lucky Slots — 3×3 reels with three horizontal paylines.
 *
 *   row 0 → cells 0 1 2
 *   row 1 → cells 3 4 5
 *   row 2 → cells 6 7 8
 *
 * The server draws the whole grid (one provably-fair index over 6⁹) and pays
 * every row of three identical symbols (`SLOT_PAYTABLE.lineMultiplier`, 10.8×
 * of the total bet, so all three rows pay 32.4×). This page only animates the
 * reveal: nine reels scroll, stop column by column, then the paying rows glow.
 */

const CHIPS = [1, 5, 10, 50, 100];
/** Preview stake used before the player types one. */
const DEFAULT_BET = 10;
/** Used only if the config request fails — mirrors the backend table. */
const FALLBACK_SYMBOLS = ['🍒', '🍋', '🍇', '⭐', '💎', '7️⃣'];
const LINE_NAMES = ['Top', 'Middle', 'Bottom'];

/** Staggered stop: column by column, and slightly top → bottom. */
function stopTime(index: number): number {
  const column = index % 3;
  const row = Math.floor(index / 3);
  return 900 + column * 240 + row * 90;
}

/** Gap between the last reel landing and the result card. */
const CARD_DELAY = 220;

function money(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  const fractionDigits = rounded % 1 === 0 ? 0 : 2;

  return `$${rounded.toLocaleString('en-US', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: 2,
  })}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function fetchBalance(): Promise<number> {
  const { data } = await api.get<BalanceResponse>('/wallet/balance');
  return data.balance;
}

async function fetchConfig(): Promise<SlotsConfig> {
  const { data } = await api.get<SlotsConfig>('/game/slots/config');
  return data;
}

const FALLBACK_GRID = Array.from({ length: 9 }, (_, index) => FALLBACK_SYMBOLS[index % 6]!);
/** 3 × 3 — kept as a constant so the spin loop and the grid stay in step. */
const cellsLength = FALLBACK_GRID.length;

export default function Slots() {
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);

  const [amount, setAmount] = useState(String(DEFAULT_BET));
  const [config, setConfig] = useState<SlotsConfig | null>(null);
  const symbols = config?.symbols ?? FALLBACK_SYMBOLS;

  // `null` = that reel is still rolling.
  const [cells, setCells] = useState<(string | null)[]>(FALLBACK_GRID);
  const [winningLines, setWinningLines] = useState<number[]>([]);
  const [isSpinning, setIsSpinning] = useState(false);
  const [result, setResult] = useState<SlotsResult | null>(null);
  const [showCard, setShowCard] = useState(false);
  const [, setError] = useState<string | null>(null);

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
        const value = await fetchConfig();
        if (!cancelled && value.symbols.length > 0) {
          setConfig(value);
        }
      } catch {
        // The fallback table matches the backend; the game still works.
      }
    }

    void loadBalance();
    void loadConfig();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSpin() {
    if (isSpinning) {
      return;
    }

    setError(null);

    const stakeAmount = Number(amount);
    if (!Number.isFinite(stakeAmount) || stakeAmount <= 0) {
      setError('Enter a bet amount greater than 0.');
      return;
    }

    setIsSpinning(true);
    setShowCard(false);
    setResult(null);
    setWinningLines([]);
    setCells([null, null, null, null, null, null, null, null, null]);

    try {
      // The API settles the stake; everything below is presentation.
      const [response] = await Promise.all([
        api.post<SlotsResult>('/game/slots/play', { betAmount: stakeAmount }),
        delay(300),
      ]);

      const data = response.data;

      // Ticking reels for as long as the last reel takes to land.
      playSound('spin', { durationMs: stopTime(cellsLength - 1) });

      // Drop the reels column by column, top to bottom.
      let elapsed = 300;
      for (let index = 0; index < cellsLength; index += 1) {
        const wait = Math.max(0, stopTime(index) - elapsed);
        if (wait > 0) {
          await delay(wait);
          elapsed += wait;
        }

        const symbol = data.grid[index];
        if (symbol === undefined) {
          continue;
        }

        setCells((previous) => {
          const next = [...previous];
          next[index] = symbol;
          return next;
        });
      }

      await delay(CARD_DELAY);
      setResult(data);
      setWinningLines(data.winningLines);
      setShowCard(true);
      playSound(data.won ? 'win' : 'lose');
      setBalance(data.balanceAfter);
      void refreshBalance();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'The spin could not be placed.'));
      setCells(FALLBACK_GRID);
      void refreshBalance();
    } finally {
      setIsSpinning(false);
    }
  }

  const stake = Number(amount) || 0;
  const previewStake = stake > 0 ? stake : DEFAULT_BET;

  const headline = !result
    ? ''
    : result.winningLines.length === 0
      ? 'No match'
      : result.winningLines.length > 1
        ? 'MEGA WIN!'
        : 'WINNER!';

  const caption = !result
    ? ''
    : result.winningLines.length === 0
      ? 'The reels did not line up. Spin again?'
      : `${result.winningLines.map((line) => LINE_NAMES[line] ?? '').join(' + ')} ${
          result.winningLines.length > 1 ? 'lines' : 'line'
        } · ${result.lineMultiplier}× each = ${result.multiplier}× your bet`;

  const gameProps = {
    balance,
    onBack: () => {
      // Slots has no other back destination.
    },
    betAmount: previewStake,
    setBetAmount: (amount: number) => setAmount(String(amount)),
    onSpin: () => void handleSpin(),
    spinLabel: 'SPIN',
    isSpinning,
  };

  return (
    <GameShell {...gameProps}
      controls={
        <>
          <div className="panel-block">
            <div className="panel-label">
              Bet amount
              <span className="panel-value">{money(previewStake)}</span>
            </div>
            <div className="chips">
              {CHIPS.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  className={`chip${stake === chip ? ' chip--active' : ''}`}
                  onClick={() => setAmount(String(chip))}
                  disabled={isSpinning}
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
                disabled={isSpinning}
                aria-label="Custom bet amount"
              />
            </div>
          </div>
        </>
      }
    >
      <section className="rt__stage">
        <div className={`cabinet${isSpinning ? ' cabinet--spinning' : ''}`}>
          <div className="cabinet__glow" aria-hidden="true" />

            <div
              className="cabinet__grid"
              role="img"
              aria-label={
                result && !isSpinning
                  ? `Reels stopped on ${result.grid.join(', ')}${
                      result.winningLines.length > 0
                        ? `; ${result.winningLines.length} winning line(s)`
                        : ''
                    }`
                  : isSpinning
                    ? 'Reels spinning'
                    : 'Ready to spin'
              }
            >
              {[0, 1, 2].map((row) => (
                <div
                  key={row}
                  className={`slot-row${winningLines.includes(row) ? ' slot-row--win' : ''}`}
                  data-line={LINE_NAMES[row]}
                >
                  {[0, 1, 2].map((column) => {
                    const index = row * 3 + column;
                    const symbol = cells[index] ?? null;
                    const rolling = symbol === null;

                    return (
                      <div
                        key={index}
                        className={`reel${rolling ? ' reel--rolling' : ''}`}
                        data-cell={index}
                      >
                        <div
                          className="reel__strip"
                          style={
                            rolling ? { animationDuration: `${380 + (index % 4) * 70}ms` } : undefined
                          }
                        >
                          {(rolling ? [...symbols, ...symbols, ...symbols] : [symbol]).map(
                            (glyph, glyphIndex) => (
                              <span
                                key={`${glyph}-${glyphIndex}`}
                                className="reel__symbol"
                                aria-hidden="true"
                              >
                                {glyph}
                              </span>
                            ),
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          {showCard && result && (
            <div
              className={`slots-result${result.won ? ' slots-result--win' : ' slots-result--lose'}`}
              role="status"
              aria-live="polite"
            >
              <p className="slots-result__headline">{headline}</p>
              <p className="slots-result__amount">
                {result.won ? `+${money(result.payout)}` : `-${money(result.betAmount)}`}
              </p>
              <p className="slots-result__caption">{caption}</p>
            </div>
          )}

          <p className="rt__fair">Provably fair · seed hash published before every spin</p>
          {balanceError && <p className="error">{balanceError}</p>}
        </section>
      </GameShell>
  );
}


