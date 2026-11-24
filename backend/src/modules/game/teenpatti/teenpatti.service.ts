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
 * Teen Patti — 3 cards each against the dealer.
 *
 * Hand ranking, highest first: **trail** (three of a kind) → **pure sequence**
 * (straight flush) → **sequence** (run) → **colour** (flush) → **pair** → **high
 * card**. Aces are high, A-2-3 is the lowest run and Q-K-A the highest, and suits
 * never break a tie (two hands with the same ranks are a tie).
 *
 * --- why the payout carries a rake ----------------------------------------
 * Both hands come from the same deck, so the match is **symmetric**:
 * P(player) = P(dealer) = (1 − P(tie))/2. An even-money win (2×) with a refunded
 * tie therefore returns exactly:
 *
 *   2·P(win) + 1·P(tie) = (1 − t) + t = 1.0000   → a **zero-edge free bet**
 *
 * Ties are rare in Teen Patti (0.1008%, counted exactly below), so the refund
 * adds almost nothing. A **5% rake on the win** — 2× less 5% of the 1× profit =
 * **1.95×**, the same treatment the Banker gets in baccarat — is what gives the
 * house its edge:
 *
 *   1.95 · P(win) + 1 · P(tie) = 1.95 · 0.499496 + 0.001008 = 97.50% RTP (2.50% edge)
 *
 * `TEEN_PATTI_RAKE = 0` restores the literal 2× and makes the table exactly
 * break-even. `backend/scripts/verify-teenpatti.cjs` reproduces every figure
 * here by enumerating all 22,100 hands and counting the tie pairs.
 *
 * --- the odds --------------------------------------------------------------
 * `teenPattiOdds()` recomputes them at runtime: enumerate every 3-card hand,
 * group by score, and count the **card-disjoint** pairs in each group (two hands
 * can only tie when they share no card). Hand frequencies:
 *
 *   trail 0.24% · pure sequence 0.22% · sequence 3.26% · colour 4.96%
 *   pair 16.94% · high card 74.39%
 */

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const;
const SUITS = ['S', 'H', 'D', 'C'] as const;

/** Cards in the deck. */
export const DECK_SIZE = 52;
/** Cards per hand. */
export const HAND_SIZE = 3;

/** Even-money win before the rake. */
export const WIN_MULTIPLIER = 2;
/** Rake on the 1× profit, i.e. 2× − 5% = 1.95× paid. */
export const TEEN_PATTI_RAKE = 0.05;
/** What a win actually pays. */
export const PAYOUT_MULTIPLIER = WIN_MULTIPLIER - TEEN_PATTI_RAKE;

/** Rake on the win: admin-configurable (`teenpatti` row), falling back to 5%. */
export function teenPattiRake(): number {
  return getGameConfig<{ rake: number }>('teenpatti')?.rake ?? TEEN_PATTI_RAKE;
}

/** What a win returns per unit staked (2× less the rake). */
export function teenPattiPayout(): number {
  return WIN_MULTIPLIER - teenPattiRake();
}

/** Hand categories, highest value wins. */
export const TEEN_PATTI_CATEGORIES = {
  high: 1,
  pair: 2,
  colour: 3,
  sequence: 4,
  pureSequence: 5,
  trail: 6,
} as const;

export type TeenPattiCategory = keyof typeof TEEN_PATTI_CATEGORIES;

/** Category names in display order, best first. */
export const TEEN_PATTI_RANKING: TeenPattiCategory[] = [
  'trail',
  'pureSequence',
  'sequence',
  'colour',
  'pair',
  'high',
];

/** Human labels for the table. */
export const CATEGORY_LABELS: Record<TeenPattiCategory, string> = {
  trail: 'Trail',
  pureSequence: 'Pure Sequence',
  sequence: 'Sequence',
  colour: 'Colour',
  pair: 'Pair',
  high: 'High Card',
};

export type TeenPattiWinner = 'player' | 'dealer' | 'tie';
export type TeenPattiOutcome = 'won' | 'lost' | 'push';
/** Card code, e.g. `"AS"` (ace of spades) or `"TH"` (ten of hearts). */
export type TeenPattiCard = string;

/** A comparable hand: category first, then up to three tiebreak ranks. */
export type HandScore = {
  category: TeenPattiCategory;
  /** Numeric category — higher beats lower. */
  rank: number;
  /** Descending tiebreak values, padded to three entries. */
  tiebreak: [number, number, number];
};

export type TeenPattiResult = {
  playerHand: TeenPattiCard[];
  dealerHand: TeenPattiCard[];
  playerCategory: TeenPattiCategory;
  dealerCategory: TeenPattiCategory;
  playerHandLabel: string;
  dealerHandLabel: string;
  winner: TeenPattiWinner;
  outcome: TeenPattiOutcome;
  /** 1.95 on a win, 1 on a tie (refund), 0 on a loss. */
  multiplier: number;
  payout: number;
  betAmount: number;
  balanceAfter: number;
  serverSeedHash: string;
  roundId: string;
};

/** Rank value: 2 … 10, J = 11, Q = 12, K = 13, A = 14 (aces high). */
export function rankValue(card: TeenPattiCard): number {
  const rank = card.slice(0, -1);

  if (rank === 'A') return 14;
  if (rank === 'T') return 10;
  if (rank === 'J') return 11;
  if (rank === 'Q') return 12;
  if (rank === 'K') return 13;

  return Number(rank);
}

/** Score one three-card hand. */
export function scoreHand(cards: readonly TeenPattiCard[]): HandScore {
  if (cards.length !== HAND_SIZE) {
    throw new Error(`a Teen Patti hand has ${HAND_SIZE} cards, got ${cards.length}`);
  }

  const values = cards.map(rankValue).sort((a, b) => b - a);
  const high = values[0]!;
  const mid = values[1]!;
  const low = values[2]!;

  const suits = cards.map((card) => card.slice(-1));
  const flush = suits[0] === suits[1] && suits[1] === suits[2];

  const isTrail = high === low;
  const isPair = !isTrail && (high === mid || mid === low);

  // Consecutive ranks, with A-2-3 as the lowest run.
  let runHigh = 0;
  if (!isTrail && !isPair) {
    if (high === 14 && mid === 3 && low === 2) {
      runHigh = 3;
    } else if (high === mid + 1 && mid === low + 1) {
      runHigh = high;
    }
  }

  if (isTrail) {
    return { category: 'trail', rank: TEEN_PATTI_CATEGORIES.trail, tiebreak: [high, 0, 0] };
  }

  if (runHigh > 0 && flush) {
    return {
      category: 'pureSequence',
      rank: TEEN_PATTI_CATEGORIES.pureSequence,
      tiebreak: [runHigh, 0, 0],
    };
  }

  if (runHigh > 0) {
    return {
      category: 'sequence',
      rank: TEEN_PATTI_CATEGORIES.sequence,
      tiebreak: [runHigh, 0, 0],
    };
  }

  if (flush) {
    return { category: 'colour', rank: TEEN_PATTI_CATEGORIES.colour, tiebreak: [high, mid, low] };
  }

  if (isPair) {
    const pairRank = high === mid ? high : mid;
    const kicker = high === mid ? low : high;

    return {
      category: 'pair',
      rank: TEEN_PATTI_CATEGORIES.pair,
      tiebreak: [pairRank, kicker, 0],
    };
  }

  return { category: 'high', rank: TEEN_PATTI_CATEGORIES.high, tiebreak: [high, mid, low] };
}

/** +1 when `a` beats `b`, −1 when it loses, 0 on a tie. */
export function compareScores(a: HandScore, b: HandScore): number {
  if (a.rank !== b.rank) return a.rank > b.rank ? 1 : -1;

  for (let index = 0; index < 3; index += 1) {
    const left = a.tiebreak[index]!;
    const right = b.tiebreak[index]!;
    if (left !== right) return left > right ? 1 : -1;
  }

  return 0;
}

/** Provably-fair Fisher–Yates shuffle of a fresh 52-card deck. */
function buildShoe(serverSeed: string, clientSeed: string): TeenPattiCard[] {
  const shoe: TeenPattiCard[] = RANKS.flatMap((rank) => SUITS.map((suit) => `${rank}${suit}`));

  for (let index = shoe.length - 1; index > 0; index -= 1) {
    const roll = generateProvablyFairFloat(serverSeed, clientSeed, index + 1);
    const swap = Math.floor(roll * (index + 1));
    const current = shoe[index]!;
    shoe[index] = shoe[swap]!;
    shoe[swap] = current;
  }

  return shoe;
}

export type TeenPattiOdds = {
  /** Share of deals that tie. */
  tieRate: number;
  /** Share of deals the player wins — equals `loseRate` by symmetry. */
  winRate: number;
  loseRate: number;
  rtp: number;
  houseEdge: number;
  /** RTP if the rake were removed — the spec's literal 2× (exactly 1.0). */
  rtpWithoutRake: number;
  /** 22,100 possible hands. */
  hands: number;
  /** C(52,3)·C(49,3) ordered (player, dealer) hand pairs. */
  orderedPairs: number;
  tiePairs: number;
  /** Share of all hands in each category. */
  frequencies: Record<TeenPattiCategory, number>;
};

let cachedOdds: TeenPattiOdds | null = null;
/** Unrounded win/tie rates behind `cachedOdds`, so a rake change keeps full precision. */
let cachedRates: { winRate: number; tieRate: number } | null = null;

/**
 * Exact head-to-head odds, recomputed from the deck rather than hard-coded.
 *
 * Enumerate all 22,100 hands once, group them by score, then count the pairs
 * inside each group that share no card — only those can be dealt and tie. The
 * match is symmetric, so P(player) = P(dealer) = (1 − tieRate)/2.
 */
export function teenPattiOdds(): TeenPattiOdds {
  // The hand enumeration is expensive and rake-independent: cache it once and
  // re-derive only the rake-dependent figures (cheap) on every call.
  const base = enumerateTeenPattiOdds();
  const { winRate, tieRate } = cachedRates!;
  const rakedRtp = teenPattiPayout() * winRate + tieRate;

  return { ...base, rtp: round4(rakedRtp), houseEdge: round4(1 - rakedRtp) };
}

/** RTP for any rake — used by the admin panel to preview a change before saving. */
export function teenPattiRtpForRake(rake: number): number {
  enumerateTeenPattiOdds();
  const { winRate, tieRate } = cachedRates!;

  return (WIN_MULTIPLIER - rake) * winRate + tieRate;
}

function enumerateTeenPattiOdds(): TeenPattiOdds {
  if (cachedOdds) return cachedOdds;

  const deck: TeenPattiCard[] = RANKS.flatMap((rank) => SUITS.map((suit) => `${rank}${suit}`));
  const hands: { index: number[]; score: HandScore }[] = [];
  const counts: Record<TeenPattiCategory, number> = {
    trail: 0,
    pureSequence: 0,
    sequence: 0,
    colour: 0,
    pair: 0,
    high: 0,
  };
  const groups = new Map<string, number[][]>();

  for (let first = 0; first < deck.length; first += 1) {
    for (let second = first + 1; second < deck.length; second += 1) {
      for (let third = second + 1; third < deck.length; third += 1) {
        const index = [first, second, third];
        const cards = [deck[first]!, deck[second]!, deck[third]!];
        const score = scoreHand(cards);

        counts[score.category] += 1;
        hands.push({ index, score });

        const key = `${score.rank}:${score.tiebreak.join(',')}`;
        const group = groups.get(key);
        if (group) group.push(index);
        else groups.set(key, [index]);
      }
    }
  }

  // Ties: same score, no shared card.
  const disjoint = (a: readonly number[], b: readonly number[]): boolean =>
    a[0] !== b[0] &&
    a[0] !== b[1] &&
    a[0] !== b[2] &&
    a[1] !== b[0] &&
    a[1] !== b[1] &&
    a[1] !== b[2] &&
    a[2] !== b[0] &&
    a[2] !== b[1] &&
    a[2] !== b[2];

  let tiePairs = 0;
  for (const group of groups.values()) {
    for (const player of group) {
      for (const dealer of group) {
        if (disjoint(player, dealer)) tiePairs += 1;
      }
    }
  }

  const handCount = hands.length;
  const remainingHands = (49 * 48 * 47) / 6; // C(49,3) once the player holds three cards
  const orderedPairs = handCount * remainingHands;

  const tieRate = tiePairs / orderedPairs;
  const winRate = (1 - tieRate) / 2;
  // Both computed from the unrounded rates — 2·P(win) + P(tie) is exactly 1.
  const rakedRtp = PAYOUT_MULTIPLIER * winRate + tieRate;

  cachedRates = { winRate, tieRate };
  cachedOdds = {
    tieRate: round4(tieRate),
    winRate: round4(winRate),
    loseRate: round4(winRate),
    rtp: round4(rakedRtp),
    houseEdge: round4(1 - rakedRtp),
    rtpWithoutRake: round4(WIN_MULTIPLIER * winRate + tieRate),
    hands: handCount,
    orderedPairs,
    tiePairs,
    frequencies: {
      trail: round4(counts.trail / handCount),
      pureSequence: round4(counts.pureSequence / handCount),
      sequence: round4(counts.sequence / handCount),
      colour: round4(counts.colour / handCount),
      pair: round4(counts.pair / handCount),
      high: round4(counts.high / handCount),
    },
  };

  return cachedOdds;
}

/** Payouts, ranking and exact odds — everything the client renders. */
export function teenPattiConfig(): {
  deckSize: number;
  handSize: number;
  winMultiplier: number;
  rake: number;
  payoutMultiplier: number;
  tieRefunds: boolean;
  ranking: { id: TeenPattiCategory; label: string }[];
  odds: TeenPattiOdds;
} {
  const odds = teenPattiOdds();

  return {
    deckSize: DECK_SIZE,
    handSize: HAND_SIZE,
    winMultiplier: WIN_MULTIPLIER,
    rake: teenPattiRake(),
    payoutMultiplier: teenPattiPayout(),
    tieRefunds: true,
    ranking: TEEN_PATTI_RANKING.map((id) => ({ id, label: CATEGORY_LABELS[id] })),
    odds,
  };
}

/** Play one Teen Patti hand. */
export async function playTeenPatti(
  userId: string,
  betAmount: number,
): Promise<TeenPattiResult> {
  const stake = assertBetAmount(betAmount);

  // 1. Shuffle and deal (pure computation, nothing written yet).
  const serverSeed = generateServerSeed();
  const clientSeed = generateClientSeed();
  const serverSeedHash = hashServerSeed(serverSeed);

  const shoe = buildShoe(serverSeed, clientSeed);
  const draw = (): TeenPattiCard => {
    const card = shoe.pop();
    if (!card) {
      throw new AppError('SHOE_EXHAUSTED', 500, 'The deck ran out of cards');
    }

    return card;
  };

  const playerHand = [draw(), draw(), draw()];
  const dealerHand = [draw(), draw(), draw()];

  const playerScore = scoreHand(playerHand);
  const dealerScore = scoreHand(dealerHand);
  const comparison = compareScores(playerScore, dealerScore);
  const winner: TeenPattiWinner = comparison > 0 ? 'player' : comparison < 0 ? 'dealer' : 'tie';

  // A win pays 1.95× (2× less the rake), a tie refunds the stake, a loss pays 0.
  const multiplier = winner === 'player' ? teenPattiPayout() : winner === 'tie' ? 1 : 0;
  const outcome: TeenPattiOutcome = winner === 'player' ? 'won' : winner === 'tie' ? 'push' : 'lost';
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
      playerHand,
      dealerHand,
      playerCategory: playerScore.category,
      dealerCategory: dealerScore.category,
      winner,
      multiplier,
      payout,
      serverSeedHash,
    });

    return roundMoney(balance - stake + payout);
  });

  return {
    playerHand,
    dealerHand,
    playerCategory: playerScore.category,
    dealerCategory: dealerScore.category,
    playerHandLabel: CATEGORY_LABELS[playerScore.category],
    dealerHandLabel: CATEGORY_LABELS[dealerScore.category],
    winner,
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
  playerHand: TeenPattiCard[];
  dealerHand: TeenPattiCard[];
  playerCategory: TeenPattiCategory;
  dealerCategory: TeenPattiCategory;
  winner: TeenPattiWinner;
  multiplier: number;
  payout: number;
  serverSeedHash: string;
};

/**
 * Persists the round audit row (ledger rows are written by the wallet service).
 * `bet_value` is unused — there is no side to pick — and `result` keeps the
 * winner, both categories and both hands, e.g.
 * `player|pair/high|P:AS,AH,KD|D:7C,9H,KS`.
 */
async function insertRound(client: PoolClient, data: RoundData): Promise<void> {
  await client.query(
    `INSERT INTO game_rounds
       (id, user_id, bet_amount, bet_type, bet_value, result, payout, multiplier, server_seed_hash)
     VALUES ($1, $2, $3, 'teenpatti', NULL, $4, $5, $6, $7)`,
    [
      data.roundId,
      data.userId,
      moneyString(data.betAmount),
      `${data.winner}|${data.playerCategory}/${data.dealerCategory}|P:${data.playerHand.join(
        ',',
      )}|D:${data.dealerHand.join(',')}`,
      moneyString(data.payout),
      moneyString(data.multiplier),
      data.serverSeedHash,
    ],
  );
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

/** Probabilities and RTP keep four decimals — two would flatten 97.50% to 98%. */
function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function moneyString(amount: number): string {
  return roundMoney(amount).toFixed(2);
}
