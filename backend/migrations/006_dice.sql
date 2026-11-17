-- =============================================================================
-- 006_dice.sql
-- Dice (High/Low) rounds reuse `game_rounds` and need their own bet type.
--
--   * bet_type = 'dice'
--   * bet_value = the call ('high' | 'low')
--   * result    = the rolled number (1–100)
--
-- Apply with: psql "$DATABASE_URL" -f backend/migrations/006_dice.sql
-- =============================================================================

BEGIN;

ALTER TABLE game_rounds DROP CONSTRAINT IF EXISTS game_rounds_bet_type_check;

ALTER TABLE game_rounds
    ADD CONSTRAINT game_rounds_bet_type_check
    CHECK (bet_type IN (
        'red', 'black', 'green', 'even', 'odd', 'low', 'high',
        'number', 'spin', 'slots', 'dice'
    ));

COMMIT;
