-- =============================================================================
-- 002_payment_requests.sql
-- Casino Platform — manual deposit/withdraw requests (pre-gateway bridge)
--
-- A player files a request; an operator approves or rejects it. Money only moves
-- when a request is settled:
--   * deposit  : approved -> credit  (a 'deposit' row is written)
--   * withdraw : debited immediately when requested (so the funds cannot be spent
--                twice), refunded with a 'deposit' row if rejected.
--
-- Apply with: psql "$DATABASE_URL" -f backend/migrations/002_payment_requests.sql
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS payment_requests (
    id          UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID          NOT NULL,
    amount      NUMERIC(18,2) NOT NULL,
    type        VARCHAR(20)   NOT NULL,
    status      VARCHAR(20)   NOT NULL DEFAULT 'pending',
    reviewed_by UUID,
    reviewed_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),

    CONSTRAINT payment_requests_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT payment_requests_reviewed_by_fkey
        FOREIGN KEY (reviewed_by) REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT payment_requests_amount_check
        CHECK (amount > 0),
    CONSTRAINT payment_requests_type_check
        CHECK (type IN ('deposit', 'withdraw')),
    CONSTRAINT payment_requests_status_check
        CHECK (status IN ('pending', 'approved', 'rejected'))
);

-- Operator queue: oldest pending first.
CREATE INDEX IF NOT EXISTS idx_payment_requests_status_created
    ON payment_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_requests_user_created
    ON payment_requests (user_id, created_at DESC);

COMMENT ON TABLE  payment_requests             IS 'Manual deposit/withdraw requests awaiting operator review.';
COMMENT ON COLUMN payment_requests.amount      IS 'Always positive; the direction comes from `type`.';
COMMENT ON COLUMN payment_requests.status      IS 'pending | approved | rejected. Only pending rows appear in the admin queue.';
COMMENT ON COLUMN payment_requests.reviewed_by IS 'Admin user who approved/rejected the request (audit trail).';

-- Reuse the trigger function created in 001_initial_schema.sql.
DROP TRIGGER IF EXISTS trg_payment_requests_set_updated_at ON payment_requests;
CREATE TRIGGER trg_payment_requests_set_updated_at
    BEFORE UPDATE ON payment_requests
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

COMMIT;
