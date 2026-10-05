//go:build integration

package repo_test

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
)

func newID(t *testing.T) string {
	t.Helper()
	id, err := uuid.NewV7()
	require.NoError(t, err)
	return id.String()
}

func requirePostgresCode(t *testing.T, err error, code string) {
	t.Helper()
	require.Error(t, err)
	var postgresError *pgconn.PgError
	require.True(t, errors.As(err, &postgresError), "expected *pgconn.PgError, got %T: %v", err, err)
	require.Equal(t, code, postgresError.Code, "message: %s", postgresError.Message)
}

// executableItem and legacyItem are the snapshot item shapes Submission's
// projection hands apply_assignment_snapshot: the legacy item has the empty
// strings and nulls an item pinned before Assessment migration 000024 yields.
func executableItem(itemID string) string {
	return fmt.Sprintf(`{"exam_item_id":%q,"evaluation_bundle_object_key":"bundles/eval.enc","evaluation_bundle_checksum":%q,
		"maximum_score":10,"evaluation_bundle_key_reference":"local/key-1","sample_bundle_object_key":"bundles/sample.enc",
		"sample_bundle_checksum":%q,"sample_bundle_key_reference":"local/key-1",
		"time_limit_ms":2000,"memory_limit_kib":262144,"supported_languages":["c","python3"]}`,
		itemID, strings.Repeat("a", 64), strings.Repeat("b", 64))
}

func legacyItem(itemID string) string {
	return fmt.Sprintf(`{"exam_item_id":%q,"evaluation_bundle_object_key":"bundles/eval.enc","evaluation_bundle_checksum":%q,
		"maximum_score":10,"evaluation_bundle_key_reference":"","sample_bundle_object_key":"","sample_bundle_checksum":"",
		"sample_bundle_key_reference":"","time_limit_ms":null,"memory_limit_kib":null,"supported_languages":null}`,
		itemID, strings.Repeat("a", 64))
}

type gradingFixture struct {
	CandidateID  string
	AssignmentID string
	AttemptID    string
}

// seedAssignedAttempt projects an assignment through the real snapshot routine
// and starts a candidate attempt in the given lifecycle state.
func seedAssignedAttempt(ctx context.Context, t *testing.T, pool *pgxpool.Pool, lifecycleState string, items ...string) gradingFixture {
	t.Helper()
	fixture := gradingFixture{CandidateID: newID(t), AssignmentID: newID(t), AttemptID: newID(t)}
	_, err := pool.Exec(ctx, `
		SELECT submission.apply_assignment_snapshot(
			$1, $2, $3, $4, gen_random_uuid(), gen_random_uuid(),
			clock_timestamp() - interval '1 hour', clock_timestamp() + interval '2 hours',
			1::smallint, 'active', 1, $5::jsonb, NULL
		)`, newID(t), unitTenantID, fixture.AssignmentID, fixture.CandidateID, "["+strings.Join(items, ",")+"]")
	require.NoError(t, err, "project assignment snapshot")
	_, err = pool.Exec(ctx, `
		INSERT INTO submission.attempts (
		    id, tenant_id, exam_id, exam_version_id, candidate_id, candidate_assignment_id,
		    attempt_number, lifecycle_state, available_from, started_at, submitted_at, submission_deadline)
		VALUES ($1, $2, gen_random_uuid(), gen_random_uuid(), $3, $4, 1, $5,
		        clock_timestamp(), clock_timestamp(),
		        CASE WHEN $5 IN ('grading', 'graded') THEN clock_timestamp() END,
		        clock_timestamp() + interval '1 hour')`,
		fixture.AttemptID, unitTenantID, fixture.CandidateID, fixture.AssignmentID, lifecycleState)
	require.NoError(t, err, "seed attempt")
	return fixture
}

// seedQueuedRequest adds an answer revision and a not-yet-dispatched
// evaluation request for one exam item of the fixture's attempt.
func seedQueuedRequest(ctx context.Context, t *testing.T, pool *pgxpool.Pool, fixture gradingFixture, examItemID string) string {
	t.Helper()
	revisionID, requestID := newID(t), newID(t)
	_, err := pool.Exec(ctx, `
		INSERT INTO submission.answer_revisions (
		    id, tenant_id, attempt_id, exam_item_id, revision_number, language_id,
		    source_object_key, source_checksum, encryption_key_reference, created_by)
		VALUES ($1, $2, $3, $4, 1, 'python3', 'candidate-source/t/a/r', repeat('c', 64), 'local/key-2', $5)`,
		revisionID, unitTenantID, fixture.AttemptID, examItemID, fixture.CandidateID)
	require.NoError(t, err, "seed answer revision")
	_, err = pool.Exec(ctx, `
		INSERT INTO submission.evaluation_requests (
		    id, tenant_id, attempt_id, answer_revision_id, evaluation_bundle_object_key,
		    evaluation_bundle_checksum, caller_idempotency_key, maximum_score)
		VALUES ($1, $2, $3, $4, 'bundles/eval.enc', repeat('a', 64), $5, 10)`,
		requestID, unitTenantID, fixture.AttemptID, revisionID, "submission:"+revisionID)
	require.NoError(t, err, "seed evaluation request")
	return requestID
}

// asRole runs fn in a transaction that has switched to role, then rolls it
// back, so the test sees exactly what that identity may do.
func asRole(ctx context.Context, t *testing.T, pool *pgxpool.Pool, role string, fn func(pgx.Tx)) {
	t.Helper()
	transaction, err := pool.Begin(ctx)
	require.NoError(t, err)
	defer transaction.Rollback(ctx) //nolint:errcheck
	_, err = transaction.Exec(ctx, "SET LOCAL ROLE "+role)
	require.NoError(t, err)
	fn(transaction)
}

type claimedRow struct {
	RequestID, TenantID, BundleKey, BundleChecksum string
	BundleKeyReference                             *string
	SourceKey, SourceChecksum, SourceKeyReference  string
	Language                                       string
	TimeLimitMS, MemoryLimitKiB                    *int
	ExpiresAt                                      time.Time
}

func claim(ctx context.Context, t *testing.T, queryer interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
}, limit int) []claimedRow {
	t.Helper()
	rows, err := queryer.Query(ctx, `
		SELECT evaluation_request_id::text, tenant_id::text, evaluation_bundle_object_key, evaluation_bundle_checksum,
		       evaluation_bundle_key_reference, source_object_key, source_checksum, source_key_reference,
		       language_id, time_limit_ms, memory_limit_kib, expires_at
		FROM submission.claim_evaluation_requests($1, 30)`, limit)
	require.NoError(t, err)
	defer rows.Close()
	var claimed []claimedRow
	for rows.Next() {
		var row claimedRow
		require.NoError(t, rows.Scan(&row.RequestID, &row.TenantID, &row.BundleKey, &row.BundleChecksum,
			&row.BundleKeyReference, &row.SourceKey, &row.SourceChecksum, &row.SourceKeyReference,
			&row.Language, &row.TimeLimitMS, &row.MemoryLimitKiB, &row.ExpiresAt))
		claimed = append(claimed, row)
	}
	require.NoError(t, rows.Err())
	return claimed
}

// TestAssignmentExecutionSettingsGateAnswers proves the projection persists the
// bundle references, limits and languages of each item, and that saving an
// answer is refused for a language the item does not list.
func TestAssignmentExecutionSettingsGateAnswers(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	pool := startSubmissionDatabase(ctx, t)

	executable, legacy := newID(t), newID(t)
	fixture := seedAssignedAttempt(ctx, t, pool, "active", executableItem(executable), legacyItem(legacy))

	var keyReference, sampleKey, sampleChecksum, sampleKeyReference *string
	var timeLimit, memoryLimit *int
	var languages []string
	require.NoError(t, pool.QueryRow(ctx, `
		SELECT evaluation_bundle_key_reference, sample_bundle_object_key, sample_bundle_checksum,
		       sample_bundle_key_reference, time_limit_ms, memory_limit_kib, supported_languages
		FROM submission.assignment_item_projections WHERE exam_item_id = $1`, executable,
	).Scan(&keyReference, &sampleKey, &sampleChecksum, &sampleKeyReference, &timeLimit, &memoryLimit, &languages))
	require.Equal(t, "local/key-1", *keyReference)
	require.Equal(t, "bundles/sample.enc", *sampleKey)
	require.Equal(t, strings.Repeat("b", 64), *sampleChecksum)
	require.Equal(t, "local/key-1", *sampleKeyReference)
	require.Equal(t, 2000, *timeLimit)
	require.Equal(t, 262144, *memoryLimit)
	require.Equal(t, []string{"c", "python3"}, languages)

	require.NoError(t, pool.QueryRow(ctx, `
		SELECT evaluation_bundle_key_reference, sample_bundle_object_key, time_limit_ms, supported_languages
		FROM submission.assignment_item_projections WHERE exam_item_id = $1`, legacy,
	).Scan(&keyReference, &sampleKey, &timeLimit, &languages))
	require.Nil(t, keyReference, "a legacy item has no key reference, not an empty one")
	require.Nil(t, sampleKey)
	require.Nil(t, timeLimit)
	require.Nil(t, languages)

	authorizeActorsInTenant(ctx, t, pool, fixture.CandidateID)
	save := func(examItemID, language string) (string, error) {
		var revisionID string
		var saveErr error
		asCandidate(ctx, t, pool, fixture.CandidateID, func(transaction pgx.Tx) {
			saveErr = transaction.QueryRow(ctx, `
				SELECT id::text FROM submission.append_answer_revision(
					$1, $2, $3, $4, $5, $6, 'candidate-source/t/a/r', repeat('d', 64), 'local/key-2', 1
				)`, newID(t), newID(t), unitTenantID, fixture.AttemptID, examItemID, language).Scan(&revisionID)
		})
		return revisionID, saveErr
	}

	revisionID, err := save(executable, "python3")
	require.NoError(t, err, "a listed language is accepted")
	require.NotEmpty(t, revisionID)
	_, err = save(executable, "go")
	requirePostgresCode(t, err, "22023")
	_, err = save(legacy, "python3")
	requirePostgresCode(t, err, "22023")
	_, err = save(newID(t), "python3")
	requirePostgresCode(t, err, "P0001")
}

// TestDispatchClaimsAreLeasedAndRecorded exercises the dispatcher's two
// routines under the execute-only Judge adapter role.
func TestDispatchClaimsAreLeasedAndRecorded(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	pool := startSubmissionDatabase(ctx, t)

	itemOne, itemTwo, legacy := newID(t), newID(t), newID(t)
	fixture := seedAssignedAttempt(ctx, t, pool, "grading", executableItem(itemOne), executableItem(itemTwo), legacyItem(legacy))
	first := seedQueuedRequest(ctx, t, pool, fixture, itemOne)
	second := seedQueuedRequest(ctx, t, pool, fixture, itemTwo)
	legacyRequest := seedQueuedRequest(ctx, t, pool, fixture, legacy)

	t.Run("the adapter role can reach nothing but the routines", func(t *testing.T) {
		asRole(ctx, t, pool, "aether_submission_judge_adapter", func(transaction pgx.Tx) {
			_, err := transaction.Exec(ctx, `SELECT count(*) FROM submission.evaluation_requests`)
			requirePostgresCode(t, err, "42501")
		})
		var appCanClaim bool
		require.NoError(t, pool.QueryRow(ctx, `SELECT has_function_privilege('aether_submission_app',
			'submission.claim_evaluation_requests(integer, integer)', 'EXECUTE')
			OR has_function_privilege('aether_submission_app', 'submission.mark_evaluation_dispatched(uuid, uuid, uuid)', 'EXECUTE')
			OR has_function_privilege('aether_submission_app', 'submission.mark_evaluation_failed(uuid, uuid, text, uuid, uuid, uuid)', 'EXECUTE')
			OR has_function_privilege('aether_submission_judge_adapter', 'submission.finalize_attempt_grading(uuid, uuid, uuid, uuid, uuid)', 'EXECUTE')`,
		).Scan(&appCanClaim))
		require.False(t, appCanClaim, "dispatch routines are reachable only by the Judge adapter")
	})

	t.Run("a claim carries everything Judge needs and leases the row", func(t *testing.T) {
		var claimed []claimedRow
		asRole(ctx, t, pool, "aether_submission_judge_adapter", func(transaction pgx.Tx) {
			claimed = claim(ctx, t, transaction, 10)
			require.NoError(t, transaction.Commit(ctx))
		})
		byID := map[string]claimedRow{}
		for _, row := range claimed {
			byID[row.RequestID] = row
		}
		require.Len(t, byID, 3)
		row := byID[first]
		require.Equal(t, unitTenantID, row.TenantID)
		require.Equal(t, "bundles/eval.enc", row.BundleKey)
		require.Equal(t, strings.Repeat("a", 64), row.BundleChecksum)
		require.Equal(t, "local/key-1", *row.BundleKeyReference)
		require.Equal(t, "candidate-source/t/a/r", row.SourceKey)
		require.Equal(t, strings.Repeat("c", 64), row.SourceChecksum)
		require.Equal(t, "local/key-2", row.SourceKeyReference)
		require.Equal(t, "python3", row.Language)
		require.Equal(t, 2000, *row.TimeLimitMS)
		require.Equal(t, 262144, *row.MemoryLimitKiB)
		var queuedPlusTwelveHours time.Time
		require.NoError(t, pool.QueryRow(ctx, `SELECT queued_at + interval '12 hours' FROM submission.evaluation_requests WHERE id = $1`, first).Scan(&queuedPlusTwelveHours))
		require.True(t, row.ExpiresAt.Equal(queuedPlusTwelveHours), "expires_at must derive from queued_at so a replay is identical")

		legacyRow := byID[legacyRequest]
		require.Nil(t, legacyRow.BundleKeyReference, "an unexecutable item is still returned so it can be failed")
		require.Nil(t, legacyRow.TimeLimitMS)

		var attempts int
		var leaseSeconds float64
		require.NoError(t, pool.QueryRow(ctx, `SELECT dispatch_attempts, extract(epoch FROM dispatch_after - clock_timestamp())
			FROM submission.evaluation_requests WHERE id = $1`, first).Scan(&attempts, &leaseSeconds))
		require.Equal(t, 1, attempts)
		require.InDelta(t, 30, leaseSeconds, 5)
	})

	t.Run("a leased row is not claimed again until the lease lapses, and then backs off", func(t *testing.T) {
		asRole(ctx, t, pool, "aether_submission_judge_adapter", func(transaction pgx.Tx) {
			require.Empty(t, claim(ctx, t, transaction, 10))
		})
		_, err := pool.Exec(ctx, `UPDATE submission.evaluation_requests SET dispatch_after = clock_timestamp() - interval '1 second' WHERE id = $1`, first)
		require.NoError(t, err)
		asRole(ctx, t, pool, "aether_submission_judge_adapter", func(transaction pgx.Tx) {
			reclaimed := claim(ctx, t, transaction, 10)
			require.Len(t, reclaimed, 1)
			require.Equal(t, first, reclaimed[0].RequestID)
			require.NoError(t, transaction.Commit(ctx))
		})
		var attempts int
		var leaseSeconds float64
		require.NoError(t, pool.QueryRow(ctx, `SELECT dispatch_attempts, extract(epoch FROM dispatch_after - clock_timestamp())
			FROM submission.evaluation_requests WHERE id = $1`, first).Scan(&attempts, &leaseSeconds))
		require.Equal(t, 2, attempts)
		require.InDelta(t, 60, leaseSeconds, 5, "the lease doubles with each attempt")

		_, err = pool.Exec(ctx, `UPDATE submission.evaluation_requests SET dispatch_attempts = 40, dispatch_after = NULL WHERE id = $1`, first)
		require.NoError(t, err)
		asRole(ctx, t, pool, "aether_submission_judge_adapter", func(transaction pgx.Tx) {
			require.Len(t, claim(ctx, t, transaction, 10), 1)
			require.NoError(t, transaction.Commit(ctx))
		})
		require.NoError(t, pool.QueryRow(ctx, `SELECT extract(epoch FROM dispatch_after - clock_timestamp())
			FROM submission.evaluation_requests WHERE id = $1`, first).Scan(&leaseSeconds))
		require.InDelta(t, 300, leaseSeconds, 5, "the lease is capped at five minutes")
	})

	t.Run("concurrent claims never share a row", func(t *testing.T) {
		_, err := pool.Exec(ctx, `UPDATE submission.evaluation_requests SET dispatch_after = NULL, dispatch_attempts = 0 WHERE id = ANY($1)`,
			[]string{first, second})
		require.NoError(t, err)
		_, err = pool.Exec(ctx, `UPDATE submission.evaluation_requests SET lifecycle_state = 'cancelled', completed_at = clock_timestamp() WHERE id = $1`, legacyRequest)
		require.NoError(t, err)

		left, err := pool.Begin(ctx)
		require.NoError(t, err)
		defer left.Rollback(ctx) //nolint:errcheck
		right, err := pool.Begin(ctx)
		require.NoError(t, err)
		defer right.Rollback(ctx) //nolint:errcheck
		for _, transaction := range []pgx.Tx{left, right} {
			_, err = transaction.Exec(ctx, `SET LOCAL ROLE aether_submission_judge_adapter`)
			require.NoError(t, err)
		}
		leftRows := claim(ctx, t, left, 1)
		rightRows := claim(ctx, t, right, 1)
		require.Len(t, leftRows, 1)
		require.Len(t, rightRows, 1)
		require.NotEqual(t, leftRows[0].RequestID, rightRows[0].RequestID, "SKIP LOCKED must hand each replica a different row")
	})

	t.Run("recording the job dispatches the request and lets its completion in", func(t *testing.T) {
		jobID := newID(t)
		var recorded bool
		asRole(ctx, t, pool, "aether_submission_judge_adapter", func(transaction pgx.Tx) {
			require.NoError(t, transaction.QueryRow(ctx, `SELECT submission.mark_evaluation_dispatched($1, $2, $3)`,
				unitTenantID, second, jobID).Scan(&recorded))
			require.True(t, recorded)
			require.NoError(t, transaction.QueryRow(ctx, `SELECT submission.mark_evaluation_dispatched($1, $2, $3)`,
				unitTenantID, second, newID(t)).Scan(&recorded))
			require.False(t, recorded, "a request already holding a job keeps it")
			require.NoError(t, transaction.Commit(ctx))
		})
		var state string
		var storedJob *string
		var dispatchedAt *time.Time
		require.NoError(t, pool.QueryRow(ctx, `SELECT lifecycle_state, judge_job_id::text, dispatched_at FROM submission.evaluation_requests WHERE id = $1`,
			second).Scan(&state, &storedJob, &dispatchedAt))
		require.Equal(t, "dispatched", state)
		require.Equal(t, jobID, *storedJob)
		require.NotNil(t, dispatchedAt, "the dispatched_at CHECK ties the state to a timestamp")

		_, err := pool.Exec(ctx, `
			SELECT submission.ingest_judge_completion(
				$1, $2, $3, $4, 'submission-judge-completion', $5, $6, 'accepted', 5, 1024,
				NULL, NULL, NULL, clock_timestamp(), '[]'::jsonb
			)`, newID(t), newID(t), newID(t), newID(t), second, jobID)
		require.NoError(t, err, "a completion for the recorded job is accepted")
	})

	t.Run("a request cancelled mid-flight still records its job", func(t *testing.T) {
		jobID := newID(t)
		asRole(ctx, t, pool, "aether_submission_judge_adapter", func(transaction pgx.Tx) {
			var recorded bool
			require.NoError(t, transaction.QueryRow(ctx, `SELECT submission.mark_evaluation_dispatched($1, $2, $3)`,
				unitTenantID, legacyRequest, jobID).Scan(&recorded))
			require.True(t, recorded)
			require.NoError(t, transaction.Commit(ctx))
		})
		var state string
		var storedJob *string
		require.NoError(t, pool.QueryRow(ctx, `SELECT lifecycle_state, judge_job_id::text FROM submission.evaluation_requests WHERE id = $1`,
			legacyRequest).Scan(&state, &storedJob))
		require.Equal(t, "cancelled", state, "recording the job must not revive a cancelled request")
		require.Equal(t, jobID, *storedJob, "the completion ingress needs the job id even for a cancelled request")
	})
}

// TestFailedDispatchStillGradesTheAttempt proves a request Judge permanently
// refuses scores zero and that failing the last open request closes the attempt.
func TestFailedDispatchStillGradesTheAttempt(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	pool := startSubmissionDatabase(ctx, t)

	itemOne, itemTwo := newID(t), newID(t)
	fixture := seedAssignedAttempt(ctx, t, pool, "grading", executableItem(itemOne), executableItem(itemTwo))
	first := seedQueuedRequest(ctx, t, pool, fixture, itemOne)
	second := seedQueuedRequest(ctx, t, pool, fixture, itemTwo)

	fail := func(requestID, code string) bool {
		var graded bool
		asRole(ctx, t, pool, "aether_submission_judge_adapter", func(transaction pgx.Tx) {
			require.NoError(t, transaction.QueryRow(ctx, `SELECT submission.mark_evaluation_failed($1, $2, $3, $4, $5, $6)`,
				unitTenantID, requestID, code, newID(t), newID(t), newID(t)).Scan(&graded))
			require.NoError(t, transaction.Commit(ctx))
		})
		return graded
	}
	attemptState := func() string {
		var state string
		require.NoError(t, pool.QueryRow(ctx, `SELECT lifecycle_state FROM submission.attempts WHERE id = $1`, fixture.AttemptID).Scan(&state))
		return state
	}

	require.False(t, fail(first, "judge_rejected"), "another request is still open")
	require.Equal(t, "grading", attemptState())
	require.False(t, fail(first, "judge_rejected"), "a request that already left the queue is not failed twice")

	require.True(t, fail(second, "item_not_executable"), "failing the last open request grades the attempt")
	require.Equal(t, "graded", attemptState())

	var score, maximum float64
	var calculationVersion int
	require.NoError(t, pool.QueryRow(ctx, `SELECT score::float8, maximum_score::float8, calculation_version FROM submission.score_summaries WHERE attempt_id = $1`,
		fixture.AttemptID).Scan(&score, &maximum, &calculationVersion))
	require.Zero(t, score)
	require.Equal(t, 20.0, maximum)
	require.Equal(t, 2, calculationVersion)

	var code string
	require.NoError(t, pool.QueryRow(ctx, `SELECT failure_code FROM submission.evaluation_requests WHERE id = $1`, second).Scan(&code))
	require.Equal(t, "item_not_executable", code)

	asRole(ctx, t, pool, "aether_submission_judge_adapter", func(transaction pgx.Tx) {
		_, err := transaction.Exec(ctx, `SELECT submission.mark_evaluation_failed($1, $2, '', $3, $4, $5)`,
			unitTenantID, first, newID(t), newID(t), newID(t))
		requirePostgresCode(t, err, "22023")
	})
}

// TestWeightedScoring covers the scoring rule end to end through the real
// ingestion and reconciliation routines.
func TestWeightedScoring(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	pool := startSubmissionDatabase(ctx, t)

	type item struct {
		verdict string
		units   string
	}
	testCases := []struct {
		name      string
		items     []item
		wantScore string
	}{
		{
			name: "weights 1,2,3,1 with tests 1 and 3 passing earn 4/7",
			items: []item{{"wrong_answer", `[
				{"unit_number":0,"verdict":"accepted","weight":1},
				{"unit_number":1,"verdict":"wrong_answer","weight":2},
				{"unit_number":2,"verdict":"accepted","weight":3},
				{"unit_number":3,"verdict":"time_limit_exceeded","weight":1}]`}},
			wantScore: "5.7143",
		},
		{
			name: "every test passing earns the maximum",
			items: []item{{"accepted", `[
				{"unit_number":0,"verdict":"accepted","weight":40},
				{"unit_number":1,"verdict":"accepted","weight":60}]`}},
			wantScore: "10.0000",
		},
		{
			name: "only the heavy test failing earns the light one's share",
			items: []item{{"wrong_answer", `[
				{"unit_number":0,"verdict":"accepted","weight":1},
				{"unit_number":1,"verdict":"wrong_answer","weight":99}]`}},
			wantScore: "0.1000",
		},
		{
			name: "units reported without weights count equally",
			items: []item{{"wrong_answer", `[
				{"unit_number":0,"verdict":"accepted"},
				{"unit_number":1,"verdict":"wrong_answer"}]`}},
			wantScore: "5.0000",
		},
		{
			name:      "no unit breakdown and accepted keeps the all-or-nothing rule",
			items:     []item{{"accepted", `[]`}},
			wantScore: "10.0000",
		},
		{
			name:      "no unit breakdown and rejected scores zero",
			items:     []item{{"compile_error", `[]`}},
			wantScore: "0.0000",
		},
		{
			name: "items add up independently",
			items: []item{
				{"wrong_answer", `[{"unit_number":0,"verdict":"accepted","weight":1},{"unit_number":1,"verdict":"wrong_answer","weight":1}]`},
				{"accepted", `[]`},
			},
			wantScore: "15.0000",
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			itemIDs := make([]string, len(testCase.items))
			snapshotItems := make([]string, len(testCase.items))
			for index := range itemIDs {
				itemIDs[index] = newID(t)
				snapshotItems[index] = executableItem(itemIDs[index])
			}
			fixture := seedAssignedAttempt(ctx, t, pool, "grading", snapshotItems...)
			// Dispatch every request before completing any, so the attempt
			// cannot be finalized while later items are still unseeded.
			requestIDs, jobIDs := make([]string, len(testCase.items)), make([]string, len(testCase.items))
			for index := range testCase.items {
				requestIDs[index], jobIDs[index] = seedQueuedRequest(ctx, t, pool, fixture, itemIDs[index]), newID(t)
				_, err := pool.Exec(ctx, `UPDATE submission.evaluation_requests
					SET judge_job_id = $2, lifecycle_state = 'dispatched', dispatched_at = clock_timestamp() WHERE id = $1`,
					requestIDs[index], jobIDs[index])
				require.NoError(t, err)
			}
			for index, scored := range testCase.items {
				eventID := newID(t)
				_, err := pool.Exec(ctx, `
					SELECT submission.ingest_judge_completion(
						$1, $2, $3, $4, 'submission-judge-completion', $5, $6, $7, 21, 4096,
						NULL, NULL, NULL, '2026-10-04T09:00:00.000000Z'::timestamptz, $8::jsonb
					)`, newID(t), eventID, newID(t), newID(t), requestIDs[index], jobIDs[index], scored.verdict, scored.units)
				require.NoError(t, err, "ingest completion")
				_, err = pool.Exec(ctx, `
					SELECT submission.record_judge_completion(
						$1, $2, $3, $4, $5, $6, $7, $8, $9, 21, 4096, NULL, NULL, NULL,
						'2026-10-04T09:00:00.000000Z'::timestamptz
					)`, newID(t), newID(t), newID(t), newID(t), unitTenantID, requestIDs[index], jobIDs[index], eventID, scored.verdict)
				require.NoError(t, err, "record completion")
			}

			var score, maximum string
			var calculationVersion int
			require.NoError(t, pool.QueryRow(ctx, `SELECT score::text, maximum_score::text, calculation_version FROM submission.score_summaries WHERE attempt_id = $1`,
				fixture.AttemptID).Scan(&score, &maximum, &calculationVersion))
			require.Equal(t, testCase.wantScore, score)
			require.Equal(t, fmt.Sprintf("%d.0000", 10*len(testCase.items)), maximum)
			require.Equal(t, 2, calculationVersion)
		})
	}

	t.Run("ingress refuses a weight outside 1-100", func(t *testing.T) {
		t.Parallel()
		itemID := newID(t)
		fixture := seedAssignedAttempt(ctx, t, pool, "grading", executableItem(itemID))
		requestID := seedQueuedRequest(ctx, t, pool, fixture, itemID)
		jobID := newID(t)
		_, err := pool.Exec(ctx, `UPDATE submission.evaluation_requests SET judge_job_id = $2 WHERE id = $1`, requestID, jobID)
		require.NoError(t, err)
		for _, weight := range []string{"0", "101", "-1", `"heavy"`, "1.5"} {
			_, err = pool.Exec(ctx, `
				SELECT submission.ingest_judge_completion(
					$1, $2, $3, $4, 'submission-judge-completion', $5, $6, 'accepted', 5, 1024,
					NULL, NULL, NULL, clock_timestamp(), $7::jsonb
				)`, newID(t), newID(t), newID(t), newID(t), requestID, jobID,
				`[{"unit_number":0,"verdict":"accepted","weight":`+weight+`}]`)
			requirePostgresCode(t, err, "22023")
		}
	})
}
