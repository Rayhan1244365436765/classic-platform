-- =============================================================================
-- 013_dragontiger.sql
-- Dragon Tiger settles instantly, so it reuses `game_rounds`:
--
--   bet_type  — new value 'dragontiger'
--   bet_value — the side bet: 'dragon', 'tiger' or 'tie'
--   result    — the winner and both cards, e.g. 'dragon|D:KS|T:9H'
--
-- `multiplier` holds 2.00 (dragon/tiger) or 8.00 (tie); 0 on a loss — including
-- a tie, which loses Dragon and Tiger bets.
--
-- Apply with: psql "$DATABASE_URL" -f backend/migrations/013_dragontiger.sql
-- =============================================================================

BEGIN;

ALTER TABLE game_rounds DROP CONSTRAINT IF EXISTS game_rounds_bet_type_check;

ALTER TABLE game_rounds
    ADD CONSTRAINT game_rounds_bet_type_check
    CHECK (bet_type IN (
        'red', 'black', 'green', 'even', 'odd', 'low', 'high',
        'number', 'spin', 'slots', 'dice', 'aviator', 'plinko', 'keno',
        'baccarat', 'dragontiger'
    ));

COMMIT;
