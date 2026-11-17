-- =============================================================================
-- 015_cascade.sql
-- Showdown (cascading cluster-pays slot) settles instantly, so it reuses
-- `game_rounds`:
--
--   bet_type  — new value 'cascade'
--   bet_value — unused (one bet per spin), stays NULL
--   result    — '<cascades>c|<deepest multiplier>x|<total win>x', e.g. '3c|4x|2.41x'
--
-- `multiplier` holds the total win in bet multiples (the paytable is expressed
-- that way), and `payout` holds the money actually credited.
--
-- Apply with: psql "$DATABASE_URL" -f backend/migrations/015_cascade.sql
-- =============================================================================

BEGIN;

ALTER TABLE game_rounds DROP CONSTRAINT IF EXISTS game_rounds_bet_type_check;

ALTER TABLE game_rounds
    ADD CONSTRAINT game_rounds_bet_type_check
    CHECK (bet_type IN (
        'red', 'black', 'green', 'even', 'odd', 'low', 'high',
        'number', 'spin', 'slots', 'dice', 'aviator', 'plinko', 'keno',
        'baccarat', 'dragontiger', 'teenpatti', 'cascade'
    ));

COMMIT;
