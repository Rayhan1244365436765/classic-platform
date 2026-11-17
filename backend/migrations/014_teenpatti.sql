-- =============================================================================
-- 014_teenpatti.sql
-- Teen Patti settles instantly, so it reuses `game_rounds`:
--
--   bet_type  — new value 'teenpatti'
--   bet_value — unused (there is no side to pick), stays NULL
--   result    — winner, both hand categories and both hands, e.g.
--               'player|pair/high|P:AS,AH,KD|D:7C,9H,KS'
--
-- `multiplier` holds 1.95 (win, 2× less the 5% rake), 1.00 (tie — stake
-- refunded) or 0.00 (loss).
--
-- Apply with: psql "$DATABASE_URL" -f backend/migrations/014_teenpatti.sql
-- =============================================================================

BEGIN;

ALTER TABLE game_rounds DROP CONSTRAINT IF EXISTS game_rounds_bet_type_check;

ALTER TABLE game_rounds
    ADD CONSTRAINT game_rounds_bet_type_check
    CHECK (bet_type IN (
        'red', 'black', 'green', 'even', 'odd', 'low', 'high',
        'number', 'spin', 'slots', 'dice', 'aviator', 'plinko', 'keno',
        'baccarat', 'dragontiger', 'teenpatti'
    ));

COMMIT;
