-- =============================================================================
-- 021_fortune_gems.sql
-- Fortune Gems settles instantly on the shared `game_rounds` table:
--
--   bet_type  — new value 'fortune_gems'
--   bet_value — NULL (the reels decide; the player has no decision to record)
--   result    — the twelve symbols, row-major, 4 per row,
--               e.g. '🪙🪙🧧💎🪙🪙🎋🏮💰🧧🪙👑'
--
-- `multiplier` is the summed cluster pay (0.00, 11.00, 22.00, 37.00 …) and
-- `payout` the amount credited.
--
-- Apply with: psql "$DATABASE_URL" -f backend/migrations/021_fortune_gems.sql
-- =============================================================================

BEGIN;

ALTER TABLE game_rounds DROP CONSTRAINT IF EXISTS game_rounds_bet_type_check;

ALTER TABLE game_rounds
    ADD CONSTRAINT game_rounds_bet_type_check
    CHECK (bet_type IN (
        'red', 'black', 'green', 'even', 'odd', 'low', 'high',
        'number', 'spin', 'slots', 'dice', 'aviator', 'plinko', 'keno',
        'baccarat', 'dragontiger', 'teenpatti', 'cascade', 'classic_roulette',
        'fruit_bonanza', 'dice3d', 'boxing_king', 'fortune_gems'
    ));

COMMIT;
