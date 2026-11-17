-- =============================================================================
-- 009_plinko.sql
-- Plinko settles instantly, so it reuses `game_rounds` and only needs its own
-- bet type (`bet_value` keeps the row count, `result` keeps the ball path).
--
-- Apply with: psql "$DATABASE_URL" -f backend/migrations/009_plinko.sql
-- =============================================================================

BEGIN;

ALTER TABLE game_rounds DROP CONSTRAINT IF EXISTS game_rounds_bet_type_check;

ALTER TABLE game_rounds
    ADD CONSTRAINT game_rounds_bet_type_check
    CHECK (bet_type IN (
        'red', 'black', 'green', 'even', 'odd', 'low', 'high',
        'number', 'spin', 'slots', 'dice', 'aviator', 'plinko'
    ));

COMMIT;
