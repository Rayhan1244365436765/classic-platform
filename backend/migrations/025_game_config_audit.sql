-- =============================================================================
-- 025_game_config_audit.sql
-- Audit trail for admin game-config (RTP) changes.
--
-- `game_configs` (022) already holds one JSONB config per game and is reused for
-- every game; this table only records who changed what, and when, so an RTP
-- change can always be traced and reverted. Additive and idempotent.
--
-- Apply with: psql "$DATABASE_URL" -f backend/migrations/025_game_config_audit.sql
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS game_config_audit (
    id              BIGSERIAL     PRIMARY KEY,
    game_id         TEXT          NOT NULL,
    previous_config JSONB,
    new_config      JSONB         NOT NULL,
    rtp             NUMERIC(10,6),
    changed_by      UUID          REFERENCES users (id) ON DELETE SET NULL,
    changed_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_game_config_audit_game_changed
    ON game_config_audit (game_id, changed_at DESC);

COMMENT ON TABLE  game_config_audit                 IS 'Who changed which game config, when, and the RTP it produced.';
COMMENT ON COLUMN game_config_audit.previous_config IS 'NULL when the game ran on its built-in defaults before this change.';
COMMENT ON COLUMN game_config_audit.rtp             IS 'Headline RTP of new_config (NULL for games whose RTP depends on play, e.g. blackjack).';

COMMIT;
