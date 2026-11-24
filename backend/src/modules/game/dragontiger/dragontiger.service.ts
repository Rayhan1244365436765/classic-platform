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
 * Dragon Tiger — one card to Dragon, one to Tiger, highest rank wins.
 *
 * Ranks compare as A(1) < 2 < … < 10 < J(11) < Q(12) < K(13); equal ranks are a
 * tie regardless of suit. **A tie loses Dragon and Tiger bets** (as specified) —
 * so the side bets only pay when they win outright.
 *
 * --- shoe size -------------------------------------------------------------
 * Only P(tie) depends on the shoe, and it drives everything else by symmetry:
 *
 *   P(tie)  = 13 · (perRank / total) · ((perRank − 1) / (total − 1))
 *   P(side) = (1 − P(tie)) / 2
 *
 *   one 52-card deck    P(tie) 5.8824%   P(side) 47.0588%
 *   eight decks (416)   P(tie) 7.4699%   P(side) 46.2651%   ← implemented
 *
 * The spec's 8× tie is, in its own words, "standard for an 8-deck game", so the
 * table deals from the standard 8-deck shoe and both stated multipliers (2× and
 * 8×) are honoured exactly. `DRAGON_TIGER_DECKS` is the one knob:
 *
 *   decks   sides 2×   tie 8×        side RTP   tie RTP
 *     1      94.12%    47.06%        5.88% edge  52.94% edge
 *     8      92.53%    59.76%        7.47% edge  40.24% edge   ← shipped
 *     8      92.53%    67.23% (9×)   7.47% edge  32.77% edge   ← real casino price
 *
 * (Real Dragon Tiger takes *half* a side bet on a tie, which is why its side
 * bets sit at 96.27%; "tie loses the whole bet" is stricter than the live game.)
 * `dragonTigerConfig()` publishes all of these figures from one formula.
 */

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K'] as const;
const SUITS = ['S', 'H', 'D', 'C'] as const;

/** Cards per deck. */
export const CARDS_PER_DECK = 52;
/** Decks in the shoe — the standard Dragon Tiger configuration. */
export const DRAGON_TIGER_DECKS = 8;
/** Total cards in the shoe. */
export const SHOE_SIZE = CARDS_PER_DECK * DRAGON_TIGER_DECKS;
/** Distinct ranks, i.e. the number of ways to tie. */
const RANK_COUNT = RANKS.length;

/** Total return per unit staked (built-in defaults). */
export const DRAGON_TIGER_PAYOUTS = { dragon: 2, tiger: 2, tie: 8 } as const;

export type DragonTigerPayouts = { dragon: number; tiger: number; tie: number };

/** Payouts: admin-configurable (`dragontiger` row), falling back to the defaults. */
export function dragonTigerPayouts(): DragonTigerPayouts {
  return getGameConfig<DragonTigerPayouts>('dragontiger') ?? DRAGON_TIGER_PAYOUTS;
}

export type DragonTigerBet = 'dragon' | 'tiger' | 'tie';
export type DragonTigerWinner = DragonTigerBet;
export type DragonTigerOutcome = 'won' | 'lost';
/** Card code, e.g. `"AS"` (ace of spades) or `"TH"` (ten of hearts). */
export type DragonTigerCard = string;

export type DragonTigerResult = {
  dragonCard: DragonTigerCard;
  tigerCard: DragonTigerCard;
  /** Rank values, A = 1 … K = 13. */
  dragonRank: number;
  tigerRank: number;
  winner: DragonTigerWinner;
  betOn: DragonTigerBet;
  /** A tie loses Dragon and Tiger bets, so there is no push outcome. */
  outcome: DragonTigerOutcome;
  /** 2 (dragon/tiger) or 8 (tie) on a win, 0 on a loss. */
  multiplier: number;
  payout: number;
  betAmount: number;
  balanceAfter: number;
  serverSeedHash: string;
  roundId: string;
};

/** Rank value of one card: A = 1, 2–10 face, T/J/Q/K = 10/11/12/13. */
export function cardRank(card: DragonTigerCard): number {
  const rank = card.slice(0, -1);

  if (rank === 'A') return 1;
  if (rank === 'T') return 10;
  if (rank === 'J') return 11;
  if (rank === 'Q') return 12;
  if (rank === 'K') return 13;

  return Number(rank);
}

/** Highest rank wins; equal ranks tie. */
export function compareCards(dragon: DragonTigerCard, tiger: DragonTigerCard): DragonTigerWinner {
  const dragonRank = cardRank(dragon);
  const tigerRank = cardRank(tiger);

  if (dragonRank > tigerRank) return 'dragon';
  if (tigerRank > dragonRank) return 'tiger';

  return 'tie';
}

export type DragonTigerProbabilities = { dragon: number; tiger: number; tie: number };

/** Exact odds for a shoe of `decks` decks (memoised per shoe size). */
const probabilityCache = new Map<number, DragonTigerProbabilities>();

export function dragonTigerProbabilities(decks = DRAGON_TIGER_DECKS): DragonTigerProbabilities {
  const cached = probabilityCache.get(decks);
  if (cached) return cached;

  const perRank = 4 * decks;
  const total = CARDS_PER_DECK * decks;

  // Both cards share a rank: 13 ranks × (perRank/total) × ((perRank − 1)/(total − 1)).
  const tie = RANK_COUNT * (perRank / total) * ((perRank - 1) / (total - 1));
  const side = (1 - tie) / 2;

  const probabilities: DragonTigerProbabilities = { dragon: side, tiger: side, tie };
  probabilityCache.set(decks, probabilities);

  return probabilities;
}

/** Theoretical RTP of each bet for a shoe size (a tie loses the side bets). */
export function dragonTigerRtp(
  decks = DRAGON_TIGER_DECKS,
  payouts: DragonTigerPayouts = dragonTigerPayouts(),
): Record<DragonTigerBet, number> {
  const odds = dragonTigerProbabilities(decks);

  return {
    dragon: payouts.dragon * odds.dragon,
    tiger: payouts.tiger * odds.tiger,
    tie: payouts.tie * odds.tie,
  };
}

/** Shoe size, payouts and exact odds — everything the client renders. */
export function dragonTigerConfig(): {
  decks: number;
  shoeSize: number;
  payouts: DragonTigerPayouts;
  tieLosesSides: boolean;
  probabilities: DragonTigerProbabilities;
  rtp: Record<DragonTigerBet, number>;
  /** RTP at other shoe sizes, so the panel can show the alternative. */
  alternatives: { decks: number; rtp: Record<DragonTigerBet, number> }[];
} {
  return {
    decks: DRAGON_TIGER_DECKS,
    shoeSize: SHOE_SIZE,
    payouts: dragonTigerPayouts(),
    tieLosesSides: true,
    probabilities: dragonTigerProbabilities(),
    rtp: dragonTigerRtp(),
    alternatives: [1, 8].map((decks) => ({ decks, rtp: dragonTigerRtp(decks) })),
  };
}

/**
 * Draw the Dragon card then the Tiger card from a fresh shoe.
 *
 * Partial Fisher–Yates: the shoe is built from `DRAGON_TIGER_DECKS` copies of the
 * 52 cards, then two positions are swapped in from the untouched tail. Uniform
 * over ordered pairs, and only two digests are needed instead of a 416-card
 * shuffle.
 */
export function drawPair(serverSeed: string, clientSeed: string): [DragonTigerCard, DragonTigerCard] {
  const cards = RANKS.flatMap((rank) => SUITS.map((suit) => `${rank}${suit}`));
  const shoe: DragonTigerCard[] = [];

  for (let deck = 0; deck < DRAGON_TIGER_DECKS; deck += 1) {
    shoe.push(...cards);
  }

  for (let index = 0; index < 2; index += 1) {
    const remaining = shoe.length - index;
    const fraction = generateProvablyFairFloat(serverSeed, clientSeed, index + 1);
    const partner = index + Math.min(Math.floor(fraction * remaining), remaining - 1);

    [shoe[index], shoe[partner]] = [shoe[partner]!, shoe[index]!];
  }

  return [shoe[0]!, shoe[1]!];
}

/** Play one Dragon Tiger hand. */
export async function playDragonTiger(
  userId: string,
  betAmount: number,
  betOn: DragonTigerBet,
): Promise<DragonTigerResult> {
  const stake = assertBetAmount(betAmount);
  const side = assertBetOn(betOn);

  // 1. Deal (pure computation, nothing written yet).
  const serverSeed = generateServerSeed();
  const clientSeed = generateClientSeed();
  const serverSeedHash = hashServerSeed(serverSeed);

  const [dragonCard, tigerCard] = drawPair(serverSeed, clientSeed);
  const dragonRank = cardRank(dragonCard);
  const tigerRank = cardRank(tigerCard);
  const winner = compareCards(dragonCard, tigerCard);

  // A tie is a loss for Dragon and Tiger — only the Tie bet collects.
  const won = winner === side;
  const multiplier = won ? dragonTigerPayouts()[side] : 0;
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
      dragonCard,
      tigerCard,
      winner,
      multiplier,
      payout,
      serverSeedHash,
    });

    return roundMoney(balance - stake + payout);
  });

  return {
    dragonCard,
    tigerCard,
    dragonRank,
    tigerRank,
    winner,
    betOn: side,
    outcome: won ? 'won' : 'lost',
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
  betOn: DragonTigerBet;
  dragonCard: DragonTigerCard;
  tigerCard: DragonTigerCard;
  winner: DragonTigerWinner;
  multiplier: number;
  payout: number;
  serverSeedHash: string;
};

/**
 * Persists the round audit row (ledger rows are written by the wallet service).
 * `bet_value` keeps the side, `result` keeps the winner and both cards, e.g.
 * `dragon|D:KS|T:9H`.
 */
async function insertRound(client: PoolClient, data: RoundData): Promise<void> {
  await client.query(
    `INSERT INTO game_rounds
       (id, user_id, bet_amount, bet_type, bet_value, result, payout, multiplier, server_seed_hash)
     VALUES ($1, $2, $3, 'dragontiger', $4, $5, $6, $7, $8)`,
    [
      data.roundId,
      data.userId,
      moneyString(data.betAmount),
      data.betOn,
      `${data.winner}|D:${data.dragonCard}|T:${data.tigerCard}`,
      moneyString(data.payout),
      moneyString(data.multiplier),
      data.serverSeedHash,
    ],
  );
}

function assertBetOn(betOn: unknown): DragonTigerBet {
  if (betOn !== 'dragon' && betOn !== 'tiger' && betOn !== 'tie') {
    throw new AppError(
      'VALIDATION_ERROR',
      400,
      "betOn: Must be 'dragon', 'tiger' or 'tie'",
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
