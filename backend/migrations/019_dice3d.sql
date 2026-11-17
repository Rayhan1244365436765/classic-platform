-- =============================================================================
-- 019_dice3d.sql
-- 3D Dice settles instantly on the shared `game_rounds` table:
--
--   bet_type  — new value 'dice3d'
--   bet_value — the call: 'high', 'low' or the backed total ('15')
--   result    — the three dice plus their total, e.g. '4,2,3|9'
--
-- `multiplier` holds the return multiple of the stake (0.00, 2.00, 210.00 …).
--
-- Apply with: psql "$DATABASE_URL" -f backend/migrations/019_dice3d.sql
-- =============================================================================

BEGIN;

ALTER TABLE game_rounds DROP CONSTRAINT IF EXISTS game_rounds_bet_type_check;

ALTER TABLE game_rounds
    ADD CONSTRAINT game_rounds_bet_type_check
    CHECK (bet_type IN (
        'red', 'black', 'green', 'even', 'odd', 'low', 'high',
        'number', 'spin', 'slots', 'dice', 'aviator', 'plinko', 'keno',
        'baccarat', 'dragontiger', 'teenpatti', 'cascade', 'classic_roulette',
        'fruit_bonanza', 'dice3d'
    ));

COMMIT;
