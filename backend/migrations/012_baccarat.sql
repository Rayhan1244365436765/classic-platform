-- =============================================================================
-- 012_baccarat.sql
-- Baccarat settles instantly, so it reuses `game_rounds`:
--
--   bet_type  — new value 'baccarat'
--   bet_value — the side bet: 'player', 'banker' or 'tie'
--   result    — the winner and both hands, e.g. 'banker|P:AS,5H|B:KH,2C,7S'
--
-- `multiplier` holds 2.00 (player), 1.95 (banker, 5% commission), 8.00 (tie) or
-- 1.00 (push — a tie returns Player/Banker stakes).
--
-- Apply with: psql "$DATABASE_URL" -f backend/migrations/012_baccarat.sql
-- =============================================================================

BEGIN;

ALTER TABLE game_rounds DROP CONSTRAINT IF EXISTS game_rounds_bet_type_check;

ALTER TABLE game_rounds
    ADD CONSTRAINT game_rounds_bet_type_check
    CHECK (bet_type IN (
        'red', 'black', 'green', 'even', 'odd', 'low', 'high',
        'number', 'spin', 'slots', 'dice', 'aviator', 'plinko', 'keno', 'baccarat'
    ));

COMMIT;
