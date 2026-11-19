import { query } from '../../../config/db.js';

export type GameHistoryRound = {
  id: string;
  /** Canonical game slug ('slots', 'spin', 'mines', 'blackjack', 'red', …). */
  game: string;
  betAmount: number;
  /** Null for blackjack (its table has no multiplier column). */
  multiplier: number | null;
  /** Gross amount credited (stake included); 0 on a loss, = betAmount on a push. */
  payout: number;
  createdAt: string;
};

type Row = {
  id: string;
  game: string;
  bet_amount: string | number;
  multiplier: string | number | null;
  payout: string | number;
  created_at: Date | string;
  total: string | number;
};

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * Newest-first bet history for a player, unified across the three round tables:
 * `game_rounds` (the 15 instant games), `mines_games` and `blackjack_games`.
 * In-flight rounds (Aviator `pending`, Mines/Blackjack `active`) are excluded.
 */
export async function listGameHistory(
  userId: string,
  limit: number,
  offset: number,
): Promise<{ rounds: GameHistoryRound[]; total: number; limit: number; offset: number }> {
  const safeLimit = clampLimit(limit);
  const safeOffset = Math.max(0, Math.floor(Number.isFinite(offset) ? offset : 0));

  const result = await query<Row>(
    `WITH history AS (
       SELECT id, 'blackjack'::text AS game, bet_amount, NULL::numeric AS multiplier, payout, created_at
         FROM blackjack_games
        WHERE user_id = $1 AND status <> 'active'
       UNION ALL
       SELECT id, 'mines'::text AS game, bet_amount, multiplier, payout, created_at
         FROM mines_games
        WHERE user_id = $1 AND status <> 'active'
       UNION ALL
       SELECT id, bet_type::text AS game, bet_amount, multiplier, payout, created_at
         FROM game_rounds
        WHERE user_id = $1 AND status <> 'pending'
     )
     SELECT id, game, bet_amount, multiplier, payout, created_at, COUNT(*) OVER() AS total
       FROM history
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3`,
    [userId, safeLimit, safeOffset],
  );

  const total = result.rows[0] ? Number(result.rows[0].total) : 0;
  const rounds = result.rows.map(mapRound);

  return { rounds, total, limit: safeLimit, offset: safeOffset };
}

function mapRound(row: Row): GameHistoryRound {
  return {
    id: row.id,
    game: row.game,
    betAmount: Number(row.bet_amount),
    multiplier: row.multiplier === null ? null : Number(row.multiplier),
    payout: Number(row.payout),
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit) || Number(limit) <= 0) {
    return DEFAULT_LIMIT;
  }
  return Math.min(Math.floor(Number(limit)), MAX_LIMIT);
}