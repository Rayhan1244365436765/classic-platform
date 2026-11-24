-- =============================================================================
-- 024_payment_details.sql
-- Casino Platform — bKash / Nagad deposit details on payment_requests
--
-- A player sends money to the operator's bKash/Nagad number, then files a deposit
-- request carrying the Transaction ID (TrxID) and the number they paid from, so
-- the operator can verify the payment in the real app before approving.
--
-- Additive and idempotent (safe to re-run). Existing rows keep NULL details and
-- get payment_method = 'bkash' from the default.
--
-- Apply with: psql "$DATABASE_URL" -f backend/migrations/024_payment_details.sql
-- =============================================================================

BEGIN;

ALTER TABLE payment_requests
    ADD COLUMN IF NOT EXISTS trx_id         VARCHAR(40),
    ADD COLUMN IF NOT EXISTS sender_number  VARCHAR(20),
    ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20) NOT NULL DEFAULT 'bkash';

ALTER TABLE payment_requests
    DROP CONSTRAINT IF EXISTS payment_requests_method_check;
ALTER TABLE payment_requests
    ADD CONSTRAINT payment_requests_method_check
        CHECK (payment_method IN ('bkash', 'nagad'));

-- One TrxID can only back one live request, otherwise the same payment could be
-- approved (credited) twice. Rejected requests release their TrxID so a player
-- can correct a typo and resubmit.
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_requests_trx
    ON payment_requests (payment_method, upper(trx_id))
 WHERE trx_id IS NOT NULL AND status <> 'rejected';

COMMENT ON COLUMN payment_requests.trx_id         IS 'bKash/Nagad Transaction ID supplied by the player (deposits).';
COMMENT ON COLUMN payment_requests.sender_number  IS 'Mobile number the player paid from (deposits).';
COMMENT ON COLUMN payment_requests.payment_method IS 'bkash | nagad. Only meaningful for deposits.';

COMMIT;
