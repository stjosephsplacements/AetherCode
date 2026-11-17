//go:build integration

package repo_test

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"
)

func TestProctorGridListsActiveAttemptsWithCountsAndSnapshots(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	pool := startSubmissionDatabase(ctx, t)

	noisy := seedAssignedAttempt(ctx, t, pool, "active", executableItem(newID(t)))
	quiet := seedAssignedAttempt(ctx, t, pool, "active", executableItem(newID(t)))
	done := seedAssignedAttempt(ctx, t, pool, "active", executableItem(newID(t)))
	var examVersionID string
	require.NoError(t, pool.QueryRow(ctx, `SELECT exam_version_id::text FROM submission.attempts WHERE id = $1`, noisy.AttemptID).Scan(&examVersionID))
	_, err := pool.Exec(ctx, `UPDATE submission.attempts SET exam_version_id = $1 WHERE id = ANY($2::uuid[])`,
		examVersionID, []string{quiet.AttemptID, done.AttemptID})
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `UPDATE submission.attempts SET lifecycle_state = 'cancelled', completed_at = clock_timestamp() WHERE id = $1`, done.AttemptID)
	require.NoError(t, err)

	record := func(attemptID, kind string) {
		_, err := pool.Exec(ctx, `SELECT submission.record_attempt_violation($1, $2, $3, clock_timestamp())`, unitTenantID, attemptID, kind)
		require.NoError(t, err)
	}
	record(noisy.AttemptID, "phone_detected")
	record(noisy.AttemptID, "phone_detected")
	record(noisy.AttemptID, "face_missing")
	_, err = pool.Exec(ctx, `INSERT INTO submission.attempt_snapshots (tenant_id, attempt_id, captured_at, storage_key, size_bytes)
		VALUES ($1, $2, clock_timestamp() - interval '1 minute', 'old', 10), ($1, $2, clock_timestamp(), 'new', 10)`, unitTenantID, noisy.AttemptID)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `SELECT submission.set_assignment_proctor_policy($1, $2, (SELECT version FROM submission.assignment_projections WHERE candidate_assignment_id = $2), '{"max_violations":3}')`,
		unitTenantID, noisy.AssignmentID)
	require.NoError(t, err)

	type gridRow struct {
		attemptID  string
		storageKey *string
		total, max int
		kinds      string
	}
	staff := uuid.NewString()
	authorizeActorsInTenant(ctx, t, pool, staff)
	read := func(resource string) ([]gridRow, error) {
		tx, err := pool.Begin(ctx)
		require.NoError(t, err)
		defer tx.Rollback(ctx) //nolint:errcheck
		var contextID string
		require.NoError(t, tx.QueryRow(ctx, `
			INSERT INTO authz.request_contexts
			    (context_id, capability_id, backend_pid, transaction_id, actor_id, tenant_id,
			     authz_revision, action, resource, issued_at, expires_at)
			VALUES (gen_random_uuid(), gen_random_uuid(), pg_backend_pid(), txid_current(), $1, $2, 1,
			        'submission.read', $3, clock_timestamp(), clock_timestamp() + interval '4 seconds')
			RETURNING context_id::text`, staff, unitTenantID, resource).Scan(&contextID))
		_, err = tx.Exec(ctx, `SELECT set_config('app.authz_context_id', $1, true)`, contextID)
		require.NoError(t, err)
		_, err = tx.Exec(ctx, `SET LOCAL ROLE aether_submission_app`)
		require.NoError(t, err)
		rows, err := tx.Query(ctx, `SELECT attempt_id::text, storage_key, violation_total, violation_kinds::text, COALESCE(max_violations, 0)
			FROM submission.proctor_grid($1, $2, 50)`, unitTenantID, examVersionID)
		if err != nil {
			return nil, err
		}
		return pgx.CollectRows(rows, func(row pgx.CollectableRow) (gridRow, error) {
			var r gridRow
			return r, row.Scan(&r.attemptID, &r.storageKey, &r.total, &r.kinds, &r.max)
		})
	}

	grid, err := read("submission.proctor_evidence")
	require.NoError(t, err)
	require.Len(t, grid, 2, "a cancelled attempt is left out")
	require.Equal(t, noisy.AttemptID, grid[0].attemptID, "the noisiest attempt comes first")
	require.Equal(t, 3, grid[0].total)
	require.Equal(t, 3, grid[0].max)
	require.NotNil(t, grid[0].storageKey)
	require.Equal(t, "new", *grid[0].storageKey, "the newest snapshot is shown")
	require.JSONEq(t, `{"phone_detected":2,"face_missing":1}`, grid[0].kinds)
	require.Equal(t, quiet.AttemptID, grid[1].attemptID)
	require.Nil(t, grid[1].storageKey)
	require.Zero(t, grid[1].total)

	_, err = read("submission.attempts")
	require.Error(t, err, "the grid needs the proctor_evidence resource")
}
