//go:build integration

package repo_test

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/stretchr/testify/require"
)

// TestCodeRunLifecycle drives a run through every routine (ADR-0021): the
// candidate starts it, the Judge adapter claims, dispatches and completes it,
// and the candidate reads it back. No grading record is ever written.
func TestCodeRunLifecycle(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	pool := startSubmissionDatabase(ctx, t)

	executable, legacy := newID(t), newID(t)
	fixture := seedAssignedAttempt(ctx, t, pool, "active", executableItem(executable), legacyItem(legacy))
	authorizeActorsInTenant(ctx, t, pool, fixture.CandidateID)

	start := func(examItemID, language string) (map[string]any, error) {
		var run map[string]any
		var startErr error
		asCandidate(ctx, t, pool, fixture.CandidateID, func(transaction pgx.Tx) {
			var raw []byte
			startErr = transaction.QueryRow(ctx, `
				SELECT submission.start_code_run($1, $2, $3, $4, $5, 'candidate-source/t/a/runs/r', repeat('e', 64), 'local/key-2')`,
				newID(t), unitTenantID, fixture.AttemptID, examItemID, language).Scan(&raw)
			if startErr == nil {
				require.NoError(t, json.Unmarshal(raw, &run))
				require.NoError(t, transaction.Commit(ctx))
			}
		})
		return run, startErr
	}
	requireCandidateDetail := func(err error, want string) {
		t.Helper()
		var postgresError *pgconn.PgError
		require.True(t, errors.As(err, &postgresError), "got %v", err)
		require.Equal(t, "55000", postgresError.Code)
		require.Equal(t, "candidate: "+want, postgresError.Detail)
	}

	first, err := start(executable, "python3")
	require.NoError(t, err)
	require.Equal(t, "queued", first["lifecycle_state"])
	_, err = start(legacy, "python3")
	requireCandidateDetail(err, "This question has no sample tests to run.")
	_, err = start(executable, "go")
	requirePostgresCode(t, err, "22023")
	second, err := start(executable, "c")
	require.NoError(t, err)
	_, err = start(executable, "python3")
	requireCandidateDetail(err, "Your previous run is still being judged. Wait for it to finish.")

	type claimed struct {
		RunID, BundleKey, BundleChecksum, SourceKey, Language string
		BundleKeyReference                                    *string
		TimeLimitMS                                           *int
	}
	var claims []claimed
	asRole(ctx, t, pool, "aether_submission_judge_adapter", func(transaction pgx.Tx) {
		rows, err := transaction.Query(ctx, `
			SELECT code_run_id::text, sample_bundle_object_key, sample_bundle_checksum, source_object_key, language_id,
			       sample_bundle_key_reference, time_limit_ms
			FROM submission.claim_code_runs(10, 30)`)
		require.NoError(t, err)
		for rows.Next() {
			var row claimed
			require.NoError(t, rows.Scan(&row.RunID, &row.BundleKey, &row.BundleChecksum, &row.SourceKey, &row.Language,
				&row.BundleKeyReference, &row.TimeLimitMS))
			claims = append(claims, row)
		}
		require.NoError(t, rows.Err())
		require.NoError(t, transaction.Commit(ctx))
	})
	require.Len(t, claims, 2)
	require.Equal(t, first["id"], claims[0].RunID, "runs are claimed oldest first")
	require.Equal(t, "bundles/sample.enc", claims[0].BundleKey, "a run carries the sample bundle, never the evaluation bundle")
	require.Equal(t, strings.Repeat("b", 64), claims[0].BundleChecksum)
	require.Equal(t, "local/key-1", *claims[0].BundleKeyReference)
	require.Equal(t, "candidate-source/t/a/runs/r", claims[0].SourceKey)
	require.Equal(t, 2000, *claims[0].TimeLimitMS)

	jobID := newID(t)
	units := `[
		{"unit_number":0,"verdict":"accepted","stdin":"1 2\n","expected_output":"3\n","stdout":"3\n","stderr":"","compile_output":"","execution_time_ms":12,"memory_kib":4096},
		{"unit_number":1,"verdict":"wrong_answer","stdin":"5 7\n","expected_output":"12\n","stdout":"13\n","stderr":"","compile_output":"","execution_time_ms":11,"memory_kib":4096}
	]`
	asRole(ctx, t, pool, "aether_submission_judge_adapter", func(transaction pgx.Tx) {
		var recorded bool
		require.NoError(t, transaction.QueryRow(ctx, `SELECT submission.mark_code_run_dispatched($1, $2, $3)`,
			unitTenantID, first["id"], jobID).Scan(&recorded))
		require.True(t, recorded)
		var tenantID, runID string
		require.NoError(t, transaction.QueryRow(ctx, `SELECT tenant_id::text, code_run_id::text FROM submission.code_run_for_job($1)`,
			jobID).Scan(&tenantID, &runID))
		require.Equal(t, first["id"], runID)
		require.NoError(t, transaction.QueryRow(ctx, `SELECT submission.record_code_run_completion($1, $2, $3, 'wrong_answer', $4::jsonb)`,
			unitTenantID, first["id"], jobID, units).Scan(&recorded))
		require.True(t, recorded)
		require.NoError(t, transaction.QueryRow(ctx, `SELECT submission.record_code_run_completion($1, $2, $3, 'wrong_answer', $4::jsonb)`,
			unitTenantID, first["id"], jobID, units).Scan(&recorded))
		require.False(t, recorded, "a replayed completion changes nothing")
		require.NoError(t, transaction.Commit(ctx))
	})
	asRole(ctx, t, pool, "aether_submission_judge_adapter", func(transaction pgx.Tx) {
		_, err := transaction.Exec(ctx, `SELECT submission.record_code_run_completion($1, $2, $3, 'accepted', '[]'::jsonb)`,
			unitTenantID, second["id"], newID(t))
		requirePostgresCode(t, err, "22023")
	})

	var run struct {
		LifecycleState string  `json:"lifecycle_state"`
		Verdict        *string `json:"verdict"`
		Units          []struct {
			Verdict        string  `json:"verdict"`
			Stdin          *string `json:"stdin"`
			ExpectedOutput *string `json:"expected_output"`
			Stdout         *string `json:"stdout"`
		} `json:"units"`
	}
	asCandidate(ctx, t, pool, fixture.CandidateID, func(transaction pgx.Tx) {
		var raw []byte
		require.NoError(t, transaction.QueryRow(ctx, `SELECT submission.get_code_run($1, $2, $3)`,
			unitTenantID, fixture.AttemptID, first["id"]).Scan(&raw))
		require.NoError(t, json.Unmarshal(raw, &run))
	})
	require.Equal(t, "completed", run.LifecycleState)
	require.Equal(t, "wrong_answer", *run.Verdict)
	require.Len(t, run.Units, 2)
	require.Equal(t, "5 7\n", *run.Units[1].Stdin)
	require.Equal(t, "12\n", *run.Units[1].ExpectedOutput)
	require.Equal(t, "13\n", *run.Units[1].Stdout, "a run shows the candidate their program's output")

	var listed []struct {
		ID          string `json:"id"`
		PassedUnits int    `json:"passed_units"`
		TotalUnits  int    `json:"total_units"`
	}
	asCandidate(ctx, t, pool, fixture.CandidateID, func(transaction pgx.Tx) {
		var raw []byte
		require.NoError(t, transaction.QueryRow(ctx, `SELECT submission.list_code_runs($1, $2, $3, 10, NULL, NULL)`,
			unitTenantID, fixture.AttemptID, executable).Scan(&raw))
		require.NoError(t, json.Unmarshal(raw, &listed))
	})
	require.Len(t, listed, 2)
	require.Equal(t, second["id"], listed[0].ID, "newest first")
	require.Equal(t, 1, listed[1].PassedUnits)
	require.Equal(t, 2, listed[1].TotalUnits)

	other := newID(t)
	authorizeActorsInTenant(ctx, t, pool, other)
	asCandidate(ctx, t, pool, other, func(transaction pgx.Tx) {
		_, err := transaction.Exec(ctx, `SELECT submission.get_code_run($1, $2, $3)`, unitTenantID, fixture.AttemptID, first["id"])
		requirePostgresCode(t, err, "P0001")
	})

	var gradingRecords int
	require.NoError(t, pool.QueryRow(ctx, `SELECT count(*) FROM submission.evaluation_requests WHERE attempt_id = $1`,
		fixture.AttemptID).Scan(&gradingRecords))
	require.Zero(t, gradingRecords, "a run never creates grading work")
}

// TestCodeRunsCloseWithTheAttempt proves a run is refused once the attempt's
// grace has passed.
func TestCodeRunsCloseWithTheAttempt(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	pool := startSubmissionDatabase(ctx, t)
	itemID := newID(t)
	fixture := seedAssignedAttempt(ctx, t, pool, "active", executableItem(itemID))
	overdue(ctx, t, pool, fixture, "20 seconds")
	authorizeActorsInTenant(ctx, t, pool, fixture.CandidateID)
	asCandidate(ctx, t, pool, fixture.CandidateID, func(transaction pgx.Tx) {
		_, err := transaction.Exec(ctx, `
			SELECT submission.start_code_run($1, $2, $3, $4, 'python3', 'candidate-source/t/a/runs/r', repeat('e', 64), 'local/key-2')`,
			newID(t), unitTenantID, fixture.AttemptID, itemID)
		requirePostgresCode(t, err, "55000")
	})
}
