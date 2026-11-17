-- =============================================================================
-- 008_mines.sql
-- Mines keeps its own game state (a 25-cell board per round) instead of using
-- the instant-round `game_rounds` table.
--
--   grid_state     JSONB  — 25 booleans, true = mine (never sent before settle)
--   revealed_tiles JSONB  — indices of safe tiles the player opened
--   status         active → won | lost
--   multiplier     the multiplier locked in when the game settles
--
-- Apply with: psql "$DATABASE_URL" -f backend/migrations/008_mines.sql
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS mines_games (
    id               UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id          UUID          NOT NULL,
    bet_amount       NUMERIC(18,2) NOT NULL,
    mines_count      SMALLINT      NOT NULL,
    grid_state       JSONB         NOT NULL,
    revealed_tiles   JSONB         NOT NULL DEFAULT '[]'::jsonb,
    status           VARCHAR(10)   NOT NULL DEFAULT 'active',
    multiplier       NUMERIC(14,2) NOT NULL DEFAULT 1,
    payout           NUMERIC(18,2) NOT NULL DEFAULT 0,
    server_seed_hash VARCHAR(64)   NOT NULL,
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    settled_at       TIMESTAMPTZ,

    CONSTRAINT mines_games_user_fkey
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT mines_games_bet_check
        CHECK (bet_amount > 0),
    CONSTRAINT mines_games_mines_check
        CHECK (mines_count BETWEEN 1 AND 24),
    CONSTRAINT mines_games_status_check
        CHECK (status IN ('active', 'won', 'lost')),
    CONSTRAINT mines_games_payout_check
        CHECK (payout >= 0),
    CONSTRAINT mines_games_seed_check
        CHECK (server_seed_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_mines_games_user_status
    ON mines_games (user_id, status);

CREATE INDEX IF NOT EXISTS idx_mines_games_user_created
    ON mines_games (user_id, created_at DESC);

COMMIT;
