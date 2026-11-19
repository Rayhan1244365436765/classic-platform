-- =============================================================================
-- 022_game_configs.sql
-- Admin-tunable game configuration (RTP control).
--
-- One row per game slug; `config` is a JSONB blob holding the game-specific knob:
--   slots    -> { "lineMultiplier": 10.8 }     (RTP = lineMultiplier / 12)
--   roulette -> { "segments": [...] }          (RTP = Σ(segments) / 20)
--
-- The hard-coded constants in each game service remain as the fallback; the rows
-- seeded below mirror them on first boot.
--
-- Apply with: psql "$DATABASE_URL" -f backend/migrations/022_game_configs.sql
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS game_configs (
    id          TEXT PRIMARY KEY,
    config      JSONB NOT NULL,
    updated_by  UUID REFERENCES users (id) ON DELETE SET NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO game_configs (id, config)
VALUES
    ('slots',    '{"lineMultiplier": 10.8}'::jsonb),
    ('roulette', '{"segments": [10,3,2,1,0.5,0.5,0.5,0.5,0,0,0,0,0,0,0,0,0,0,0,0]}'::jsonb)
ON CONFLICT (id) DO NOTHING;

COMMIT;