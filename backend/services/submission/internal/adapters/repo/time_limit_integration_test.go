//go:build integration

package repo_test

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
)

// asCandidate runs fn as the app role inside a transaction carrying a signed
// submission.write context for candidateID, then rolls it back.
func asCandidate(ctx context.Context, t *testing.T, pool *pgxpool.Pool, candidateID string, fn func(pgx.Tx)) {
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
}

// TestAttemptDeadlineIsStartPlusDuration proves start_attempt gives each
// candidate the earlier of start plus the exam's duration and the window's close.
func TestAttemptDeadlineIsStartPlusDuration(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	pool := startSubmissionDatabase(ctx, t)

	testCases := []struct {
		name         string
		closesIn     string
		duration     *int
		wantDeadline time.Duration
	}{
		{"duration ends before the window closes", "2 hours", intPointer(3600), time.Hour},
		{"the window closes before the duration ends", "30 minutes", intPointer(3600), 30 * time.Minute},
		{"a snapshot without a duration keeps the window's close", "2 hours", nil, 2 * time.Hour},
	}
	for _, testCase := range testCases {
		candidateID, assignmentID := newID(t), newID(t)
		_, err := pool.Exec(ctx, `
			SELECT submission.apply_assignment_snapshot(
				$1, $2, $3, $4, gen_random_uuid(), gen_random_uuid(),
				clock_timestamp() - interval '1 minute', clock_timestamp() + $5::interval,
				1::smallint, 'active', 1, $6::jsonb, $7
			)`, newID(t), unitTenantID, assignmentID, candidateID, testCase.closesIn,
			"["+executableItem(newID(t))+"]", testCase.duration)
		require.NoError(t, err, testCase.name)
		authorizeActorsInTenant(ctx, t, pool, candidateID)

		var deadline, startedAt time.Time
		asCandidate(ctx, t, pool, candidateID, func(transaction pgx.Tx) {
			require.NoError(t, transaction.QueryRow(ctx, `
				SELECT submission_deadline, started_at FROM submission.start_attempt($1, $2, $3, $4, 'start', repeat('e', 64))`,
				newID(t), newID(t), unitTenantID, assignmentID).Scan(&deadline, &startedAt), testCase.name)
		})
		require.InDelta(t, testCase.wantDeadline.Seconds(), deadline.Sub(startedAt).Seconds(), 5, testCase.name)
	}

	_, err := pool.Exec(ctx, `
		SELECT submission.apply_assignment_snapshot(
			$1, $2, $3, $4, gen_random_uuid(), gen_random_uuid(),
			clock_timestamp(), clock_timestamp() + interval '1 hour', 1::smallint, 'active', 1, $5::jsonb, 59
		)`, newID(t), unitTenantID, newID(t), newID(t), "["+executableItem(newID(t))+"]")
	require.Error(t, err, "a duration below one minute is refused")
}

// TestAnswersAreAcceptedDuringTheGrace proves a save that arrives just after
// the deadline lands and one after the grace is refused.
func TestAnswersAreAcceptedDuringTheGrace(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	pool := startSubmissionDatabase(ctx, t)

	save := func(overdueBy string) error {
		itemID := newID(t)
		fixture := seedAssignedAttempt(ctx, t, pool, "active", executableItem(itemID))
		overdue(ctx, t, pool, fixture, overdueBy)
		authorizeActorsInTenant(ctx, t, pool, fixture.CandidateID)
		var saveErr error
		asCandidate(ctx, t, pool, fixture.CandidateID, func(transaction pgx.Tx) {
			_, saveErr = transaction.Exec(ctx, `
				SELECT submission.append_answer_revision(
					$1, $2, $3, $4, $5, 'python3', 'candidate-source/t/a/r', repeat('d', 64), 'local/key-2', 1
				)`, newID(t), newID(t), unitTenantID, fixture.AttemptID, itemID)
		})
		return saveErr
	}

	require.NoError(t, save("5 seconds"), "a save five seconds late is inside the grace")
	requirePostgresCode(t, save("20 seconds"), "55000")
}

// TestTimeUpSubmitsTheLatestAnswers proves the expiry worker submits what a
// candidate saved when time runs out, exactly as their own submit would.
func TestTimeUpSubmitsTheLatestAnswers(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	pool := startSubmissionDatabase(ctx, t)

	answered, unanswered := newID(t), newID(t)
	late := seedAssignedAttempt(ctx, t, pool, "active", executableItem(answered), executableItem(unanswered))
	appendRevision := func(fixture gradingFixture, itemID string, number int) string {
		revisionID := newID(t)
		_, err := pool.Exec(ctx, `
			INSERT INTO submission.answer_revisions (
			    id, tenant_id, attempt_id, exam_item_id, revision_number, language_id,
			    source_object_key, source_checksum, encryption_key_reference, created_by)
			VALUES ($1, $2, $3, $4, $5, 'python3', 'candidate-source/t/a/r', repeat('c', 64), 'local/key-2', $6)`,
			revisionID, unitTenantID, fixture.AttemptID, itemID, number, fixture.CandidateID)
		require.NoError(t, err)
		return revisionID
	}
	appendRevision(late, answered, 1)
	latest := appendRevision(late, answered, 2)

	empty := seedAssignedAttempt(ctx, t, pool, "active", executableItem(newID(t)))
	graceItem := newID(t)
	inGrace := seedAssignedAttempt(ctx, t, pool, "active", executableItem(graceItem))
	appendRevision(inGrace, graceItem, 1)
	overdue(ctx, t, pool, late, "1 minute")
	overdue(ctx, t, pool, empty, "1 minute")
	overdue(ctx, t, pool, inGrace, "5 seconds")

	var processed int
	require.NoError(t, pool.QueryRow(ctx, `SELECT submission.expire_overdue_attempts(100)`).Scan(&processed))
	require.Equal(t, 2, processed, "only attempts past the grace are processed")

	state := func(fixture gradingFixture) (string, *time.Time) {
		var lifecycleState string
		var submittedAt *time.Time
		require.NoError(t, pool.QueryRow(ctx, `SELECT lifecycle_state, submitted_at FROM submission.attempts WHERE id = $1`,
			fixture.AttemptID).Scan(&lifecycleState, &submittedAt))
		return lifecycleState, submittedAt
	}
	lifecycleState, submittedAt := state(late)
	require.Equal(t, "grading", lifecycleState)
	require.NotNil(t, submittedAt)
	lifecycleState, _ = state(empty)
	require.Equal(t, "expired", lifecycleState, "an attempt with no answer has nothing to grade")
	lifecycleState, _ = state(inGrace)
	require.Equal(t, "active", lifecycleState, "an attempt still inside the grace is left alone")

	var requestID, revisionID, requestState, idempotencyKey string
	require.NoError(t, pool.QueryRow(ctx, `
		SELECT id::text, answer_revision_id::text, lifecycle_state, caller_idempotency_key
		FROM submission.evaluation_requests WHERE attempt_id = $1`, late.AttemptID,
	).Scan(&requestID, &revisionID, &requestState, &idempotencyKey))
	require.Equal(t, latest, revisionID, "the latest revision of the answered item is submitted")
	require.Equal(t, "queued", requestState, "the dispatcher picks it up like any other request")
	require.Equal(t, "time-up:"+latest, idempotencyKey)

	payloadKeys := func(eventType, aggregateID string) map[string]any {
		var raw []byte
		require.NoError(t, pool.QueryRow(ctx, `SELECT payload FROM app.outbox_events WHERE event_type = $1 AND aggregate_id = $2`,
			eventType, aggregateID).Scan(&raw), eventType)
		var payload map[string]any
		require.NoError(t, json.Unmarshal(raw, &payload))
		return payload
	}
	submitted := payloadKeys("submission.attempt_submitted.v1", late.AttemptID)
	require.Equal(t, float64(1), submitted["evaluation_request_count"])
	require.ElementsMatch(t, []string{"tenant_id", "attempt_id", "candidate_assignment_id", "candidate_id", "exam_id",
		"exam_version_id", "evaluation_request_count", "submitted_at"}, keys(submitted),
		"the payload is the one the service writes for a candidate's own submit")
	requested := payloadKeys("submission.evaluation_requested.v1", requestID)
	require.Equal(t, answered, requested["exam_item_id"])
	require.ElementsMatch(t, []string{"evaluation_request_id", "attempt_id", "answer_revision_id", "exam_item_id",
		"evaluation_bundle_object_key", "evaluation_bundle_checksum", "maximum_score", "caller_idempotency_key"}, keys(requested))
	payloadKeys("submission.attempt_expired.v1", empty.AttemptID)

	require.NoError(t, pool.QueryRow(ctx, `SELECT submission.expire_overdue_attempts(100)`).Scan(&processed))
	require.Zero(t, processed, "a processed attempt is never submitted twice")
}

// overdue moves an attempt's start and deadline into the past; created_at
// moves too because the table requires deadline >= created_at.
func overdue(ctx context.Context, t *testing.T, pool *pgxpool.Pool, fixture gradingFixture, by string) {
	t.Helper()
	_, err := pool.Exec(ctx, `
		UPDATE submission.attempts
		SET created_at = clock_timestamp() - interval '2 hours', started_at = clock_timestamp() - interval '2 hours',
		    submission_deadline = clock_timestamp() - $2::interval
		WHERE id = $1`, fixture.AttemptID, by)
	require.NoError(t, err)
}

func intPointer(value int) *int { return &value }

func keys(payload map[string]any) []string {
	names := make([]string, 0, len(payload))
	for name := range payload {
		names = append(names, name)
	}
	return names
}
