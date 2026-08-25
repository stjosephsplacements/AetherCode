//go:build integration

package repo_test

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"

	"github.com/aethercode/aethercode/libs/pkg/testutil/integration"
)

// startSubmissionDatabase starts a disposable PostgreSQL container, provisions
// the six database roles Submission's migrations require, and applies every
// migration. Both integration tests in this package use it so the role
// topology is described exactly once.
func startSubmissionDatabase(ctx context.Context, t *testing.T) *pgxpool.Pool {
	t.Helper()

	pool := integration.StartPostgres(ctx, t)

	for _, statement := range []string{
		`CREATE ROLE aether_submission_owner       NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
		`CREATE ROLE aether_submission_migrator    NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
		`CREATE ROLE aether_submission_app         NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
		`CREATE ROLE aether_submission_authz_reader NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
		`CREATE ROLE aether_submission_projection_worker NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
		// A separate runtime identity required by migration 000010 (judge
		// completion bridge); it never touches candidate tables directly.
		`CREATE ROLE aether_submission_judge_adapter NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
		// Migrator must be a member of owner so SET ROLE aether_submission_owner works.
		`GRANT aether_submission_owner TO aether_submission_migrator`,
		// Transfer ownership so the migration can REVOKE on the public schema.
		`ALTER DATABASE testdb OWNER TO aether_submission_owner`,
		`ALTER SCHEMA public OWNER TO aether_submission_owner`,
		// Pre-create the migration version table owned by aether_submission_owner.
		`CREATE TABLE public.schema_migrations (version bigint NOT NULL PRIMARY KEY, dirty boolean NOT NULL)`,
		`ALTER TABLE public.schema_migrations OWNER TO aether_submission_owner`,
	} {
		_, err := pool.Exec(ctx, statement)
		require.NoError(t, err, "pre-migration setup: %s", statement[:min(len(statement), 60)])
	}

	_, file, _, _ := runtime.Caller(0)
	migrationsDir, err := filepath.Abs(filepath.Join(filepath.Dir(file), "../../..", "migrations"))
	require.NoError(t, err)
	integration.ApplyMigrations(ctx, t, pool, migrationsDir)
	return pool
}

// Fixed UUIDv7 literals: submission.ingest_judge_completion refuses any
// correlation identifier that is not a version-7 UUID.
const (
	unitTenantID            = "018f4b0d-08f8-7c09-9ba7-efdf9c340001"
	unitCandidateID         = "018f4b0d-08f8-7c09-9ba7-efdf9c340002"
	unitOtherCandidateID    = "018f4b0d-08f8-7c09-9ba7-efdf9c340003"
	unitReviewerID          = "018f4b0d-08f8-7c09-9ba7-efdf9c340004"
	unitAttemptID           = "018f4b0d-08f8-7c09-9ba7-efdf9c340005"
	unitExamItemID          = "018f4b0d-08f8-7c09-9ba7-efdf9c340006"
	unitAnswerRevisionID    = "018f4b0d-08f8-7c09-9ba7-efdf9c340007"
	unitEvaluationRequestID = "018f4b0d-08f8-7c09-9ba7-efdf9c340008"
	unitJudgeJobID          = "018f4b0d-08f8-7c09-9ba7-efdf9c340009"
	unitJudgeEventID        = "018f4b0d-08f8-7c09-9ba7-efdf9c34000a"
	unitDeliveryID          = "018f4b0d-08f8-7c09-9ba7-efdf9c34000b"
	unitLeaseID             = "018f4b0d-08f8-7c09-9ba7-efdf9c34000c"
	unitIngressOutboxID     = "018f4b0d-08f8-7c09-9ba7-efdf9c34000d"
	unitReceiptID           = "018f4b0d-08f8-7c09-9ba7-efdf9c34000e"
	unitAttemptEventID      = "018f4b0d-08f8-7c09-9ba7-efdf9c34000f"
	unitScoreSummaryID      = "018f4b0d-08f8-7c09-9ba7-efdf9c340010"
	unitGradedOutboxID      = "018f4b0d-08f8-7c09-9ba7-efdf9c340011"
)

// TestJudgeReceiptUnitVisibility proves the access-control boundary that makes
// per-unit persistence safe: the same attempt yields only redacted counts to
// its candidate, and the full breakdown only to a caller holding a capability
// signed for submission.judge_receipts. The boundary lives in the database
// routines, not in Go, so it is exercised there.
func TestJudgeReceiptUnitVisibility(t *testing.T) {
	t.Parallel()
	ctx := context.Background()

	pool := startSubmissionDatabase(ctx, t)

	for _, statement := range []string{
		`INSERT INTO submission.attempts (
		     id, tenant_id, exam_id, exam_version_id, candidate_id, candidate_assignment_id,
		     attempt_number, lifecycle_state, available_from, started_at, submitted_at, submission_deadline)
		 VALUES ('` + unitAttemptID + `', '` + unitTenantID + `', gen_random_uuid(), gen_random_uuid(),
		         '` + unitCandidateID + `', gen_random_uuid(), 1, 'grading',
		         clock_timestamp(), clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '1 hour')`,
		`INSERT INTO submission.answer_revisions (
		     id, tenant_id, attempt_id, exam_item_id, revision_number, language_id,
		     source_object_key, source_checksum, encryption_key_reference, created_by)
		 VALUES ('` + unitAnswerRevisionID + `', '` + unitTenantID + `', '` + unitAttemptID + `',
		         '` + unitExamItemID + `', 1, 'go-1.26', 'sources/unit.enc', repeat('a', 64),
		         'kms://india/source', '` + unitCandidateID + `')`,
		`INSERT INTO submission.evaluation_requests (
		     id, tenant_id, attempt_id, answer_revision_id, evaluation_bundle_object_key,
		     evaluation_bundle_checksum, caller_idempotency_key, judge_job_id, maximum_score)
		 VALUES ('` + unitEvaluationRequestID + `', '` + unitTenantID + `', '` + unitAttemptID + `',
		         '` + unitAnswerRevisionID + `', 'bundles/unit.enc', repeat('b', 64),
		         'submission:unit-results', '` + unitJudgeJobID + `', 10)`,
		`INSERT INTO authz.actor_tenant_authorizations
		     (actor_id, tenant_id, authz_revision, is_authorized, grant_kind, grant_source_id)
		 VALUES ('` + unitCandidateID + `', '` + unitTenantID + `', 1, true, 'tenant', '` + unitTenantID + `'),
		        ('` + unitOtherCandidateID + `', '` + unitTenantID + `', 1, true, 'tenant', '` + unitTenantID + `'),
		        ('` + unitReviewerID + `', '` + unitTenantID + `', 1, true, 'tenant', '` + unitTenantID + `')`,
		`INSERT INTO authz.principal_authorization_revisions (actor_id, authz_revision)
		 VALUES ('` + unitCandidateID + `', 1), ('` + unitOtherCandidateID + `', 1), ('` + unitReviewerID + `', 1)`,
		`UPDATE authz.authorization_projection_resync_state
		 SET projection_ready = true, active_resync_id = gen_random_uuid(),
		     completion_event_id = gen_random_uuid(), expected_snapshot_count = 0,
		     expected_manifest_sha256 = decode(repeat('00', 32), 'hex')
		 WHERE singleton = true`,
	} {
		_, err := pool.Exec(ctx, statement)
		require.NoError(t, err, "seed statement: %s", statement[:min(len(statement), 60)])
	}

	// Drive the real ingestion and reconciliation routines rather than
	// inserting judge_receipt_units directly: the point under test is that the
	// breakdown recorded at ingress reaches the receipt.
	_, err := pool.Exec(ctx, `
		SELECT submission.ingest_judge_completion(
			$1, $2, $3, $4, 'submission-judge-completion', $5, $6, 'wrong_answer', 21, 4096,
			NULL, NULL, NULL, '2026-08-24T09:00:00.000000Z'::timestamptz, $7::jsonb
		)`,
		unitIngressOutboxID, unitJudgeEventID, unitDeliveryID, unitLeaseID,
		unitEvaluationRequestID, unitJudgeJobID,
		`[{"unit_number":0,"verdict":"accepted","execution_time_ms":8,"memory_kib":1024},
		  {"unit_number":1,"verdict":"wrong_answer","execution_time_ms":9,"memory_kib":1088}]`,
	)
	require.NoError(t, err, "ingest judge completion")

	var graded bool
	err = pool.QueryRow(ctx, `
		SELECT submission.record_judge_completion(
			$1, $2, $3, $4, $5, $6, $7, $8, 'wrong_answer', 21, 4096, NULL, NULL, NULL,
			'2026-08-24T09:00:00.000000Z'::timestamptz
		)`,
		unitReceiptID, unitAttemptEventID, unitScoreSummaryID, unitGradedOutboxID,
		unitTenantID, unitEvaluationRequestID, unitJudgeJobID, unitJudgeEventID,
	).Scan(&graded)
	require.NoError(t, err, "record judge completion")
	require.True(t, graded, "the completion should have finalized the attempt")

	var persistedUnits int
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT count(*) FROM submission.judge_receipt_units WHERE judge_receipt_id = $1`,
		unitReceiptID,
	).Scan(&persistedUnits))
	require.Equal(t, 2, persistedUnits, "reconciliation must materialize every ingress unit")

	tests := []struct {
		name             string
		actorID          string
		contextResource  string
		query            string
		wantErrorCode    string
		wantSubstrings   []string
		wantAbsentTokens []string
	}{
		{
			name:            "candidate reads redacted counts for their own attempt",
			actorID:         unitCandidateID,
			contextResource: "submission.attempts",
			query:           `SELECT submission.get_attempt_unit_summary_for_candidate($1, $2)`,
			wantSubstrings:  []string{`"passed_units": 1`, `"total_units": 2`, unitExamItemID},
			// The identity of the failing test case must not appear anywhere.
			wantAbsentTokens: []string{"unit_number", "wrong_answer", "execution_time_ms", "memory_kib"},
		},
		{
			name:            "candidate is refused the per-unit breakdown",
			actorID:         unitCandidateID,
			contextResource: "submission.attempts",
			query:           `SELECT submission.list_attempt_unit_results($1, $2)`,
			wantErrorCode:   "42501",
		},
		{
			name:             "reviewer capability reads the full breakdown",
			actorID:          unitReviewerID,
			contextResource:  "submission.judge_receipts",
			query:            `SELECT submission.list_attempt_unit_results($1, $2)`,
			wantSubstrings:   []string{`"unit_number": 1`, `"verdict": "wrong_answer"`, `"execution_time_ms": 9`, `"passed_units": 1`},
			wantAbsentTokens: []string{"stdout", "stderr", "expected_output"},
		},
		{
			name:            "reviewer capability does not double as a candidate capability",
			actorID:         unitReviewerID,
			contextResource: "submission.judge_receipts",
			query:           `SELECT submission.get_attempt_unit_summary_for_candidate($1, $2)`,
			wantErrorCode:   "42501",
		},
		{
			name:            "another candidate cannot read this attempt's counts",
			actorID:         unitOtherCandidateID,
			contextResource: "submission.attempts",
			query:           `SELECT submission.get_attempt_unit_summary_for_candidate($1, $2)`,
			wantErrorCode:   "P0001",
		},
	}

	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()

			transaction, err := pool.Begin(ctx)
			require.NoError(t, err)
			defer transaction.Rollback(ctx) //nolint:errcheck

			var contextID string
			require.NoError(t, transaction.QueryRow(ctx, `
				INSERT INTO authz.request_contexts
				    (context_id, capability_id, backend_pid, transaction_id, actor_id, tenant_id,
				     authz_revision, action, resource, issued_at, expires_at)
				VALUES (gen_random_uuid(), gen_random_uuid(), pg_backend_pid(), txid_current(),
				        $1, $2, 1, 'submission.read', $3,
				        clock_timestamp(), clock_timestamp() + interval '4 seconds')
				RETURNING context_id::text`,
				testCase.actorID, unitTenantID, testCase.contextResource,
			).Scan(&contextID))
			_, err = transaction.Exec(ctx, `SELECT set_config('app.authz_context_id', $1, true)`, contextID)
			require.NoError(t, err)
			_, err = transaction.Exec(ctx, `SET LOCAL ROLE aether_submission_app`)
			require.NoError(t, err)

			var raw json.RawMessage
			queryErr := transaction.QueryRow(ctx, testCase.query, unitTenantID, unitAttemptID).Scan(&raw)

			if testCase.wantErrorCode != "" {
				require.Error(t, queryErr, "expected the routine to fail closed")
				var postgresError *pgconn.PgError
				require.True(t, errors.As(queryErr, &postgresError), "expected *pgconn.PgError, got %T: %v", queryErr, queryErr)
				require.Equal(t, testCase.wantErrorCode, postgresError.Code, "message: %s", postgresError.Message)
				return
			}

			require.NoError(t, queryErr)
			indented, err := json.MarshalIndent(json.RawMessage(raw), "", " ")
			require.NoError(t, err)
			body := string(indented)
			for _, want := range testCase.wantSubstrings {
				require.Contains(t, body, want)
			}
			for _, absent := range testCase.wantAbsentTokens {
				require.False(t, strings.Contains(body, absent), "response leaked %q: %s", absent, body)
			}
		})
	}
}
