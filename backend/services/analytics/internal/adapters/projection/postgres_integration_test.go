//go:build integration

package projection_test

import (
	"context"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/aethercode/aethercode/libs/pkg/testutil/integration"
)

// TestProjectionWorkerAppendsEventFactsIdempotently guards migration 000014:
// the worker's append uses ON CONFLICT DO NOTHING, which RLS allows only with
// a SELECT policy, so a fresh event and its redelivery must both succeed.
func TestProjectionWorkerAppendsEventFactsIdempotently(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
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
	migrationsDir, err := filepath.Abs(filepath.Join(filepath.Dir(file), "../../../migrations"))
	require.NoError(t, err)
	integration.ApplyMigrations(ctx, t, pool, migrationsDir)

	transaction, err := pool.Begin(ctx)
	require.NoError(t, err)
	defer transaction.Rollback(ctx) //nolint:errcheck
	_, err = transaction.Exec(ctx, `SET LOCAL ROLE aether_analytics_projection_worker`)
	require.NoError(t, err)
	sourceEventID := uuid.New()
	for attempt := range 2 {
		_, err = transaction.Exec(ctx, `
			INSERT INTO analytics.event_facts (
				id, occurred_at, tenant_id, source_event_id, source_service,
				event_type, subject_id, source_subject_type, payload, legal_hold
			) VALUES ($1, '2026-10-04T12:00:00Z', $2, $3, 'user', 'user.student.enrolled.v1', $4, 'student', '{}'::jsonb, false)
			ON CONFLICT (source_event_id, occurred_at) DO NOTHING`,
			uuid.New(), uuid.New(), sourceEventID, uuid.New())
		require.NoError(t, err, "append attempt %d", attempt+1)
	}
}
