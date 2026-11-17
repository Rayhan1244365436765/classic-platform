-- =============================================================================
-- 007_aviator.sql
-- Aviator needs a real round lifecycle: a hidden crash point, a server-side
-- start timestamp (cash-out validity is derived from it) and a status so a
-- round can be pending → cashed_out / crashed.
--
-- Existing rows and the other games always settle immediately, so `status`
-- defaults to 'settled' — no change is needed in those modules.
--
-- Apply with: psql "$DATABASE_URL" -f backend/migrations/007_aviator.sql
-- =============================================================================

BEGIN;

ALTER TABLE game_rounds
    ADD COLUMN IF NOT EXISTS crash_point NUMERIC(10,2),
    ADD COLUMN IF NOT EXISTS started_at  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS settled_at  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS status      VARCHAR(12) NOT NULL DEFAULT 'settled';

COMMENT ON COLUMN game_rounds.crash_point
    IS 'Aviator only: the hidden burst multiplier, revealed once the round settles.';
COMMENT ON COLUMN game_rounds.started_at
    IS 'Aviator only: server timestamp the round opened; cash-out validity uses now() - started_at.';
COMMENT ON COLUMN game_rounds.settled_at
    IS 'Aviator only: when the round was cashed out or burst.';
COMMENT ON COLUMN game_rounds.status
    IS 'pending (flying) | cashed_out | crashed | settled (instant games).';

ALTER TABLE game_rounds DROP CONSTRAINT IF EXISTS game_rounds_bet_type_check;

ALTER TABLE game_rounds
    ADD CONSTRAINT game_rounds_bet_type_check
    CHECK (bet_type IN (
        'red', 'black', 'green', 'even', 'odd', 'low', 'high',
        'number', 'spin', 'slots', 'dice', 'aviator'
    ));

ALTER TABLE game_rounds DROP CONSTRAINT IF EXISTS game_rounds_status_check;

ALTER TABLE game_rounds
    ADD CONSTRAINT game_rounds_status_check
    CHECK (status IN ('pending', 'cashed_out', 'crashed', 'settled'));

-- Fast lookup for "is this player still flying?" + abandoned-round cleanup.
CREATE INDEX IF NOT EXISTS idx_game_rounds_pending
    ON game_rounds (user_id, bet_type)
    WHERE status = 'pending';

COMMIT;
