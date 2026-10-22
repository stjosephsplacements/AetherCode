//go:build integration

package repo_test

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
)

// asCandidateCommitted runs fn as the candidate like asCandidate, but commits.
func asCandidateCommitted(ctx context.Context, t *testing.T, pool *pgxpool.Pool, candidateID string, fn func(pgx.Tx)) {
	t.Helper()
	transaction, err := pool.Begin(ctx)
	require.NoError(t, err)
	defer transaction.Rollback(ctx) //nolint:errcheck
	var contextID string
	require.NoError(t, transaction.QueryRow(ctx, `
		INSERT INTO authz.request_contexts
		    (context_id, capability_id, backend_pid, transaction_id, actor_id, tenant_id,
		     authz_revision, action, resource, issued_at, expires_at)
		VALUES (gen_random_uuid(), gen_random_uuid(), pg_backend_pid(), txid_current(),
		        $1, $2, 1, 'submission.write', 'submission.attempts',
		        clock_timestamp(), clock_timestamp() + interval '4 seconds')
		RETURNING context_id::text`, candidateID, unitTenantID).Scan(&contextID))
	_, err = transaction.Exec(ctx, `SELECT set_config('app.authz_context_id', $1, true)`, contextID)
	require.NoError(t, err)
	_, err = transaction.Exec(ctx, `SET LOCAL ROLE aether_submission_app`)
	require.NoError(t, err)
	fn(transaction)
	require.NoError(t, transaction.Commit(ctx))
}

type itemSubmitFixture struct {
	ctx  context.Context
	t    *testing.T
	pool *pgxpool.Pool
	gradingFixture
}

func (fixture itemSubmitFixture) attemptVersion() int64 {
	var version int64
	require.NoError(fixture.t, fixture.pool.QueryRow(fixture.ctx, `SELECT version FROM submission.attempts WHERE id = $1`,
		fixture.AttemptID).Scan(&version))
	return version
}

func (fixture itemSubmitFixture) save(itemID string) string {
	var revisionID string
	asCandidateCommitted(fixture.ctx, fixture.t, fixture.pool, fixture.CandidateID, func(transaction pgx.Tx) {
		require.NoError(fixture.t, transaction.QueryRow(fixture.ctx, `
			SELECT id FROM submission.append_answer_revision(
				$1, $2, $3, $4, $5, 'python3', 'candidate-source/t/a/r', repeat('d', 64), 'local/key-2', $6
			)`, newID(fixture.t), newID(fixture.t), unitTenantID, fixture.AttemptID, itemID, fixture.attemptVersion()).Scan(&revisionID))
	})
	return revisionID
}

func (fixture itemSubmitFixture) submitItem(itemID string) (string, bool, error) {
	var requestID string
	var created bool
	var submitErr error
	transaction, err := fixture.pool.Begin(fixture.ctx)
	require.NoError(fixture.t, err)
	defer transaction.Rollback(fixture.ctx) //nolint:errcheck
	var contextID string
	require.NoError(fixture.t, transaction.QueryRow(fixture.ctx, `
		INSERT INTO authz.request_contexts
		    (context_id, capability_id, backend_pid, transaction_id, actor_id, tenant_id,
		     authz_revision, action, resource, issued_at, expires_at)
		VALUES (gen_random_uuid(), gen_random_uuid(), pg_backend_pid(), txid_current(),
		        $1, $2, 1, 'submission.write', 'submission.attempts',
		        clock_timestamp(), clock_timestamp() + interval '4 seconds')
		RETURNING context_id::text`, fixture.CandidateID, unitTenantID).Scan(&contextID))
	_, err = transaction.Exec(fixture.ctx, `SELECT set_config('app.authz_context_id', $1, true)`, contextID)
	require.NoError(fixture.t, err)
	_, err = transaction.Exec(fixture.ctx, `SET LOCAL ROLE aether_submission_app`)
	require.NoError(fixture.t, err)
	submitErr = transaction.QueryRow(fixture.ctx, `SELECT id, created FROM submission.submit_item($1, $2, $3, $4, $5)`,
		newID(fixture.t), newID(fixture.t), unitTenantID, fixture.AttemptID, itemID).Scan(&requestID, &created)
	if submitErr == nil {
		require.NoError(fixture.t, transaction.Commit(fixture.ctx))
	}
	return requestID, created, submitErr
}

// complete dispatches and completes one evaluation request with the given units.
func (fixture itemSubmitFixture) complete(requestID, verdict, units string) {
	jobID, eventID := newID(fixture.t), newID(fixture.t)
	_, err := fixture.pool.Exec(fixture.ctx, `UPDATE submission.evaluation_requests
		SET judge_job_id = $2, lifecycle_state = 'dispatched', dispatched_at = clock_timestamp() WHERE id = $1`, requestID, jobID)
	require.NoError(fixture.t, err)
	_, err = fixture.pool.Exec(fixture.ctx, `
		SELECT submission.ingest_judge_completion(
			$1, $2, $3, $4, 'submission-judge-completion', $5, $6, $7, 21, 4096,
			NULL, NULL, NULL, '2026-10-04T09:00:00.000000Z'::timestamptz, $8::jsonb
		)`, newID(fixture.t), eventID, newID(fixture.t), newID(fixture.t), requestID, jobID, verdict, units)
	require.NoError(fixture.t, err, "ingest completion")
	_, err = fixture.pool.Exec(fixture.ctx, `
		SELECT submission.record_judge_completion(
			$1, $2, $3, $4, $5, $6, $7, $8, $9, 21, 4096, NULL, NULL, NULL,
			'2026-10-04T09:00:00.000000Z'::timestamptz
		)`, newID(fixture.t), newID(fixture.t), newID(fixture.t), newID(fixture.t), unitTenantID, requestID, jobID, eventID, verdict)
	require.NoError(fixture.t, err, "record completion")
}

// endTest hands the attempt in with the requests prepare_submission returns.
func (fixture itemSubmitFixture) endTest() (string, []string) {
	var state string
	var requestIDs []string
	asCandidateCommitted(fixture.ctx, fixture.t, fixture.pool, fixture.CandidateID, func(transaction pgx.Tx) {
		rows, err := transaction.Query(fixture.ctx, `
			SELECT answer_revision_id::text, exam_item_id::text, evaluation_bundle_object_key,
			       evaluation_bundle_checksum::text, maximum_score::text
			FROM submission.prepare_submission($1, $2, $3)`, unitTenantID, fixture.AttemptID, fixture.attemptVersion())
		require.NoError(fixture.t, err)
		var requests []string
		for rows.Next() {
			var revisionID, itemID, key, checksum, maximum string
			require.NoError(fixture.t, rows.Scan(&revisionID, &itemID, &key, &checksum, &maximum))
			requestID := newID(fixture.t)
			requestIDs = append(requestIDs, requestID)
			requests = append(requests, fmt.Sprintf(`{"id":%q,"answer_revision_id":%q,"exam_item_id":%q,
				"evaluation_bundle_object_key":%q,"evaluation_bundle_checksum":%q,"maximum_score":%s,
				"caller_idempotency_key":"submission:%s"}`, requestID, revisionID, itemID, key, checksum, maximum, revisionID))
		}
		require.NoError(fixture.t, rows.Err())
		require.NoError(fixture.t, transaction.QueryRow(fixture.ctx, `
			SELECT lifecycle_state FROM submission.submit_attempt($1, $2, $3, $4, $5, $6, repeat('e', 64), $7::jsonb)`,
			newID(fixture.t), newID(fixture.t), unitTenantID, fixture.AttemptID, fixture.attemptVersion(), "end:"+newID(fixture.t),
			"["+strings.Join(requests, ",")+"]").Scan(&state))
	})
	return state, requestIDs
}

func (fixture itemSubmitFixture) score() (string, string, string) {
	var state, score, maximum string
	require.NoError(fixture.t, fixture.pool.QueryRow(fixture.ctx, `
		SELECT attempt.lifecycle_state, COALESCE(summary.score::text, ''), COALESCE(summary.maximum_score::text, '')
		FROM submission.attempts AS attempt
		LEFT JOIN submission.score_summaries AS summary ON summary.attempt_id = attempt.id
		WHERE attempt.id = $1`, fixture.AttemptID).Scan(&state, &score, &maximum))
	return state, score, maximum
}

const allPassed = `[{"unit_number":0,"verdict":"accepted","weight":1},{"unit_number":1,"verdict":"accepted","weight":1}]`
const nonePassed = `[{"unit_number":0,"verdict":"wrong_answer","weight":1},{"unit_number":1,"verdict":"wrong_answer","weight":1}]`

// TestItemSubmitScoresTheBestEvaluation proves per-question submits (ADR-0025):
// they never grade a running attempt, the same code is evaluated once, End
// test evaluates only new code, and each item keeps its best score.
func TestItemSubmitScoresTheBestEvaluation(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	pool := startSubmissionDatabase(ctx, t)

	t.Run("broken code after an accepted submit keeps the best score", func(t *testing.T) {
		t.Parallel()
		first, second := newID(t), newID(t)
		fixture := itemSubmitFixture{ctx, t, pool, seedAssignedAttempt(ctx, t, pool, "active", executableItem(first), executableItem(second))}
		authorizeActorsInTenant(ctx, t, pool, fixture.CandidateID)

		_, _, err := fixture.submitItem(first)
		require.ErrorContains(t, err, "item has no saved answer")

		fixture.save(first)
		requestID, created, err := fixture.submitItem(first)
		require.NoError(t, err)
		require.True(t, created)
		again, created, err := fixture.submitItem(first)
		require.NoError(t, err)
		require.False(t, created, "the same code is evaluated once")
		require.Equal(t, requestID, again)

		fixture.complete(requestID, "accepted", allPassed)
		state, score, _ := fixture.score()
		require.Equal(t, "active", state, "a per-question submit never grades a running attempt")
		require.Empty(t, score)

		fixture.save(first) // the student breaks the code
		fixture.save(second)
		state, requestIDs := fixture.endTest()
		require.Equal(t, "grading", state)
		require.Len(t, requestIDs, 2, "End test evaluates only code not yet submitted")
		fixture.complete(requestIDs[0], "wrong_answer", nonePassed)
		fixture.complete(requestIDs[1], "wrong_answer", nonePassed)

		state, score, maximum := fixture.score()
		require.Equal(t, "graded", state)
		require.Equal(t, "10.0000", score, "the accepted submit counts, not the broken final code")
		require.Equal(t, "20.0000", maximum)
	})

	t.Run("End test after every answer was submitted grades at once", func(t *testing.T) {
		t.Parallel()
		item := newID(t)
		fixture := itemSubmitFixture{ctx, t, pool, seedAssignedAttempt(ctx, t, pool, "active", executableItem(item))}
		authorizeActorsInTenant(ctx, t, pool, fixture.CandidateID)
		fixture.save(item)
		requestID, _, err := fixture.submitItem(item)
		require.NoError(t, err)
		fixture.complete(requestID, "wrong_answer", `[{"unit_number":0,"verdict":"accepted","weight":1},{"unit_number":1,"verdict":"wrong_answer","weight":1}]`)

		state, requestIDs := fixture.endTest()
		require.Empty(t, requestIDs)
		require.Equal(t, "graded", state, "nothing is left to judge, so the attempt is graded on the spot")
		_, score, _ := fixture.score()
		require.Equal(t, "5.0000", score)
	})

	t.Run("time-up evaluates only code not yet submitted", func(t *testing.T) {
		t.Parallel()
		item := newID(t)
		fixture := itemSubmitFixture{ctx, t, pool, seedAssignedAttempt(ctx, t, pool, "active", executableItem(item))}
		authorizeActorsInTenant(ctx, t, pool, fixture.CandidateID)
		fixture.save(item)
		requestID, _, err := fixture.submitItem(item)
		require.NoError(t, err)
		fixture.complete(requestID, "accepted", allPassed)

		_, err = pool.Exec(ctx, `UPDATE submission.attempts
			SET created_at = created_at - interval '3 hours', available_from = available_from - interval '3 hours',
			    started_at = started_at - interval '3 hours',
			    submission_deadline = submission_deadline - interval '3 hours'
			WHERE id = $1`, fixture.AttemptID)
		require.NoError(t, err)
		_, err = pool.Exec(ctx, `SELECT submission.expire_overdue_attempts(5000)`)
		require.NoError(t, err)
		var requests int
		require.NoError(t, pool.QueryRow(ctx, `SELECT count(*) FROM submission.evaluation_requests WHERE attempt_id = $1`, fixture.AttemptID).Scan(&requests))
		require.Equal(t, 1, requests)
		state, score, _ := fixture.score()
		require.Equal(t, "graded", state)
		require.Equal(t, "10.0000", score)
	})
}

// TestCustomInputRunsCarryTheirOwnBundle proves a custom-input run is
// accepted and that the dispatcher sends Judge the run's own one-test bundle,
// not the item's sample tests.
func TestCustomInputRunsCarryTheirOwnBundle(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	pool := startSubmissionDatabase(ctx, t)
	item := newID(t)
	fixture := seedAssignedAttempt(ctx, t, pool, "active", executableItem(item))
	authorizeActorsInTenant(ctx, t, pool, fixture.CandidateID)

	runID := newID(t)
	asCandidateCommitted(ctx, t, pool, fixture.CandidateID, func(transaction pgx.Tx) {
		_, err := transaction.Exec(ctx, `
			SELECT submission.start_custom_run($1, $2, $3, $4, 'python3', 'candidate-source/t/a/runs/r', repeat('d', 64), 'local/key-2',
				'candidate-source/t/a/runs/r/input', repeat('f', 64), 'local/key-2')`,
			runID, unitTenantID, fixture.AttemptID, item)
		require.NoError(t, err)
	})
	var kind string
	require.NoError(t, pool.QueryRow(ctx, `SELECT kind FROM submission.code_runs WHERE id = $1`, runID).Scan(&kind))
	require.Equal(t, "custom", kind)

	asRole(ctx, t, pool, "aether_submission_judge_adapter", func(transaction pgx.Tx) {
		var bundleKey, bundleChecksum string
		require.NoError(t, transaction.QueryRow(ctx, `
			SELECT sample_bundle_object_key, sample_bundle_checksum FROM submission.claim_code_runs(10, 30) WHERE code_run_id = $1`,
			runID).Scan(&bundleKey, &bundleChecksum))
		require.Equal(t, "candidate-source/t/a/runs/r/input", bundleKey)
		require.Equal(t, strings.Repeat("f", 64), bundleChecksum)
	})
}
