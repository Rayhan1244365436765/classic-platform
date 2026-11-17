-- =============================================================================
-- 011_keno.sql
-- Keno settles instantly, so it reuses `game_rounds`.
--
--   bet_type  — new value 'keno'
--   bet_value — the player's picks (e.g. "3,17,42,58"), widened from 10 chars
--   result    — the 20 drawn numbers (e.g. "1,4,7,…")
--
-- Apply with: psql "$DATABASE_URL" -f backend/migrations/011_keno.sql
-- =============================================================================

BEGIN;

ALTER TABLE game_rounds
    ALTER COLUMN bet_value TYPE VARCHAR(64);

ALTER TABLE game_rounds DROP CONSTRAINT IF EXISTS game_rounds_bet_type_check;

ALTER TABLE game_rounds
    ADD CONSTRAINT game_rounds_bet_type_check
    CHECK (bet_type IN (
        'red', 'black', 'green', 'even', 'odd', 'low', 'high',
        'number', 'spin', 'slots', 'dice', 'aviator', 'plinko', 'keno'
    ));

COMMIT;
