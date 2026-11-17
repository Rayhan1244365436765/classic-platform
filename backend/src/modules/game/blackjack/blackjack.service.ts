import crypto from 'node:crypto';

import type { PoolClient } from 'pg';

import {
  generateClientSeed,
  generateProvablyFairFloat,
  generateServerSeed,
  hashServerSeed,
} from '../../../common/provably-fair/index.js';
import { AppError } from '../../../common/utils/AppError.js';
import { query, withTransaction } from '../../../config/db.js';
import { createTransaction, getBalance, lockUser } from '../../wallet/wallet.service.js';

/**
 * Blackjack — single-deck, one player against the house.
 *
 * Rules implemented (as specified):
 *   * win  → payout 2× the bet (even money, no 3:2 bonus on a natural)
 *   * push → the bet is returned
 *   * loss → nothing is credited
 *   * the dealer reveals and draws until reaching **17 or more** (stands on all
 *     17s, including soft 17)
 *   * a natural (21 with the first two cards) settles immediately at `start`:
 *     both naturals push, player-only wins, dealer-only loses
 *   * hitting to exactly 21 auto-stands (there is nothing left to decide)
 *
 * The 52-card shoe is a provably-fair Fisher–Yates shuffle of one committed
 * seed, and the remaining shoe is stored with the game — the hole card and the
 * undealt cards never leave the server until the hand is over.
 */

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K'] as const;
const SUITS = ['S', 'H', 'D', 'C'] as const;

export const DEALER_STANDS_ON = 17;
export const WIN_MULTIPLIER = 2;

export type BlackjackStatus = 'active' | 'won' | 'lost' | 'push';
export type Card = string;

export type HandScore = { total: number; soft: boolean };

export type BlackjackState = {
  gameId: string;
  betAmount: number;
  playerHand: Card[];
  playerTotal: number;
  /** Only the up-card while the hand is active. */
  dealerHand: Card[];
  dealerTotal: number | null;
  status: BlackjackStatus;
  playerBlackjack: boolean;
  dealerBlackjack: boolean;
  payout: number;
  balanceAfter: number;
  serverSeedHash: string;
};

/** Best value of a hand: aces count 11 until that would bust. */
export function handScore(cards: readonly Card[]): HandScore {
  let total = 0;
  let aces = 0;

  for (const card of cards) {
    const rank = card.slice(0, -1);
    if (rank === 'A') {
      aces += 1;
      total += 11;
    } else if (rank === 'T' || rank === 'J' || rank === 'Q' || rank === 'K') {
      total += 10;
    } else {
      total += Number(rank);
    }
  }

  let soft = aces > 0;
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
    soft = aces > 0;
  }

  return { total, soft };
}

/** Provably-fair shuffle of a fresh 52-card shoe. */
function buildShoe(serverSeed: string, clientSeed: string): Card[] {
  const shoe: Card[] = RANKS.flatMap((rank) => SUITS.map((suit) => `${rank}${suit}`));

  for (let index = shoe.length - 1; index > 0; index -= 1) {
    const roll = generateProvablyFairFloat(serverSeed, clientSeed, index + 1);
    const swap = Math.floor(roll * (index + 1));
    const current = shoe[index]!;
    shoe[index] = shoe[swap]!;
    shoe[swap] = current;
  }

  return shoe;
}

function isNatural(cards: readonly Card[]): boolean {
  return cards.length === 2 && handScore(cards).total === 21;
}

/** Dealer reveals the hole card and hits until 17+. */
function playDealer(dealerHand: Card[], shoe: Card[]): { hand: Card[]; shoe: Card[] } {
  const hand = [...dealerHand];
  const deck = [...shoe];

  while (handScore(hand).total < DEALER_STANDS_ON) {
    const card = deck.pop();
    if (!card) {
      throw new AppError('SHOE_EXHAUSTED', 500, 'The shoe ran out of cards');
    }
    hand.push(card);
  }

  return { hand, shoe: deck };
}

/** Win/lose/push for a finished hand. */
function settle(
  playerHand: readonly Card[],
  dealerHand: readonly Card[],
  betAmount: number,
): { status: BlackjackStatus; payout: number } {
  const player = handScore(playerHand).total;
  const dealer = handScore(dealerHand).total;

  if (player > 21) {
    return { status: 'lost', payout: 0 };
  }

  if (dealer > 21) {
    return { status: 'won', payout: roundMoney(betAmount * WIN_MULTIPLIER) };
  }

  if (player > dealer) {
    return { status: 'won', payout: roundMoney(betAmount * WIN_MULTIPLIER) };
  }

  if (player < dealer) {
    return { status: 'lost', payout: 0 };
  }

  // Tie: the stake comes back.
  return { status: 'push', payout: roundMoney(betAmount) };
}

type GameRow = {
  id: string;
  bet_amount: string | number;
  player_hand: Card[];
  dealer_hand: Card[];
  deck: Card[];
  status: BlackjackStatus;
  payout: string | number;
};

/** Deal a new hand. Debits the stake and hides the hole card. */
export async function startGame(userId: string, betAmount: number): Promise<BlackjackState> {
  const stake = assertBetAmount(betAmount);

  const serverSeed = generateServerSeed();
  const clientSeed = generateClientSeed();
  const serverSeedHash = hashServerSeed(serverSeed);

  const shoe = buildShoe(serverSeed, clientSeed);
  const playerHand: Card[] = [shoe.pop()!, shoe.pop()!];
  const dealerHand: Card[] = [shoe.pop()!, shoe.pop()!];
  const gameId = crypto.randomUUID();

  // Natural 21s settle immediately: both push, player-only wins, dealer-only loses.
  const playerNatural = isNatural(playerHand);
  const dealerNatural = isNatural(dealerHand);
  let status: BlackjackStatus = 'active';
  let payout = 0;

  if (playerNatural || dealerNatural) {
    if (playerNatural && dealerNatural) {
      status = 'push';
      payout = stake;
    } else if (playerNatural) {
      status = 'won';
      payout = roundMoney(stake * WIN_MULTIPLIER);
    } else {
      status = 'lost';
    }
  }

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

    // One hand at a time — the player must finish the current one.
    const active = await client.query<{ id: string }>(
      `SELECT id FROM blackjack_games WHERE user_id = $1 AND status = 'active' LIMIT 1`,
      [userId],
    );

    if ((active.rowCount ?? 0) > 0) {
      throw new AppError(
        'GAME_IN_PROGRESS',
        409,
        'You already have an open hand — finish it (or GET /game/blackjack/current)',
      );
    }

    await createTransaction(client, {
      userId,
      type: 'bet',
      amount: -stake,
      referenceId: gameId,
    });

    if (payout > 0) {
      await createTransaction(client, {
        userId,
        type: 'win',
        amount: payout,
        referenceId: gameId,
      });
    }

    await client.query(
      `INSERT INTO blackjack_games
         (id, user_id, bet_amount, player_hand, dealer_hand, deck, status, payout,
          server_seed_hash, settled_at)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7, $8, $9, $10)`,
      [
        gameId,
        userId,
        moneyString(stake),
        JSON.stringify(playerHand),
        JSON.stringify(dealerHand),
        JSON.stringify(shoe),
        status,
        moneyString(payout),
        serverSeedHash,
        status === 'active' ? null : new Date().toISOString(),
      ],
    );

    return roundMoney(balance - stake + payout);
  });

  return {
    gameId,
    betAmount: stake,
    playerHand,
    playerTotal: handScore(playerHand).total,
    dealerHand: status === 'active' ? [dealerHand[0]!] : dealerHand,
    dealerTotal: status === 'active' ? null : handScore(dealerHand).total,
    status,
    playerBlackjack: playerNatural,
    dealerBlackjack: dealerNatural,
    payout,
    balanceAfter,
    serverSeedHash,
  };
}

/** Take one card. Busting (or reaching 21) ends the hand. */
export async function hit(userId: string, gameId: string): Promise<BlackjackState> {
  return withTransaction(async (client) => {
    await lockUser(client, userId);

    const game = await lockGame(client, gameId, userId);
    if (game.status !== 'active') {
      throw new AppError('GAME_ALREADY_SETTLED', 409, `Hand already ${game.status}`);
    }

    const playerHand = [...game.player_hand];
    const shoe = [...game.deck];
    const stake = roundMoney(Number(game.bet_amount));

    const card = shoe.pop();
    if (!card) {
      throw new AppError('SHOE_EXHAUSTED', 500, 'The shoe ran out of cards');
    }
    playerHand.push(card);

    const playerTotal = handScore(playerHand).total;

    // Bust → immediate loss, hole card still hidden.
    if (playerTotal > 21) {
      return finish(client, {
        userId,
        gameId,
        playerHand,
        dealerHand: game.dealer_hand,
        shoe,
        status: 'lost',
        payout: 0,
        revealDealer: false,
        stake,
      });
    }

    // Exactly 21 → nothing left to decide, so the dealer plays out now.
    if (playerTotal === 21) {
      const dealt = playDealer(game.dealer_hand, shoe);
      const outcome = settle(playerHand, dealt.hand, stake);

      return finish(client, {
        userId,
        gameId,
        playerHand,
        dealerHand: dealt.hand,
        shoe: dealt.shoe,
        status: outcome.status,
        payout: outcome.payout,
        revealDealer: true,
        stake,
      });
    }

    await client.query(
      `UPDATE blackjack_games SET player_hand = $2::jsonb, deck = $3::jsonb WHERE id = $1`,
      [gameId, JSON.stringify(playerHand), JSON.stringify(shoe)],
    );

    const balance = await getBalance(userId, client);

    return {
      gameId,
      betAmount: stake,
      playerHand,
      playerTotal,
      dealerHand: [game.dealer_hand[0]!],
      dealerTotal: null,
      status: 'active',
      playerBlackjack: false,
      dealerBlackjack: false,
      payout: 0,
      balanceAfter: balance,
      serverSeedHash: '',
    };
  });
}

/** Stand: the dealer reveals and draws to 17+, then the hand is compared. */
export async function stand(userId: string, gameId: string): Promise<BlackjackState> {
  return withTransaction(async (client) => {
    await lockUser(client, userId);

    const game = await lockGame(client, gameId, userId);
    if (game.status !== 'active') {
      throw new AppError('GAME_ALREADY_SETTLED', 409, `Hand already ${game.status}`);
    }

    const stake = roundMoney(Number(game.bet_amount));
    const dealt = playDealer(game.dealer_hand, game.deck);
    const outcome = settle(game.player_hand, dealt.hand, stake);

    return finish(client, {
      userId,
      gameId,
      playerHand: [...game.player_hand],
      dealerHand: dealt.hand,
      shoe: dealt.shoe,
      status: outcome.status,
      payout: outcome.payout,
      revealDealer: true,
      stake,
    });
  });
}

/** The hand the player can resume (page reload, second tab, …). */
export async function getActiveGame(userId: string): Promise<BlackjackState | null> {
  const result = await query<GameRow>(
    `SELECT id, bet_amount, player_hand, dealer_hand, deck, status, payout
       FROM blackjack_games
      WHERE user_id = $1 AND status = 'active'
      ORDER BY created_at DESC
      LIMIT 1`,
    [userId],
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  const playerHand = row.player_hand ?? [];
  const dealerHand = row.dealer_hand ?? [];

  return {
    gameId: row.id,
    betAmount: roundMoney(Number(row.bet_amount)),
    playerHand,
    playerTotal: handScore(playerHand).total,
    dealerHand: dealerHand.slice(0, 1),
    dealerTotal: null,
    status: 'active',
    playerBlackjack: false,
    dealerBlackjack: false,
    payout: 0,
    balanceAfter: 0,
    serverSeedHash: '',
  };
}

type FinishArgs = {
  userId: string;
  gameId: string;
  playerHand: Card[];
  dealerHand: Card[];
  shoe: Card[];
  status: BlackjackStatus;
  payout: number;
  /** Bust keeps the hole card face-down; every other ending reveals it. */
  revealDealer: boolean;
  stake: number;
};

/** Writes the settled hand, credits the payout and returns the public state. */
async function finish(client: PoolClient, args: FinishArgs): Promise<BlackjackState> {
  if (args.payout > 0) {
    await createTransaction(client, {
      userId: args.userId,
      type: 'win',
      amount: args.payout,
      referenceId: args.gameId,
    });
  }

  await client.query(
    `UPDATE blackjack_games
        SET player_hand = $2::jsonb, dealer_hand = $3::jsonb, deck = $4::jsonb,
            status = $5, payout = $6, settled_at = now()
      WHERE id = $1`,
    [
      args.gameId,
      JSON.stringify(args.playerHand),
      JSON.stringify(args.dealerHand),
      JSON.stringify(args.shoe),
      args.status,
      moneyString(args.payout),
    ],
  );

  const balance = await getBalance(args.userId, client);

  return {
    gameId: args.gameId,
    betAmount: args.stake,
    playerHand: args.playerHand,
    playerTotal: handScore(args.playerHand).total,
    dealerHand: args.revealDealer ? args.dealerHand : args.dealerHand.slice(0, 1),
    dealerTotal: args.revealDealer ? handScore(args.dealerHand).total : null,
    status: args.status,
    playerBlackjack: isNatural(args.playerHand),
    dealerBlackjack: args.revealDealer ? isNatural(args.dealerHand) : false,
    payout: args.payout,
    balanceAfter: balance,
    serverSeedHash: '',
  };
}

/** Row-locks the hand so hit/stand can never interleave. */
async function lockGame(
  client: PoolClient,
  gameId: string,
  userId: string,
): Promise<GameRow> {
  const result = await client.query<GameRow>(
    `SELECT id, bet_amount, player_hand, dealer_hand, deck, status, payout
       FROM blackjack_games
      WHERE id = $1 AND user_id = $2
      FOR UPDATE`,
    [gameId, userId],
  );

  const row = result.rows[0];
  if (!row) {
    throw new AppError('GAME_NOT_FOUND', 404, 'Hand does not exist');
  }

  return row;
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



