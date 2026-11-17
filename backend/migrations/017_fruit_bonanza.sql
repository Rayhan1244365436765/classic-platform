-- =============================================================================
-- 017_fruit_bonanza.sql
-- Fruit Bonanza settles instantly on the shared `game_rounds` table:
--
--   bet_type  — new value 'fruit_bonanza'
--   bet_value — NULL (the reels decide; the player has no decision to record)
--   result    — the nine symbols, row-major, e.g. '🍉🍇🍋🍒🍊⭐🍉🍇🍋'
--
-- `multiplier` is the return multiple of the spin stake (0.00 … 4.00) and
-- `payout` the amount credited.
--
-- Apply with: psql "$DATABASE_URL" -f backend/migrations/017_fruit_bonanza.sql
-- =============================================================================

BEGIN;

ALTER TABLE game_rounds DROP CONSTRAINT IF EXISTS game_rounds_bet_type_check;

ALTER TABLE game_rounds
    ADD CONSTRAINT game_rounds_bet_type_check
    CHECK (bet_type IN (
        'red', 'black', 'green', 'even', 'odd', 'low', 'high',
        'number', 'spin', 'slots', 'dice', 'aviator', 'plinko', 'keno',
        'baccarat', 'dragontiger', 'teenpatti', 'cascade', 'classic_roulette',
        'fruit_bonanza'
    ));

COMMIT;
