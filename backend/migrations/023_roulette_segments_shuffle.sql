-- =============================================================================
-- 023_roulette_segments_shuffle.sql
-- Spin-to-Win: interleave winning and losing slices so the wheel looks fair.
--
-- The probability of each multiplier is unchanged — this only reorders the same
-- multiset of segments (RTP stays 90%: Σ = 18 over 20 slices). It updates the row
-- only when it still holds the original grouped order, so an admin-customised
-- table is never overwritten.
--
-- Apply with: psql "$DATABASE_URL" -f backend/migrations/023_roulette_segments_shuffle.sql
-- =============================================================================

BEGIN;

UPDATE game_configs
SET config = '{"segments": [10,0,0.5,0,0,2,0,0.5,0,0,3,0,0.5,0,0,1,0,0.5,0,0]}'::jsonb
WHERE id = 'roulette'
  AND config = '{"segments": [10,3,2,1,0.5,0.5,0.5,0.5,0,0,0,0,0,0,0,0,0,0,0,0]}'::jsonb;

COMMIT;