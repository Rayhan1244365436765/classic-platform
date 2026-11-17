-- =============================================================================
-- 004_slots.sql
-- Lucky Slots rounds reuse `game_rounds` and need their own bet type.
--
--   * bet_type = 'slots'
--   * result    = the three symbols the reels stopped on (e.g. '🍒🍒🍇')
--   * multiplier/payout follow the same convention as the wheel.
--
-- Apply with: psql "$DATABASE_URL" -f backend/migrations/004_slots.sql
-- =============================================================================

BEGIN;

ALTER TABLE game_rounds DROP CONSTRAINT IF EXISTS game_rounds_bet_type_check;

ALTER TABLE game_rounds
    ADD CONSTRAINT game_rounds_bet_type_check
    CHECK (bet_type IN (
        'red', 'black', 'green', 'even', 'odd', 'low', 'high', 'number', 'spin', 'slots'
    ));

COMMIT;
