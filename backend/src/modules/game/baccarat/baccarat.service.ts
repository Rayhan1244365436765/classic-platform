import crypto from 'node:crypto';

import type { PoolClient } from 'pg';

import {
  generateClientSeed,
  generateProvablyFairFloat,
  generateServerSeed,
  hashServerSeed,
} from '../../../common/provably-fair/index.js';
import { AppError } from '../../../common/utils/AppError.js';
import { withTransaction } from '../../../config/db.js';
import { getGameConfig } from '../../config/config.store.js';
import { createTransaction, getBalance, lockUser } from '../../wallet/wallet.service.js';

/**
 * Baccarat (Punto Banco) — one 52-card deck, the player bets on Player, Banker
 * or Tie. Card values: A = 1, 2–9 = face value, T/J/Q/K = 0, and every total is
 * taken **mod 10** (so 7 + 8 = 5).
 *
 * --- third-card rules -------------------------------------------------------
 *   * either side on 8 or 9 after two cards → **natural**, both stand;
 *   * Player draws on 0–5, stands on 6–7;
 *   * Banker follows the standard tableau, which depends on the player's third
 *     card (`bankerShouldDraw` below): 0–2 always draws, 3 draws unless the
 *     player's card was an 8, 4 draws on 2–7, 5 on 4–7, 6 on 6–7, 7 stands.
 *
 * The task allowed a "simplified" variant — both sides draw on 0–5 — but that
 * makes the game **perfectly symmetric**: measured by exact enumeration, the
 * two sides win 45.3909% each, so a 2× Player payout is a **100.00% RTP, a
 * zero-edge free bet**. The tableau above restores the real asymmetry (the
 * banker wins more often, which is what the 5% commission is for):
 *
 *   P(player) 44.6760%   P(banker) 45.9624%   P(tie) 9.3615%
 *
 * --- payouts / economics ----------------------------------------------------
 * A tie **pushes** Player and Banker bets (standard Punto Banco), which is what
 * makes the 2× / 1.95× payouts land on real baccarat numbers:
 *
 *   Player  2×      →  P(tie) + 2·P(player)        = 98.71% RTP (1.29% edge)
 *   Banker  1.95×   →  P(tie) + 1.95·P(banker)     = 98.99% RTP (1.01% edge)
 *   Tie     8×      →  8·P(tie)                    = 74.89% RTP (25.11% edge)
 *
 * The Banker's 1.95× is the 2× win less the 5% commission on the 1× profit. The
 * tie bet is thin because 8× is paid on a ~9.4% event; paying 9× (8:1 profit,
 * the usual casino price) would lift it to 84.25%. `baccaratConfig()` publishes
 * these exact figures — they are recomputed by enumeration, not hard-coded.
 */

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K'] as const;
const SUITS = ['S', 'H', 'D', 'C'] as const;

/** Cards in the shoe. */
export const DECK_SIZE = 52;
/** Cards each side starts with. */
const OPENING_CARDS = 2;
/** Two-card total at or above this is a natural — no third cards. */
export const NATURAL_TOTAL = 8;
/** Player draws on any total up to and including this. */
export const PLAYER_DRAWS_AT = 5;

/** Total return per unit staked (built-in defaults). */
export const BACCARAT_PAYOUTS = { player: 2, banker: 1.95, tie: 8 } as const;

export type BaccaratPayouts = { player: number; banker: number; tie: number };

/** Payouts: admin-configurable (`baccarat` row), falling back to the defaults. */
export function baccaratPayouts(): BaccaratPayouts {
  return getGameConfig<BaccaratPayouts>('baccarat') ?? BACCARAT_PAYOUTS;
}

/** Commission taken out of a Banker win (2× − 5% of the 1× profit = 1.95×). */
export const BANKER_COMMISSION = 0.05;

export type BaccaratBet = 'player' | 'banker' | 'tie';
export type BaccaratWinner = 'player' | 'banker' | 'tie';
export type BaccaratOutcome = 'won' | 'lost' | 'push';
/** Card code, e.g. `"AS"` (ace of spades) or `"TH"` (ten of hearts). */
export type BaccaratCard = string;

export type BaccaratResult = {
  playerHand: BaccaratCard[];
  bankerHand: BaccaratCard[];
  playerTotal: number;
  bankerTotal: number;
  /** True when either side was dealt 8 or 9 — no third cards were drawn. */
  natural: boolean;
  /** Which side won (`'tie'` when the totals match). */
  winner: BaccaratWinner;
  betOn: BaccaratBet;
  outcome: BaccaratOutcome;
  /** 2 / 1.95 / 8 on a win, 1 on a push, 0 on a loss. */
  multiplier: number;
  payout: number;
  betAmount: number;
  balanceAfter: number;
  serverSeedHash: string;
  roundId: string;
};

/** Baccarat value of one card: A = 1, 2–9 face, T/J/Q/K = 0. */
export function cardValue(card: BaccaratCard): number {
  const rank = card.slice(0, -1);

  if (rank === 'A') return 1;
  if (rank === 'T' || rank === 'J' || rank === 'Q' || rank === 'K') return 0;

  return Number(rank);
}

/** Hand total mod 10 — the only total baccarat uses. */
export function baccaratTotal(cards: readonly BaccaratCard[]): number {
  return cards.reduce((sum, card) => sum + cardValue(card), 0) % 10;
}

/**
 * Standard banker tableau. `playerThird` is the *value* of the player's third
 * card, or `null` when the player stood (total 6–7) — then the banker simply
 * draws on 0–5.
 */
export function bankerShouldDraw(bankerTotal: number, playerThird: number | null): boolean {
  if (playerThird === null) return bankerTotal <= PLAYER_DRAWS_AT;

  if (bankerTotal <= 2) return true;
  if (bankerTotal === 3) return playerThird !== 8;
  if (bankerTotal === 4) return playerThird >= 2 && playerThird <= 7;
  if (bankerTotal === 5) return playerThird >= 4 && playerThird <= 7;
  if (bankerTotal === 6) return playerThird === 6 || playerThird === 7;

  return false; // 7, 8, 9 stand
}

/** Provably-fair Fisher–Yates shuffle of a fresh 52-card deck. */
function buildShoe(serverSeed: string, clientSeed: string): BaccaratCard[] {
  const shoe: BaccaratCard[] = RANKS.flatMap((rank) => SUITS.map((suit) => `${rank}${suit}`));

  for (let index = shoe.length - 1; index > 0; index -= 1) {
    const roll = generateProvablyFairFloat(serverSeed, clientSeed, index + 1);
    const swap = Math.floor(roll * (index + 1));
    const current = shoe[index]!;
    shoe[index] = shoe[swap]!;
    shoe[swap] = current;
  }

  return shoe;
}

/** How many cards of each value the deck holds: 16 zeros (T/J/Q/K) + four of 1–9. */
const VALUE_COUNTS = [16, 4, 4, 4, 4, 4, 4, 4, 4, 4] as const;

export type BaccaratProbabilities = { player: number; banker: number; tie: number };

let cachedProbabilities: BaccaratProbabilities | null = null;

/**
 * Exact win/tie odds of one round.
 *
 * A card matters only through its baccarat value and the count of that value
 * left in the shoe, so the whole game can be summed over value sequences (10⁴
 * opening deals plus the third-card branches) instead of 52! shuffles. The three
 * probabilities sum to 1 — the smoke test asserts it.
 */
export function baccaratProbabilities(): BaccaratProbabilities {
  if (cachedProbabilities) return cachedProbabilities;

  const odds: BaccaratProbabilities = { player: 0, banker: 0, tie: 0 };

  const settleTotals = (playerTotal: number, bankerTotal: number, weight: number): void => {
    if (playerTotal > bankerTotal) odds.player += weight;
    else if (bankerTotal > playerTotal) odds.banker += weight;
    else odds.tie += weight;
  };

  /** Probability the next card has `value`, given the values already dealt. */
  const weightOf = (value: number, dealt: readonly number[]): number => {
    const taken = dealt.filter((card) => card === value).length;
    return (VALUE_COUNTS[value]! - taken) / (DECK_SIZE - dealt.length);
  };

  for (let first = 0; first <= 9; first += 1) {
    for (let second = 0; second <= 9; second += 1) {
      for (let third = 0; third <= 9; third += 1) {
        for (let fourth = 0; fourth <= 9; fourth += 1) {
          // Deal order is Player, Banker, Player, Banker.
          const weights = [
            weightOf(first, []),
            weightOf(second, [first]),
            weightOf(third, [first, second]),
            weightOf(fourth, [first, second, third]),
          ];
          if (weights.some((weight) => weight <= 0)) continue;

          const opening = weights.reduce((product, weight) => product * weight, 1);
          const playerOpening = (first + third) % 10;
          const bankerOpening = (second + fourth) % 10;
          const dealt = [first, second, third, fourth];

          // Naturals: both sides stand.
          if (playerOpening >= NATURAL_TOTAL || bankerOpening >= NATURAL_TOTAL) {
            settleTotals(playerOpening, bankerOpening, opening);
            continue;
          }

          const playerBranches: {
            total: number;
            thirdCard: number | null;
            weight: number;
            dealt: number[];
          }[] = [];

          if (playerOpening <= PLAYER_DRAWS_AT) {
            for (let card = 0; card <= 9; card += 1) {
              const weight = weightOf(card, dealt);
              if (weight <= 0) continue;

              playerBranches.push({
                total: (playerOpening + card) % 10,
                thirdCard: card,
                weight: opening * weight,
                dealt: [...dealt, card],
              });
            }
          } else {
            playerBranches.push({
              total: playerOpening,
              thirdCard: null,
              weight: opening,
              dealt,
            });
          }

          for (const branch of playerBranches) {
            if (!bankerShouldDraw(bankerOpening, branch.thirdCard)) {
              settleTotals(branch.total, bankerOpening, branch.weight);
              continue;
            }

            for (let card = 0; card <= 9; card += 1) {
              const weight = weightOf(card, branch.dealt);
              if (weight <= 0) continue;

              settleTotals(branch.total, (bankerOpening + card) % 10, branch.weight * weight);
            }
          }
        }
      }
    }
  }

  cachedProbabilities = odds;

  return odds;
}

/** Theoretical RTP of each bet (a tie returns Player/Banker stakes). */
export function baccaratRtp(
  payouts: BaccaratPayouts = baccaratPayouts(),
): Record<BaccaratBet, number> {
  const odds = baccaratProbabilities();

  return {
    player: odds.tie + payouts.player * odds.player,
    banker: odds.tie + payouts.banker * odds.banker,
    tie: payouts.tie * odds.tie,
  };
}

/** Payouts, table rules and exact odds — everything the client renders. */
export function baccaratConfig(): {
  deckSize: number;
  naturalTotal: number;
  playerDrawsAt: number;
  payouts: BaccaratPayouts;
  bankerCommission: number;
  pushOnTie: boolean;
  probabilities: BaccaratProbabilities;
  rtp: Record<BaccaratBet, number>;
} {
  return {
    deckSize: DECK_SIZE,
    naturalTotal: NATURAL_TOTAL,
    playerDrawsAt: PLAYER_DRAWS_AT,
    payouts: baccaratPayouts(),
    bankerCommission: BANKER_COMMISSION,
    pushOnTie: true,
    probabilities: baccaratProbabilities(),
    rtp: baccaratRtp(),
  };
}

/** Win / push / loss for the side the player backed. */
function settleBet(
  winner: BaccaratWinner,
  betOn: BaccaratBet,
): { outcome: BaccaratOutcome; multiplier: number } {
  if (winner === betOn) {
    return { outcome: 'won', multiplier: baccaratPayouts()[betOn] };
  }

  // Standard Punto Banco: a tie returns Player and Banker stakes.
  if (winner === 'tie') {
    return { outcome: 'push', multiplier: 1 };
  }

  return { outcome: 'lost', multiplier: 0 };
}

/** Play one Baccarat hand. */
export async function playBaccarat(
  userId: string,
  betAmount: number,
  betOn: BaccaratBet,
): Promise<BaccaratResult> {
  const stake = assertBetAmount(betAmount);
  const side = assertBetOn(betOn);

  // 1. Shuffle and deal (pure computation, nothing written yet).
  const serverSeed = generateServerSeed();
  const clientSeed = generateClientSeed();
  const serverSeedHash = hashServerSeed(serverSeed);

  const shoe = buildShoe(serverSeed, clientSeed);
  const draw = (): BaccaratCard => {
    const card = shoe.pop();
    if (!card) {
      throw new AppError('SHOE_EXHAUSTED', 500, 'The shoe ran out of cards');
    }

    return card;
  };

  // Real deal order: Player, Banker, Player, Banker.
  const playerHand: BaccaratCard[] = [];
  const bankerHand: BaccaratCard[] = [];
  for (let round = 0; round < OPENING_CARDS; round += 1) {
    playerHand.push(draw());
    bankerHand.push(draw());
  }

  const playerOpening = baccaratTotal(playerHand);
  const bankerOpening = baccaratTotal(bankerHand);
  const natural = playerOpening >= NATURAL_TOTAL || bankerOpening >= NATURAL_TOTAL;

  // Player draws on 0–5; the banker's decision uses its *opening* total and the
  // value of the card the player just drew.
  let playerThird: number | null = null;
  if (!natural && playerOpening <= PLAYER_DRAWS_AT) {
    const card = draw();
    playerHand.push(card);
    playerThird = cardValue(card);
  }

  if (!natural && bankerShouldDraw(bankerOpening, playerThird)) {
    bankerHand.push(draw());
  }

  const playerTotal = baccaratTotal(playerHand);
  const bankerTotal = baccaratTotal(bankerHand);

  const winner: BaccaratWinner =
    playerTotal > bankerTotal ? 'player' : bankerTotal > playerTotal ? 'banker' : 'tie';

  const { outcome, multiplier } = settleBet(winner, side);
  const payout = roundMoney(stake * multiplier);
  const roundId = crypto.randomUUID();

  // 2. One transaction: debit stake → credit payout → record the round.
  const balanceAfter = await withTransaction(async (client) => {
    await lockUser(client, userId);

    const balance = await getBalance(userId, client);
    if (balance < stake) {
      throw new AppError(
        'INSUFFICIENT_FUNDS',
        400,
        `Insufficient funds: balance is ${balance.toFixed(2)}, bet is ${stake.toFixed(2)}`,
      );
    }

    await createTransaction(client, {
      userId,
      type: 'bet',
      amount: -stake,
      referenceId: roundId,
    });

    if (payout > 0) {
      await createTransaction(client, {
        userId,
        type: 'win',
        amount: payout,
        referenceId: roundId,
      });
    }

    await insertRound(client, {
      roundId,
      userId,
      betAmount: stake,
      betOn: side,
      playerHand,
      bankerHand,
      winner,
      multiplier,
      payout,
      serverSeedHash,
    });

    return roundMoney(balance - stake + payout);
  });

  return {
    playerHand,
    bankerHand,
    playerTotal,
    bankerTotal,
    natural,
    winner,
    betOn: side,
    outcome,
    multiplier,
    payout,
    betAmount: stake,
    balanceAfter,
    serverSeedHash,
    roundId,
  };
}

type RoundData = {
  roundId: string;
  userId: string;
  betAmount: number;
  betOn: BaccaratBet;
  playerHand: BaccaratCard[];
  bankerHand: BaccaratCard[];
  winner: BaccaratWinner;
  multiplier: number;
  payout: number;
  serverSeedHash: string;
};

/**
 * Persists the round audit row (ledger rows are written by the wallet service).
 * `bet_value` keeps the side, `result` keeps the winner and both hands, e.g.
 * `banker|P:AS,5H|B:KH,2C,7S` — well inside the 64-char column.
 */
async function insertRound(client: PoolClient, data: RoundData): Promise<void> {
  await client.query(
    `INSERT INTO game_rounds
       (id, user_id, bet_amount, bet_type, bet_value, result, payout, multiplier, server_seed_hash)
     VALUES ($1, $2, $3, 'baccarat', $4, $5, $6, $7, $8)`,
    [
      data.roundId,
      data.userId,
      moneyString(data.betAmount),
      data.betOn,
      `${data.winner}|P:${data.playerHand.join(',')}|B:${data.bankerHand.join(',')}`,
      moneyString(data.payout),
      moneyString(data.multiplier),
      data.serverSeedHash,
    ],
  );
}

function assertBetOn(betOn: unknown): BaccaratBet {
  if (betOn !== 'player' && betOn !== 'banker' && betOn !== 'tie') {
    throw new AppError(
      'VALIDATION_ERROR',
      400,
      "betOn: Must be 'player', 'banker' or 'tie'",
    );
  }

  return betOn;
}

function assertBetAmount(betAmount: number): number {
  if (typeof betAmount !== 'number' || !Number.isFinite(betAmount)) {
    throw new AppError('INVALID_BET_AMOUNT', 400, 'Bet amount must be a finite number');
  }

  const stake = roundMoney(betAmount);
  if (stake <= 0) {
    throw new AppError('INVALID_BET_AMOUNT', 400, 'Bet amount must be greater than 0');
  }

  return stake;
}

function roundMoney(amount: number): number {
  return Math.round(amount * 100) / 100;
}

function moneyString(amount: number): string {
  return roundMoney(amount).toFixed(2);
}
