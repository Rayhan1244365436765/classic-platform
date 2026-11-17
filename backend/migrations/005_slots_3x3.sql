-- =============================================================================
-- 005_slots_3x3.sql
-- Lucky Slots became a 3×3 grid (9 reels), so `game_rounds.result` must hold
-- nine symbols instead of three.
--
--   '🍒🍋🍇⭐💎🍒🍋🍇⭐'  = 9 characters
--   '7️⃣7️⃣7️⃣7️⃣7️⃣7️⃣7️⃣7️⃣7️⃣' = 27 characters (U+0037 + FE0F + 20E3 each)
--
-- VARCHAR(64) leaves room for future 5×5 grids as well.
--
-- Apply with: psql "$DATABASE_URL" -f backend/migrations/005_slots_3x3.sql
-- =============================================================================

BEGIN;

ALTER TABLE game_rounds
    ALTER COLUMN result TYPE VARCHAR(64);

COMMENT ON COLUMN game_rounds.result
    IS 'What landed: wheel multiplier (''10'') for spins, or the row-major reel grid (''🍒🍋…'', 9 cells) for slots.';

COMMIT;
