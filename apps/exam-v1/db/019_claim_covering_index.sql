-- Covering index for the worker claim query: ORDER BY kind='run' DESC, created_at
-- with the stale-reclaim check on claimed_at. Replaces a sort on the filtered
-- set under burst load (200+ concurrent submissions).
CREATE INDEX CONCURRENTLY IF NOT EXISTS submissions_claim_idx
  ON submissions (kind DESC, created_at, claimed_at)
  WHERE status IN ('queued', 'running');
