-- =============================================================================
-- 026_withdraw_details.sql
-- Casino Platform — where a withdrawal should be paid out (bKash / Nagad)
--
-- A withdrawal request now carries the provider the player wants to be paid
-- through (`payment_method`, already added by 024) and the mobile number that
-- should receive the money (`receiver_number`, new here) so the operator knows
-- exactly where to send it.
--
-- Ledger behaviour is unchanged: the debit is still written when the request is
-- filed, and a rejection still refunds it. This only adds payout details.
--
-- Additive and idempotent (safe to re-run). Existing withdrawal rows keep a NULL
-- receiver_number (they were filed before the number was collected) and stay
-- approvable / rejectable exactly as before.
--
-- Apply with: psql "$DATABASE_URL" -f backend/migrations/026_withdraw_details.sql
-- =============================================================================

BEGIN;

ALTER TABLE payment_requests
    ADD COLUMN IF NOT EXISTS receiver_number VARCHAR(20);

ALTER TABLE payment_requests
    DROP CONSTRAINT IF EXISTS payment_requests_receiver_number_check;
ALTER TABLE payment_requests
    ADD CONSTRAINT payment_requests_receiver_number_check
        CHECK (receiver_number IS NULL OR receiver_number ~ '^01[3-9][0-9]{8}$');

COMMENT ON COLUMN payment_requests.receiver_number IS 'Bangladeshi mobile number (01XXXXXXXXX) the operator pays a withdrawal out to. NULL for deposits and for withdrawals filed before 026.';
COMMENT ON COLUMN payment_requests.payment_method  IS 'bkash | nagad. Deposits: the provider the player paid through. Withdrawals: the provider to pay out through (meaningful only when receiver_number is set).';

COMMIT;
