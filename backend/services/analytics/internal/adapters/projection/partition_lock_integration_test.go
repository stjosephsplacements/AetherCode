//go:build integration

package projection_test

import (
	"context"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/stjosephsplacements/AetherCode/libs/pkg/testutil/integration"
)

// Every projected event calls app.ensure_analytics_event_fact_partitions inside the transaction that
// appends its fact. Its CREATE INDEX IF NOT EXISTS took a SHARE lock on the partition even when the
// index existed, so two workers blocked each other and deadlocked, and the projection never caught
// up. With the partition in place the function must take no lock that an insert holds.
func TestEnsurePartitionsDoesNotBlockOnConcurrentInserts(t *testing.T) {
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

	// Worker one has appended a fact and not committed: it holds a row-exclusive lock on the partition.
	first, err := pool.Begin(ctx)
	require.NoError(t, err)
	defer first.Rollback(ctx) //nolint:errcheck
	_, err = first.Exec(ctx, `SET LOCAL ROLE aether_analytics_projection_worker`)
	require.NoError(t, err)
	_, err = first.Exec(ctx, `
		INSERT INTO analytics.event_facts (id, occurred_at, tenant_id, source_event_id, source_service, event_type, subject_id, source_subject_type, payload, legal_hold)
		VALUES ($1, now(), $2, $3, 'user', 'user.student.enrolled.v1', $4, 'student', '{}'::jsonb, false)`,
		uuid.New(), uuid.New(), uuid.New(), uuid.New())
	require.NoError(t, err)

	// Worker two ensures the partitions for its own event: it must neither wait for worker one nor fail.
	second, err := pool.Begin(ctx)
	require.NoError(t, err)
	defer second.Rollback(ctx) //nolint:errcheck
	_, err = second.Exec(ctx, `SET LOCAL ROLE aether_analytics_projection_worker`)
	require.NoError(t, err)
	_, err = second.Exec(ctx, `SET LOCAL lock_timeout = '2s'`)
	require.NoError(t, err)
	_, err = second.Exec(ctx, `SELECT app.ensure_analytics_event_fact_partitions(now())`)
	require.NoError(t, err, "the partition exists, so the function must not take a lock the insert holds")
}
