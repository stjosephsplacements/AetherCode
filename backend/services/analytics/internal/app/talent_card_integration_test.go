//go:build integration

package app_test

import (
	"context"
	"encoding/json"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"

	"github.com/stjosephsplacements/AetherCode/libs/pkg/testutil/integration"
)

func startAnalytics(ctx context.Context, t *testing.T) *pgxpool.Pool {
	t.Helper()
	pool := integration.StartPostgres(ctx, t)
	for _, statement := range []string{
		`CREATE ROLE aether_analytics_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
		`CREATE ROLE aether_analytics_migrator NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
		`CREATE ROLE aether_analytics_app NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
		`CREATE ROLE aether_analytics_authz_reader NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
		`CREATE ROLE aether_analytics_projection_worker NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
		`GRANT aether_analytics_owner TO aether_analytics_migrator`,
		`ALTER DATABASE testdb OWNER TO aether_analytics_owner`,
		`ALTER SCHEMA public OWNER TO aether_analytics_owner`,
		`CREATE TABLE public.schema_migrations (version bigint NOT NULL PRIMARY KEY, dirty boolean NOT NULL)`,
		`ALTER TABLE public.schema_migrations OWNER TO aether_analytics_owner`,
	} {
		_, err := pool.Exec(ctx, statement)
		require.NoError(t, err, statement)
	}
	_, file, _, _ := runtime.Caller(0)
	dir, err := filepath.Abs(filepath.Join(filepath.Dir(file), "../../migrations"))
	require.NoError(t, err)
	integration.ApplyMigrations(ctx, t, pool, dir)
	return pool
}

// TestTalentCardMetricsConsentAndValidity runs the talent card functions against
// seeded gold projections: figures from results, consent gating, revocation.
func TestTalentCardMetricsConsentAndValidity(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	pool := startAnalytics(ctx, t)

	tenant, actor := uuid.New(), uuid.New()
	student, rival, third := uuid.New(), uuid.New(), uuid.New()
	exec := func(sql string, args ...any) {
		t.Helper()
		_, err := pool.Exec(ctx, sql, args...)
		require.NoError(t, err, sql)
	}
	exec(`UPDATE authz.authorization_projection_resync_state SET active_resync_id = gen_random_uuid(), completion_event_id = gen_random_uuid(), expected_snapshot_count = 1, expected_manifest_sha256 = sha256('manifest'), completed_at = clock_timestamp(), projection_ready = true`)
	for _, principal := range []uuid.UUID{actor, student} {
		exec(`INSERT INTO authz.actor_tenant_authorizations (actor_id, tenant_id, authz_revision, is_authorized, grant_kind, grant_source_id) VALUES ($1, $2, 1, true, 'tenant', $3)`, principal, tenant, uuid.New())
		exec(`INSERT INTO authz.principal_authorization_revisions (actor_id, authz_revision, snapshot_applied) VALUES ($1, 1, true)`, principal)
	}

	// One exam: the student scores 80%, the rival 90%, a third 50% (rank 2 of 3 -> top 67%).
	exam, version := uuid.New(), uuid.New()
	assignment := uuid.New()
	result := func(candidate uuid.UUID, score float64) uuid.UUID {
		attempt := uuid.New()
		exec(`INSERT INTO analytics.exam_result_rollups (tenant_id, exam_id, exam_version_id, candidate_id, attempt_id, lifecycle_state, score, maximum_score, graded_at, source_revision)
			VALUES ($1, $2, $3, $4, $5, 'graded', $6, 100, clock_timestamp(), 1)`, tenant, exam, version, candidate, attempt, score)
		return attempt
	}
	mine := result(student, 80)
	result(rival, 90)
	result(third, 50)

	exec(`INSERT INTO analytics.attempt_projections (tenant_id, attempt_id, candidate_assignment_id, candidate_id, exam_id, exam_version_id, attempt_number, lifecycle_state, score, maximum_score, completed_at, source_event_id, source_occurred_at)
		VALUES ($1, $2, $3, $4, $5, $6, 1, 'graded', 80, 100, now() + interval '30 minutes', gen_random_uuid(), now())`, tenant, mine, assignment, student, exam, version)
	exec(`INSERT INTO analytics.attempt_started_projections (tenant_id, attempt_id, candidate_assignment_id, candidate_id, exam_id, exam_version_id, started_at, source_event_id, source_occurred_at)
		VALUES ($1, $2, $3, $4, $5, $6, now(), gen_random_uuid(), now())`, tenant, mine, assignment, student, exam, version)
	exec(`INSERT INTO analytics.candidate_assignment_projections (tenant_id, candidate_assignment_id, candidate_id, exam_id, exam_version_id, available_from, available_until, lifecycle_state, source_revision, source_event_id, source_occurred_at)
		VALUES ($1, $2, $3, $4, $5, now() - interval '1 hour', now() + interval '120 minutes', 'active', 1, gen_random_uuid(), now())`, tenant, assignment, student, exam, version)
	for index, verdict := range []string{"accepted", "accepted", "wrong_answer", "cancelled"} {
		exec(`INSERT INTO analytics.evaluation_projections (tenant_id, evaluation_request_id, attempt_id, answer_revision_id, exam_item_id, maximum_score, requested_event_id, requested_at, verdict, completion_event_id, completed_at)
			VALUES ($1, gen_random_uuid(), $2, gen_random_uuid(), gen_random_uuid(), 10, gen_random_uuid(), now(), $3, gen_random_uuid(), now())`, tenant, mine, verdict)
		_ = index
	}

	// As the student or staff, with a signed context for one action on one resource.
	as := func(principal uuid.UUID, action, resource string, work func(pgx.Tx) error) error {
		tx, err := pool.Begin(ctx)
		require.NoError(t, err)
		defer tx.Rollback(ctx) //nolint:errcheck
		var contextID string
		require.NoError(t, tx.QueryRow(ctx, `
			INSERT INTO authz.request_contexts
			    (context_id, capability_id, backend_pid, transaction_id, actor_id, tenant_id, authz_revision, action, resource, issued_at, expires_at)
			VALUES (gen_random_uuid(), gen_random_uuid(), pg_backend_pid(), txid_current(), $1, $2, 1, $3, $4, clock_timestamp(), clock_timestamp() + interval '4 seconds')
			RETURNING context_id::text`, principal, tenant, action, resource).Scan(&contextID))
		_, err = tx.Exec(ctx, `SELECT set_config('app.authz_context_id', $1, true)`, contextID)
		require.NoError(t, err)
		_, err = tx.Exec(ctx, `SET LOCAL ROLE aether_analytics_app`)
		require.NoError(t, err)
		if err := work(tx); err != nil {
			return err
		}
		return tx.Commit(ctx)
	}
	metrics := func() (map[string]any, error) {
		var raw []byte
		err := as(actor, "analytics.write", "analytics.talent_cards", func(tx pgx.Tx) error {
			return tx.QueryRow(ctx, `SELECT analytics.talent_card_metrics($1, $2)`, tenant, student).Scan(&raw)
		})
		if err != nil {
			return nil, err
		}
		var out map[string]any
		return out, json.Unmarshal(raw, &out)
	}
	setConsent := func(principal uuid.UUID, granted, contact, blind bool) error {
		return as(principal, "analytics.write", "analytics.talent_card_consents", func(tx pgx.Tx) error {
			_, err := tx.Exec(ctx, `SELECT analytics.set_talent_card_consent($1, $2, $3, $4, $5)`, tenant, student, granted, contact, blind)
			return err
		})
	}

	_, err := metrics()
	require.Error(t, err, "no card without the student's agreement")

	require.Error(t, setConsent(actor, true, false, false), "only the student can set their own consent")
	require.NoError(t, setConsent(student, true, true, false))

	figures, err := metrics()
	require.NoError(t, err)
	require.EqualValues(t, 1, figures["exam_count"])
	require.EqualValues(t, 67, figures["top_percent"], "rank 2 of 3 is the top 67 percent")
	require.InDelta(t, 0.6667, figures["accuracy"], 0.0001, "two accepted of three finished evaluations; cancelled is ignored")
	require.EqualValues(t, 3, figures["evaluations"])
	require.EqualValues(t, 75, figures["speed_index"], "30 minutes used of a 120 minute window")
	require.Equal(t, true, figures["share_contact_info"])

	cardID := uuid.New()
	require.NoError(t, as(actor, "analytics.write", "analytics.talent_cards", func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `SELECT analytics.store_talent_card($1, $2, $3, now() + interval '90 days')`, cardID, tenant, student)
		return err
	}))
	valid := func() bool {
		var ok bool
		require.NoError(t, pool.QueryRow(ctx, `SELECT analytics.talent_card_is_valid($1)`, cardID).Scan(&ok))
		return ok
	}
	require.True(t, valid())

	require.NoError(t, setConsent(student, false, false, false))
	require.False(t, valid(), "withdrawing consent revokes the student's cards")
	_, err = metrics()
	require.Error(t, err, "no new card after consent is withdrawn")

	require.NoError(t, setConsent(student, true, false, false))
	require.False(t, valid(), "a revoked card stays revoked when consent returns")
}
