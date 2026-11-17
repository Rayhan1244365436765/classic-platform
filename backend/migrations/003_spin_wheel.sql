-- =============================================================================
-- 003_spin_wheel.sql
-- "Spin to Win" lucky wheel: game_rounds stores the landed multiplier.
--
--   * `multiplier` — the segment value the wheel stopped on (0 … 10).
--   * `bet_type`   — new value 'spin' for wheel rounds (old values retained so
--                    historical roulette rows stay valid).
--
-- Apply with: psql "$DATABASE_URL" -f backend/migrations/003_spin_wheel.sql
-- =============================================================================

BEGIN;

ALTER TABLE game_rounds
    ADD COLUMN IF NOT EXISTS multiplier NUMERIC(6,2);

COMMENT ON COLUMN game_rounds.multiplier
    IS 'Wheel segment multiplier for "spin" rounds (0 = total loss, 1 = stake back).';

ALTER TABLE game_rounds DROP CONSTRAINT IF EXISTS game_rounds_bet_type_check;

ALTER TABLE game_rounds
    ADD CONSTRAINT game_rounds_bet_type_check
    CHECK (bet_type IN (
        'red', 'black', 'green', 'even', 'odd', 'low', 'high', 'number', 'spin'
    ));

COMMIT;
