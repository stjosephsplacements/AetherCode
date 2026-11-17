//go:build integration

package repo_test

import (
	"context"
	"encoding/json"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestSubmitAttemptForViolation(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	pool := startSubmissionDatabase(ctx, t)

	itemID := newID(t)
	answered := seedAssignedAttempt(ctx, t, pool, "active", executableItem(itemID))
	revisionID := newID(t)
	_, err := pool.Exec(ctx, `
		INSERT INTO submission.answer_revisions (
		    id, tenant_id, attempt_id, exam_item_id, revision_number, language_id,
		    source_object_key, source_checksum, encryption_key_reference, created_by)
		VALUES ($1, $2, $3, $4, 1, 'python3', 'candidate-source/t/a/r', repeat('c', 64), 'local/key-2', $5)`,
		revisionID, unitTenantID, answered.AttemptID, itemID, answered.CandidateID)
	require.NoError(t, err)
	empty := seedAssignedAttempt(ctx, t, pool, "active", executableItem(newID(t)))

	submit := func(attemptID string) bool {
		var done bool
		require.NoError(t, pool.QueryRow(ctx, `SELECT submission.submit_attempt_for_violation($1::uuid, $2::uuid, 'proctor_violation_threshold_breach')`,
			unitTenantID, attemptID).Scan(&done))
		return done
	}

	require.True(t, submit(answered.AttemptID))
	var state string
	require.NoError(t, pool.QueryRow(ctx, `SELECT lifecycle_state FROM submission.attempts WHERE id = $1`, answered.AttemptID).Scan(&state))
	require.Equal(t, "grading", state)

	var key string
	require.NoError(t, pool.QueryRow(ctx, `SELECT caller_idempotency_key FROM submission.evaluation_requests WHERE attempt_id = $1`,
		answered.AttemptID).Scan(&key))
	require.Equal(t, "violation:"+revisionID, key, "the latest answer is queued for evaluation")

	var raw []byte
	require.NoError(t, pool.QueryRow(ctx, `
		SELECT payload FROM submission.attempt_events WHERE attempt_id = $1 AND event_type = 'submission.attempt.submitted.v1'`,
		answered.AttemptID).Scan(&raw))
	var payload map[string]any
	require.NoError(t, json.Unmarshal(raw, &payload))
	require.Equal(t, "proctor_violation_threshold_breach", payload["reason"])

	require.False(t, submit(answered.AttemptID), "an attempt that is no longer open is left alone")

	var foreign bool
	require.NoError(t, pool.QueryRow(ctx, `SELECT submission.submit_attempt_for_violation($1::uuid, $2::uuid, 'proctor_violation_threshold_breach')`,
		uuid.NewString(), empty.AttemptID).Scan(&foreign))
	require.False(t, foreign, "a breach from another tenant cannot close the attempt")

	require.True(t, submit(empty.AttemptID))
	require.NoError(t, pool.QueryRow(ctx, `SELECT lifecycle_state FROM submission.attempts WHERE id = $1`, empty.AttemptID).Scan(&state))
	require.Equal(t, "expired", state, "an attempt with no answer has nothing to grade")

	_, err = pool.Exec(ctx, `SELECT submission.submit_attempt_for_violation($1::uuid, $2::uuid, '')`, unitTenantID, answered.AttemptID)
	require.Error(t, err, "a reason is required")
}

func TestAssignmentProctorPolicyIsProjectedAndReadByTheCandidate(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	pool := startSubmissionDatabase(ctx, t)
	fixture := seedAssignedAttempt(ctx, t, pool, "active", executableItem(newID(t)))

	var version int64
	require.NoError(t, pool.QueryRow(ctx, `SELECT version FROM submission.assignment_projections WHERE candidate_assignment_id = $1`,
		fixture.AssignmentID).Scan(&version))
	authorizeActorsInTenant(ctx, t, pool, fixture.CandidateID)
	read := func() []byte {
		var policy []byte
		asCandidate(ctx, t, pool, fixture.CandidateID, func(transaction pgx.Tx) {
			require.NoError(t, transaction.QueryRow(ctx, `SELECT submission.get_attempt_proctor_policy($1, $2)`,
				unitTenantID, fixture.AttemptID).Scan(&policy))
		})
		return policy
	}
	require.Nil(t, read(), "no policy until one is projected")

	set := func(at int64, policy any) {
		_, err := pool.Exec(ctx, `SELECT submission.set_assignment_proctor_policy($1, $2, $3, $4::jsonb)`,
			unitTenantID, fixture.AssignmentID, at, policy)
		require.NoError(t, err)
	}
	set(version, `{"enabled":true,"max_violations":3}`)
	require.JSONEq(t, `{"enabled":true,"max_violations":3}`, string(read()))

	set(version-1, `{"enabled":false}`)
	require.JSONEq(t, `{"enabled":true,"max_violations":3}`, string(read()), "a policy for another version is ignored")

	_, err := pool.Exec(ctx, `SELECT submission.set_assignment_proctor_policy($1, $2, $3, '[]'::jsonb)`, unitTenantID, fixture.AssignmentID, version)
	require.Error(t, err, "a policy must be a JSON object")
}

func TestStoreSnapshotRequiresTheCallersOwnAttempt(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	pool := startSubmissionDatabase(ctx, t)
	mine := seedAssignedAttempt(ctx, t, pool, "active", executableItem(newID(t)))
	theirs := seedAssignedAttempt(ctx, t, pool, "active", executableItem(newID(t)))
	authorizeActorsInTenant(ctx, t, pool, mine.CandidateID)

	store := func(attemptID string) error {
		var err error
		asCandidate(ctx, t, pool, mine.CandidateID, func(transaction pgx.Tx) {
			_, err = transaction.Exec(ctx, `SELECT submission.store_snapshot($1, $2, clock_timestamp(), 'k', 100)`, unitTenantID, attemptID)
		})
		return err
	}
	require.NoError(t, store(mine.AttemptID))
	require.Error(t, store(theirs.AttemptID), "frames for another candidate's attempt are refused")

	_, err := pool.Exec(ctx, `UPDATE submission.attempts SET lifecycle_state = 'cancelled', completed_at = clock_timestamp() WHERE id = $1`, mine.AttemptID)
	require.NoError(t, err)
	require.Error(t, store(mine.AttemptID), "frames for a closed attempt are refused")

	asCandidate(ctx, t, pool, mine.CandidateID, func(transaction pgx.Tx) {
		_, insertErr := transaction.Exec(ctx, `INSERT INTO submission.attempt_snapshots (tenant_id, attempt_id, captured_at, storage_key, size_bytes)
			VALUES ($1, $2, clock_timestamp(), 'k', 10)`, unitTenantID, theirs.AttemptID)
		require.Error(t, insertErr, "the app role has no direct access to the snapshot table")
	})
}

// A frame in flight holds the attempt row, so a concurrent submit waits for it instead of
// closing the attempt between the open check and the insert.
func TestStoreSnapshotLocksTheAttemptAgainstConcurrentSubmit(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	pool := startSubmissionDatabase(ctx, t)
	fixture := seedAssignedAttempt(ctx, t, pool, "active", executableItem(newID(t)))
	authorizeActorsInTenant(ctx, t, pool, fixture.CandidateID)

	asCandidate(ctx, t, pool, fixture.CandidateID, func(transaction pgx.Tx) {
		_, err := transaction.Exec(ctx, `SELECT submission.store_snapshot($1, $2, clock_timestamp(), 'k', 100)`, unitTenantID, fixture.AttemptID)
		require.NoError(t, err)

		competing, err := pool.Begin(ctx)
		require.NoError(t, err)
		defer func() { _ = competing.Rollback(ctx) }()
		_, err = competing.Exec(ctx, `SET LOCAL lock_timeout = '300ms'`)
		require.NoError(t, err)
		_, err = competing.Exec(ctx, `UPDATE submission.attempts SET lifecycle_state = 'cancelled', completed_at = clock_timestamp() WHERE id = $1`, fixture.AttemptID)
		var pgErr *pgconn.PgError
		require.ErrorAs(t, err, &pgErr)
		require.Equal(t, "55P03", pgErr.Code, "the submit must wait on the frame's row lock")
	})
}
