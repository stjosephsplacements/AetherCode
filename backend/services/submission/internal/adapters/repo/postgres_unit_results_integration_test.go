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

// dispatchedRequest is the minimum locally-bound work an ingested completion
// must correlate to before the ingress routine will accept it.
type dispatchedRequest struct {
	AttemptID           string
	CandidateID         string
	ExamItemID          string
	AnswerRevisionID    string
	EvaluationRequestID string
	JudgeJobID          string
	RevisionNumber      int
}

func seedGradingAttempt(ctx context.Context, t *testing.T, pool *pgxpool.Pool, attemptID, candidateID string) {
	t.Helper()

	_, err := pool.Exec(ctx, `
		INSERT INTO submission.attempts (
		    id, tenant_id, exam_id, exam_version_id, candidate_id, candidate_assignment_id,
		    attempt_number, lifecycle_state, available_from, started_at, submitted_at, submission_deadline)
		VALUES ($1, $2, gen_random_uuid(), gen_random_uuid(), $3, gen_random_uuid(), 1, 'grading',
		        clock_timestamp(), clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '1 hour')`,
		attemptID, unitTenantID, candidateID)
	require.NoError(t, err, "seed grading attempt")
}

func seedDispatchedEvaluationRequest(ctx context.Context, t *testing.T, pool *pgxpool.Pool, request dispatchedRequest) {
	t.Helper()

	_, err := pool.Exec(ctx, `
		INSERT INTO submission.answer_revisions (
		    id, tenant_id, attempt_id, exam_item_id, revision_number, language_id,
		    source_object_key, source_checksum, encryption_key_reference, created_by)
		VALUES ($1, $2, $3, $4, $5, 'go-1.26', 'sources/unit.enc', repeat('a', 64),
		        'kms://india/source', $6)`,
		request.AnswerRevisionID, unitTenantID, request.AttemptID, request.ExamItemID,
		request.RevisionNumber, request.CandidateID)
	require.NoError(t, err, "seed answer revision")

	_, err = pool.Exec(ctx, `
		INSERT INTO submission.evaluation_requests (
		    id, tenant_id, attempt_id, answer_revision_id, evaluation_bundle_object_key,
		    evaluation_bundle_checksum, caller_idempotency_key, judge_job_id, maximum_score)
		VALUES ($1, $2, $3, $4, 'bundles/unit.enc', repeat('b', 64), $5, $6, 10)`,
		request.EvaluationRequestID, unitTenantID, request.AttemptID, request.AnswerRevisionID,
		"submission:"+request.AnswerRevisionID, request.JudgeJobID)
	require.NoError(t, err, "seed evaluation request")
}

func authorizeActorsInTenant(ctx context.Context, t *testing.T, pool *pgxpool.Pool, actorIDs ...string) {
	t.Helper()

	for _, actorID := range actorIDs {
		_, err := pool.Exec(ctx, `
			INSERT INTO authz.actor_tenant_authorizations
			    (actor_id, tenant_id, authz_revision, is_authorized, grant_kind, grant_source_id)
			VALUES ($1, $2, 1, true, 'tenant', $2)`, actorID, unitTenantID)
		require.NoError(t, err, "authorize actor %s", actorID)
		_, err = pool.Exec(ctx,
			`INSERT INTO authz.principal_authorization_revisions (actor_id, authz_revision) VALUES ($1, 1)`,
			actorID)
		require.NoError(t, err, "seed revision snapshot for %s", actorID)
	}
	// Migration 000008 gates has_tenant_authorization_at on this singleton,
	// which defaults to not-ready.
	_, err := pool.Exec(ctx, `
		UPDATE authz.authorization_projection_resync_state
		SET projection_ready = true, active_resync_id = gen_random_uuid(),
		    completion_event_id = gen_random_uuid(), expected_snapshot_count = 0,
		    expected_manifest_sha256 = decode(repeat('00', 32), 'hex')
		WHERE singleton = true`)
	require.NoError(t, err, "mark authorization projection ready")
}

// TestJudgeReceiptUnitVisibility proves the access-control boundary that makes
// per-unit persistence safe: the same attempt yields only redacted counts to
// its candidate, and the full breakdown only to a caller holding a capability
// signed for submission.judge_receipts. The boundary lives in the database
// routines, not in Go, so it is exercised there.
func TestJudgeReceiptUnitVisibility(t *testing.T) {
	t.Parallel()
	ctx := context.Background()

	pool := startSubmissionDatabase(ctx, t)

	seedGradingAttempt(ctx, t, pool, unitAttemptID, unitCandidateID)
	seedDispatchedEvaluationRequest(ctx, t, pool, dispatchedRequest{
		AttemptID: unitAttemptID, CandidateID: unitCandidateID, ExamItemID: unitExamItemID,
		AnswerRevisionID: unitAnswerRevisionID, EvaluationRequestID: unitEvaluationRequestID,
		JudgeJobID: unitJudgeJobID, RevisionNumber: 1,
	})
	authorizeActorsInTenant(ctx, t, pool, unitCandidateID, unitOtherCandidateID, unitReviewerID)

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

// Second attempt's fixtures, used only by the replay test below.
const (
	replayAttemptID = "018f4b0d-08f8-7c09-9ba7-efdf9c340020"
	replayCandidate = "018f4b0d-08f8-7c09-9ba7-efdf9c340021"
)

// TestJudgeCompletionReplayToleratesUpgradeWindow covers the one case where
// rejecting a redelivered completion would be worse than accepting it.
//
// The adapter acknowledges nothing it could not persist, and ProcessOnce
// returns on the first error, so any completion that can never be persisted
// becomes a permanent head-of-queue block: the worker re-pulls it every tick
// and every completion behind it stops. A completion ingested before migration
// 000018 carries the column default '[]', so its redelivery after the upgrade
// necessarily presents a "different" breakdown. That must not be treated as a
// replay violation. A stored breakdown that is genuinely non-empty still must.
func TestJudgeCompletionReplayToleratesUpgradeWindow(t *testing.T) {
	t.Parallel()
	ctx := context.Background()

	pool := startSubmissionDatabase(ctx, t)
	seedGradingAttempt(ctx, t, pool, replayAttemptID, replayCandidate)
	authorizeActorsInTenant(ctx, t, pool, replayCandidate)

	const populated = `[{"unit_number":0,"verdict":"accepted","execution_time_ms":8,"memory_kib":1024}]`

	tests := []struct {
		name            string
		suffix          string
		firstBreakdown  string
		secondBreakdown string
		wantErrorCode   string
	}{
		{
			name:            "pre-upgrade empty breakdown accepts a later populated redelivery",
			suffix:          "30",
			firstBreakdown:  `[]`,
			secondBreakdown: populated,
		},
		{
			name:            "identical redelivery is always accepted",
			suffix:          "40",
			firstBreakdown:  populated,
			secondBreakdown: populated,
		},
		{
			name:            "stored breakdown still rejects a genuinely different one",
			suffix:          "50",
			firstBreakdown:  populated,
			secondBreakdown: `[{"unit_number":0,"verdict":"wrong_answer","execution_time_ms":8,"memory_kib":1024}]`,
			wantErrorCode:   "23505",
		},
		{
			name:            "stored breakdown still rejects a redelivery that drops it",
			suffix:          "60",
			firstBreakdown:  populated,
			secondBreakdown: `[]`,
			wantErrorCode:   "23505",
		},
	}

	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()

			// Each case needs its own dispatched work and its own Judge event;
			// only the delivery and lease differ between the two deliveries.
			base := "018f4b0d-08f8-7c09-9ba7-efdf9c3400" + testCase.suffix
			request := dispatchedRequest{
				AttemptID: replayAttemptID, CandidateID: replayCandidate,
				ExamItemID: base, AnswerRevisionID: base[:len(base)-1] + "1",
				EvaluationRequestID: base[:len(base)-1] + "2", JudgeJobID: base[:len(base)-1] + "3",
				RevisionNumber: 1,
			}
			seedDispatchedEvaluationRequest(ctx, t, pool, request)

			judgeEventID := base[:len(base)-1] + "4"
			ingest := func(outboxID, deliveryID, leaseID, breakdown string) error {
				_, err := pool.Exec(ctx, `
					SELECT submission.ingest_judge_completion(
						$1, $2, $3, $4, 'submission-judge-completion', $5, $6, 'accepted', 21, 4096,
						NULL, NULL, NULL, '2026-08-24T09:00:00.000000Z'::timestamptz, $7::jsonb
					)`,
					outboxID, judgeEventID, deliveryID, leaseID,
					request.EvaluationRequestID, request.JudgeJobID, breakdown)
				return err
			}

			require.NoError(t,
				ingest(base[:len(base)-1]+"5", base[:len(base)-1]+"6", base[:len(base)-1]+"7", testCase.firstBreakdown),
				"first delivery")

			replayErr := ingest(base[:len(base)-1]+"8", base[:len(base)-1]+"9", base[:len(base)-1]+"a", testCase.secondBreakdown)

			if testCase.wantErrorCode != "" {
				require.Error(t, replayErr, "expected the replay to be refused")
				var postgresError *pgconn.PgError
				require.True(t, errors.As(replayErr, &postgresError), "expected *pgconn.PgError, got %T: %v", replayErr, replayErr)
				require.Equal(t, testCase.wantErrorCode, postgresError.Code, "message: %s", postgresError.Message)
				return
			}
			require.NoError(t, replayErr, "redelivery must not stall the bridge")

			// The redelivery is a no-op on the ledger: it records its new lease
			// and returns the original outbox event, it does not emit a second.
			var outboxEvents int
			require.NoError(t, pool.QueryRow(ctx,
				`SELECT count(*) FROM app.outbox_events WHERE payload ->> 'judge_event_id' = $1`,
				judgeEventID).Scan(&outboxEvents))
			require.Equal(t, 1, outboxEvents, "a redelivery must not emit a second platform event")

			var deliveries int
			require.NoError(t, pool.QueryRow(ctx,
				`SELECT count(*) FROM submission.judge_completion_ingress_deliveries WHERE judge_event_id = $1`,
				judgeEventID).Scan(&deliveries))
			require.Equal(t, 2, deliveries, "both delivery leases must be recorded")
		})
	}
}
