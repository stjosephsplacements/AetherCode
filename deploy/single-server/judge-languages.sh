#!/bin/bash
# Enables the exam languages in Judge for the configured engine. Judge accepts
# a submission only when its language key is listed and enabled in
# judge.language_mappings; each engine adapter maps the key to its runtime.
# Runs after judge-migrate on every `up`; it is idempotent.
set -euo pipefail

case "$JUDGE_ENGINE" in
  judge0) version="1.13.1" ;;                       # the Judge0 release the stack runs
  piston) version="newest-installed-runtime" ;;     # piston-packages.js installs the newest
  *) echo "unsupported JUDGE_ENGINE: $JUDGE_ENGINE" >&2; exit 1 ;;
esac

# Judge0 language IDs (also used as stable IDs for Piston rows).
psql -v ON_ERROR_STOP=1 -h judge-db -U aether_judge_admin -d aether_judge_wrapper <<SQL
INSERT INTO judge.language_mappings (language_key, engine_name, engine_language_id, engine_version, enabled, max_parallelism)
VALUES
    ('c', '$JUDGE_ENGINE', 50, '$version', true, $JUDGE_WORKER_CONCURRENCY),
    ('cpp17', '$JUDGE_ENGINE', 54, '$version', true, $JUDGE_WORKER_CONCURRENCY),
    ('java', '$JUDGE_ENGINE', 62, '$version', true, $JUDGE_WORKER_CONCURRENCY),
    ('python3', '$JUDGE_ENGINE', 71, '$version', true, $JUDGE_WORKER_CONCURRENCY),
    ('javascript', '$JUDGE_ENGINE', 63, '$version', true, $JUDGE_WORKER_CONCURRENCY),
    ('go', '$JUDGE_ENGINE', 60, '$version', true, $JUDGE_WORKER_CONCURRENCY)
ON CONFLICT (language_key) DO UPDATE
SET engine_name = EXCLUDED.engine_name, engine_language_id = EXCLUDED.engine_language_id,
    engine_version = EXCLUDED.engine_version, enabled = true,
    max_parallelism = EXCLUDED.max_parallelism, updated_at = clock_timestamp();
SQL
echo "judge languages enabled for $JUDGE_ENGINE"
