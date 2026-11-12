-- =============================================================================
-- 001_initial_schema.sql
-- Casino Platform — initial MVP database schema
-- Target: PostgreSQL 16 (works on PostgreSQL 13+)
--
-- Apply with:  psql "$DATABASE_URL" -f backend/migrations/001_initial_schema.sql
--
-- Design rules honoured by this schema:
--   1. Money is stored as NUMERIC(18,2) — never floating point.
--   2. User balances are NEVER stored on the users row. The balance is derived
--      from the transactions ledger (SUM of completed amounts).
--   3. transactions is append-only: a correction is a new row, not an UPDATE.
-- =============================================================================

BEGIN;

-- Required for uuid_generate_v4()
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- -----------------------------------------------------------------------------
-- 1. users
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id            UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    phone         VARCHAR(20)  NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role          VARCHAR(20)  NOT NULL DEFAULT 'user',
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT users_phone_key  UNIQUE (phone),
    CONSTRAINT users_role_check CHECK (role IN ('user', 'admin'))
);

CREATE INDEX IF NOT EXISTS idx_users_phone ON users (phone);

COMMENT ON TABLE  users               IS 'Platform accounts: players (role=user) and operators (role=admin).';
COMMENT ON COLUMN users.phone         IS 'E.164-style phone number, unique. Primary login identifier.';
COMMENT ON COLUMN users.password_hash IS 'Password hash (bcrypt). Never store plaintext passwords.';
COMMENT ON COLUMN users.role          IS 'Authorization role: user | admin.';

-- -----------------------------------------------------------------------------
-- 2. transactions  (append-only wallet ledger)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transactions (
    id           UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id      UUID          NOT NULL,
    type         VARCHAR(20)   NOT NULL,
    amount       NUMERIC(18,2) NOT NULL,
    status       VARCHAR(20)   NOT NULL DEFAULT 'completed',
    reference_id VARCHAR(64),
    created_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),

    CONSTRAINT transactions_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT transactions_type_check
        CHECK (type IN ('deposit', 'withdraw', 'bet', 'win')),
    CONSTRAINT transactions_status_check
        CHECK (status IN ('pending', 'completed', 'failed', 'cancelled')),
    CONSTRAINT transactions_amount_nonzero_check
        CHECK (amount <> 0),
    -- Sign convention: credits are positive, debits are negative.
    CONSTRAINT transactions_amount_sign_check
        CHECK (
            (type IN ('deposit', 'win')  AND amount > 0) OR
            (type IN ('withdraw', 'bet') AND amount < 0)
        )
);

CREATE INDEX IF NOT EXISTS idx_transactions_user_created
    ON transactions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_type
    ON transactions (type);
CREATE INDEX IF NOT EXISTS idx_transactions_status
    ON transactions (status);
CREATE INDEX IF NOT EXISTS idx_transactions_reference_id
    ON transactions (reference_id) WHERE reference_id IS NOT NULL;

COMMENT ON TABLE  transactions              IS 'Append-only money ledger. A user balance is SUM(amount) over completed rows.';
COMMENT ON COLUMN transactions.amount       IS 'Signed money amount: positive = credit (deposit, win), negative = debit (bet, withdraw).';
COMMENT ON COLUMN transactions.status       IS 'pending | completed | failed | cancelled. Only completed rows count toward the balance.';
COMMENT ON COLUMN transactions.reference_id IS 'Correlation key, e.g. a game_rounds.id or a payment provider id.';

-- -----------------------------------------------------------------------------
-- 3. game_rounds  (Roulette)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS game_rounds (
    id               UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id          UUID          NOT NULL,
    bet_amount       NUMERIC(18,2) NOT NULL,
    bet_type         VARCHAR(20)   NOT NULL,
    bet_value        VARCHAR(10),
    result           VARCHAR(10),
    payout           NUMERIC(18,2) NOT NULL DEFAULT 0,
    server_seed_hash VARCHAR(64)   NOT NULL,
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),

    CONSTRAINT game_rounds_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT game_rounds_bet_amount_check
        CHECK (bet_amount > 0),
    CONSTRAINT game_rounds_bet_type_check
        CHECK (bet_type IN ('red', 'black', 'green', 'even', 'odd', 'low', 'high', 'number')),
    CONSTRAINT game_rounds_payout_check
        CHECK (payout >= 0),
    CONSTRAINT game_rounds_server_seed_hash_check
        CHECK (server_seed_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_game_rounds_user_created
    ON game_rounds (user_id, created_at DESC);

COMMENT ON TABLE  game_rounds                  IS 'One European roulette round per row.';
COMMENT ON COLUMN game_rounds.bet_value        IS 'Bet parameter, e.g. ''7'' for number bets; NULL for even-money bets.';
COMMENT ON COLUMN game_rounds.result           IS 'Winning pocket or colour, e.g. ''7'' or ''red''. NULL until settled.';
COMMENT ON COLUMN game_rounds.payout           IS 'Total amount credited back to the player (stake included). 0 on a loss.';
COMMENT ON COLUMN game_rounds.server_seed_hash IS 'Lowercase hex SHA-256 of the server seed, published before the spin (commitment).';

-- -----------------------------------------------------------------------------
-- 4. Derived helper view: current balance per user
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW account_balances AS
SELECT
    u.id                                      AS user_id,
    COALESCE(SUM(t.amount), 0)::NUMERIC(18,2) AS balance,
    COUNT(t.id)                               AS transaction_count,
    MAX(t.created_at)                         AS last_transaction_at
FROM users u
LEFT JOIN transactions t
       ON t.user_id = u.id
      AND t.status = 'completed'
GROUP BY u.id;

COMMENT ON VIEW account_balances IS 'Read-only derived balances. The single source of truth is the transactions ledger.';

-- -----------------------------------------------------------------------------
-- 5. Keep users.updated_at fresh
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_set_updated_at ON users;
CREATE TRIGGER trg_users_set_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

COMMIT;


