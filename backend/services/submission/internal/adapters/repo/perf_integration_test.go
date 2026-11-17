//go:build integration

package repo_test

import (
	"context"
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stjosephsplacements/AetherCode/libs/pkg/testutil/integration"
	"github.com/stretchr/testify/require"
)

// TestExamPeakLatency is the database half of the exam-peak benchmark (run with AETHER_PERF=1,
// it is skipped otherwise). It seeds a campus-sized exam and drives the hottest write, the
// webcam snapshot, from many concurrent candidates through a post-validation approximation of the signed-context path, then
// prints the plans of the hot lookups. Numbers are for comparing changes on one machine, not an
// SLA: the gateway, the authorization decision and the network sit outside this test.
func TestExamPeakLatency(t *testing.T) {
	if os.Getenv("AETHER_PERF") == "" {
		t.Skip("set AETHER_PERF=1 to run the exam-peak benchmark")
	}
	ctx := context.Background()
	pool := startSubmissionDatabase(ctx, t)
	const candidates, framesPerAttempt = 1000, 20

	// Temp tables are per-connection; use one connection for seeding.
	seed, err := pool.Acquire(ctx)
	require.NoError(t, err)
	for _, statement := range []string{
		`CREATE TEMP TABLE bench_candidates AS
		   SELECT gen_random_uuid() AS candidate_id, gen_random_uuid() AS attempt_id, gen_random_uuid() AS assignment_id, n FROM generate_series(1, ` + fmt.Sprint(candidates) + `) AS n`,
		`INSERT INTO authz.actor_tenant_authorizations (actor_id, tenant_id, authz_revision, is_authorized, grant_kind, grant_source_id)
		   SELECT candidate_id, '` + unitTenantID + `', 1, true, 'tenant', '` + unitTenantID + `' FROM bench_candidates`,
		`INSERT INTO authz.principal_authorization_revisions (actor_id, authz_revision) SELECT candidate_id, 1 FROM bench_candidates`,
		`UPDATE authz.authorization_projection_resync_state
		   SET projection_ready = true, active_resync_id = gen_random_uuid(), completion_event_id = gen_random_uuid(),
		       expected_snapshot_count = 0, expected_manifest_sha256 = decode(repeat('00', 32), 'hex') WHERE singleton = true`,
		// Project each assignment through the real routine, with a policy, so get_attempt_proctor_policy returns its normal row.
		`SELECT submission.apply_assignment_snapshot(gen_random_uuid(), '` + unitTenantID + `', assignment_id, candidate_id,
		       '018f4b0d-08f8-7c09-9ba7-efdf9c340a01', '018f4b0d-08f8-7c09-9ba7-efdf9c340a02',
		       clock_timestamp() - interval '1 hour', clock_timestamp() + interval '2 hours', 1::smallint, 'active', 1, '[` + executableItem("018f4b0d-08f8-7c09-9ba7-efdf9c340a03") + `]'::jsonb, NULL, NULL, NULL)
		   FROM bench_candidates`,
		`SELECT submission.set_assignment_proctor_policy('` + unitTenantID + `', assignment_id,
		       (SELECT version FROM submission.assignment_projections WHERE candidate_assignment_id = bench_candidates.assignment_id), '{"max_violations":3}')
		   FROM bench_candidates`,
		`INSERT INTO submission.attempts (id, tenant_id, exam_id, exam_version_id, candidate_id, candidate_assignment_id,
		       attempt_number, lifecycle_state, available_from, started_at, submission_deadline)
		   SELECT attempt_id, '` + unitTenantID + `', '018f4b0d-08f8-7c09-9ba7-efdf9c340a01', '018f4b0d-08f8-7c09-9ba7-efdf9c340a02',
		          candidate_id, assignment_id, 1, 'active', clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '2 hours'
		   FROM bench_candidates`,
		`INSERT INTO submission.attempt_snapshots (tenant_id, attempt_id, captured_at, storage_key, size_bytes)
		   SELECT '` + unitTenantID + `', attempt_id, clock_timestamp() - make_interval(secs => f * 5), 'k', 1000
		   FROM bench_candidates, generate_series(1, ` + fmt.Sprint(framesPerAttempt) + `) AS f`,
		`ANALYZE submission.attempts`, `ANALYZE submission.attempt_snapshots`,
	} {
		_, err := seed.Exec(ctx, statement)
		require.NoError(t, err, statement)
	}
	rows, err := seed.Query(ctx, `SELECT candidate_id::text, attempt_id::text FROM bench_candidates`)
	require.NoError(t, err)
	type candidate struct{ id, attempt string }
	var people []candidate
	for rows.Next() {
		var c candidate
		require.NoError(t, rows.Scan(&c.id, &c.attempt))
		people = append(people, c)
	}
	rows.Close()
	seed.Release()
	require.Len(t, people, candidates)

	// Every candidate posts a frame at once, then keeps posting: the "start of exam" burst.
	const framesEach = 10
	measure := func(name string, call func(person candidate, i int) error) {
		var mu sync.Mutex
		var samples []time.Duration
		var wg sync.WaitGroup
		started := time.Now()
		for _, person := range people {
			wg.Add(1)
			go func() {
				defer wg.Done()
				for i := 0; i < framesEach; i++ {
					begin := time.Now()
					if err := call(person, i); err != nil {
						t.Errorf("%s: %v", name, err)
						return
					}
					mu.Lock()
					samples = append(samples, time.Since(begin))
					mu.Unlock()
				}
			}()
		}
		wg.Wait()
		elapsed := time.Since(started)
		sort.Slice(samples, func(a, b int) bool { return samples[a] < samples[b] })
		at := func(p float64) time.Duration { return samples[int(float64(len(samples)-1)*p)] }
		t.Logf("%-22s n=%d  %.0f/s  p50=%v p75=%v p90=%v p95=%v p99=%v max=%v", name, len(samples),
			float64(len(samples))/elapsed.Seconds(), at(.50), at(.75), at(.90), at(.95), at(.99), samples[len(samples)-1])
	}

	// Variant switches isolate where the per-request cost sits: AETHER_PERF_VARIANT is a comma list of
	// "eager" (both purges on every request, as before migration 000048), "nopurge" and "unlogged".
	// The default is what set_context does now: purge for about 1% of requests.
	variant := os.Getenv("AETHER_PERF_VARIANT")
	purge := "lazy"
	if strings.Contains(variant, "eager") {
		purge = "eager"
	} else if strings.Contains(variant, "nopurge") {
		purge = "none"
	}
	if strings.Contains(variant, "unlogged") {
		for _, table := range []string{"authz.request_contexts", "authz.consumed_capabilities"} {
			_, err := pool.Exec(ctx, "ALTER TABLE "+table+" SET UNLOGGED")
			require.NoError(t, err)
		}
	}
	t.Logf("variant: %q", variant)
	// A post-validation approximation of authz.set_context (the HMAC and projection checks are not run): the same statements after them, purge, consume, open the context.
	_, err = pool.Exec(ctx, `
		CREATE FUNCTION public.bench_set_context(p_actor uuid, p_tenant uuid, p_purge text) RETURNS void
		LANGUAGE plpgsql AS $f$
		DECLARE cap uuid := gen_random_uuid(); ctx uuid := gen_random_uuid();
		BEGIN
		    IF p_purge = 'eager' THEN PERFORM authz.purge_expired_contexts(); PERFORM authz.purge_expired_capabilities();
		    ELSIF p_purge = 'lazy' AND random() < 0.01 THEN PERFORM authz.purge_expired_contexts(500); PERFORM authz.purge_expired_capabilities(500); END IF;
		    INSERT INTO authz.consumed_capabilities (capability_id, expires_at) VALUES (cap, clock_timestamp() + interval '4 seconds');
		    INSERT INTO authz.request_contexts (context_id, capability_id, backend_pid, transaction_id, actor_id, tenant_id,
		         authz_revision, action, resource, issued_at, expires_at)
		    VALUES (ctx, cap, pg_backend_pid(), txid_current(), p_actor, p_tenant, 1, 'submission.write', 'submission.attempts',
		            clock_timestamp(), clock_timestamp() + interval '4 seconds');
		    PERFORM set_config('app.authz_context_id', ctx::text, true);
		END $f$`)
	require.NoError(t, err)
	// The request pool has a fixed size, so results do not depend on this machine's core count
	// (pgxpool defaults to one connection per core). AETHER_PERF_CONNS overrides the default of 8.
	size := 8
	if raw := os.Getenv("AETHER_PERF_CONNS"); raw != "" {
		var err error
		size, err = strconv.Atoi(raw)
		require.NoError(t, err)
	}
	requestConfig, err := pgxpool.ParseConfig(integration.PoolDSN(pool))
	require.NoError(t, err)
	requestConfig.MaxConns = int32(size)
	requests, err := pgxpool.NewWithConfig(ctx, requestConfig)
	require.NoError(t, err)
	defer requests.Close()
	t.Logf("request pool: %d connections", size)
	signedCall := func(person candidate, fn func(pgx.Tx) error) error {
		transaction, err := requests.Begin(ctx)
		if err != nil {
			return err
		}
		defer transaction.Rollback(ctx) //nolint:errcheck
		if _, err := transaction.Exec(ctx, `SELECT public.bench_set_context($1, $2, $3)`, person.id, unitTenantID, purge); err != nil {
			return err
		}
		if _, err := transaction.Exec(ctx, `SET LOCAL ROLE aether_submission_app`); err != nil {
			return err
		}
		if err := fn(transaction); err != nil {
			return err
		}
		return transaction.Commit(ctx)
	}
	measure("store_snapshot", func(person candidate, i int) error {
		return signedCall(person, func(transaction pgx.Tx) error {
			_, err := transaction.Exec(ctx, `SELECT submission.store_snapshot($1, $2, clock_timestamp() + make_interval(secs => $3), 'k', 1000)`,
				unitTenantID, person.attempt, float64(i))
			return err
		})
	})
	measure("get_attempt_policy", func(person candidate, _ int) error {
		return signedCall(person, func(transaction pgx.Tx) error {
			var policy []byte
			return transaction.QueryRow(ctx, `SELECT submission.get_attempt_proctor_policy($1, $2)`, unitTenantID, person.attempt).Scan(&policy)
		})
	})
	measure("list_attempts", func(person candidate, _ int) error {
		return signedCall(person, func(transaction pgx.Tx) error {
			var page []byte
			return transaction.QueryRow(ctx, `SELECT submission.list_attempts($1, 11, NULL, NULL, NULL, NULL)`, unitTenantID).Scan(&page)
		})
	})

	// The plans behind them, with buffers, so heap fetches and scans are visible.
	explain := func(name, query string, args ...any) string {
		rows, err := pool.Query(ctx, "EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF) "+query, args...)
		require.NoError(t, err)
		var plan []string
		for rows.Next() {
			var line string
			require.NoError(t, rows.Scan(&line))
			plan = append(plan, line)
		}
		rows.Close()
		text := strings.Join(plan, "\n")
		t.Logf("plan %s:\n%s", name, text)
		return text
	}
	person := people[0]
	for name, plan := range map[string]string{
		"attempt ownership check (store_snapshot)": explain("attempt ownership check (store_snapshot)",
			`SELECT 1 FROM submission.attempts WHERE tenant_id = $1 AND id = $2 AND candidate_id = $3 AND lifecycle_state = 'active' AND deleted_at IS NULL`,
			unitTenantID, person.attempt, person.id),
		"snapshots of one attempt": explain("snapshots of one attempt",
			`SELECT id, captured_at, storage_key FROM submission.attempt_snapshots WHERE tenant_id = $1 AND attempt_id = $2 ORDER BY captured_at DESC LIMIT 50`,
			unitTenantID, person.attempt),
		"attempts of one candidate": explain("attempts of one candidate",
			`SELECT id, lifecycle_state, submission_deadline FROM submission.attempts WHERE tenant_id = $1 AND candidate_id = $2 ORDER BY created_at DESC LIMIT 11`,
			unitTenantID, person.id),
	} {
		require.NotContains(t, plan, "Seq Scan", "%s must be served by an index at campus scale", name)
	}
}
