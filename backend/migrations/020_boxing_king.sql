-- =============================================================================
-- 020_boxing_king.sql
-- Boxing King settles instantly on the shared `game_rounds` table:
--
--   bet_type  — new value 'boxing_king'
--   bet_value — NULL (the board decides; the player has no decision to record)
--   result    — the nine symbols, row-major, e.g. '🥊🥊🥊🏆🤴💪💥🩳🏆'
--
-- `multiplier` is the summed cluster pay (0.00, 2.00, 4.00, 10.50 …).
--
-- Apply with: psql "$DATABASE_URL" -f backend/migrations/020_boxing_king.sql
-- =============================================================================

BEGIN;

ALTER TABLE game_rounds DROP CONSTRAINT IF EXISTS game_rounds_bet_type_check;

ALTER TABLE game_rounds
    ADD CONSTRAINT game_rounds_bet_type_check
    CHECK (bet_type IN (
        'red', 'black', 'green', 'even', 'odd', 'low', 'high',
        'number', 'spin', 'slots', 'dice', 'aviator', 'plinko', 'keno',
        'baccarat', 'dragontiger', 'teenpatti', 'cascade', 'classic_roulette',
        'fruit_bonanza', 'dice3d', 'boxing_king'
    ));

COMMIT;
