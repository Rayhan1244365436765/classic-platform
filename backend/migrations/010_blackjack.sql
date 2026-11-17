-- =============================================================================
-- 010_blackjack.sql
-- Blackjack is turn-based (hit / stand), so it keeps its own table like Mines.
--
--   player_hand / dealer_hand — card codes, e.g. ["AS","TH"]
--   deck                      — the remaining cards of the shuffled 52-card shoe
--   status                    — active → won | lost | push
--
-- Apply with: psql "$DATABASE_URL" -f backend/migrations/010_blackjack.sql
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS blackjack_games (
    id               UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id          UUID          NOT NULL,
    bet_amount       NUMERIC(18,2) NOT NULL,
    player_hand      JSONB         NOT NULL DEFAULT '[]'::jsonb,
    dealer_hand      JSONB         NOT NULL DEFAULT '[]'::jsonb,
    deck             JSONB         NOT NULL,
    status           VARCHAR(10)   NOT NULL DEFAULT 'active',
    payout           NUMERIC(18,2) NOT NULL DEFAULT 0,
    server_seed_hash VARCHAR(64)   NOT NULL,
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    settled_at       TIMESTAMPTZ,

    CONSTRAINT blackjack_games_user_fkey
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT blackjack_games_bet_check
        CHECK (bet_amount > 0),
    CONSTRAINT blackjack_games_status_check
        CHECK (status IN ('active', 'won', 'lost', 'push')),
    CONSTRAINT blackjack_games_payout_check
        CHECK (payout >= 0),
    CONSTRAINT blackjack_games_seed_check
        CHECK (server_seed_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_blackjack_games_user_status
    ON blackjack_games (user_id, status);

CREATE INDEX IF NOT EXISTS idx_blackjack_games_user_created
    ON blackjack_games (user_id, created_at DESC);

COMMIT;
