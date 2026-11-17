-- =============================================================================
-- 016_classic_roulette.sql
-- Classic European roulette (37 pockets) settles instantly, so it reuses
-- `game_rounds`:
--
--   bet_type  — new value 'classic_roulette'
--   bet_value — what the player backed: 'number:17', 'red', 'black', 'even',
--               'odd', 'low' or 'high'
--   result    — the pocket that came up and its colour, e.g. '17|black'
--
-- `multiplier` holds 36.00 (straight number), 2.00 (even-money bets) or 0.00.
--
-- Apply with: psql "$DATABASE_URL" -f backend/migrations/016_classic_roulette.sql
-- =============================================================================

BEGIN;

ALTER TABLE game_rounds DROP CONSTRAINT IF EXISTS game_rounds_bet_type_check;

ALTER TABLE game_rounds
    ADD CONSTRAINT game_rounds_bet_type_check
    CHECK (bet_type IN (
        'red', 'black', 'green', 'even', 'odd', 'low', 'high',
        'number', 'spin', 'slots', 'dice', 'aviator', 'plinko', 'keno',
        'baccarat', 'dragontiger', 'teenpatti', 'cascade', 'classic_roulette'
    ));

COMMIT;
