//go:build integration

package repo_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/aethercode/aethercode/libs/pkg/database"
	"github.com/aethercode/aethercode/libs/pkg/testutil/integration"
	"github.com/aethercode/aethercode/services/judge/internal/adapters/repo"
	"github.com/aethercode/aethercode/services/judge/internal/app"
)

// TestRLSIsolateTenants proves the access boundary judge actually implements
// at the database layer.
//
// Investigation note: judge's schema is not tenant-partitioned the way
// user/assessment/tenant/submission are. judge.execution_jobs carries a
// tenant_fairness_key text column (used only for dispatch fairness, not RLS)
// rather than a tenant_id column, and judge has no authz.* context/grant
// machinery at all — only two roles exist (aether_judge_migrator,
// aether_judge_app; see services/judge/migrations/000001_judge_control_schema.up.sql).
// Grepping every services/judge/migrations/*.up.sql for `ENABLE ROW LEVEL
// SECURITY` shows RLS is enabled only on judge.execution_jobs and
// judge.language_mappings (000005_rls_block_deletes.up.sql), whose only
// policies are `allow_all_reads/inserts/updates USING (true)` plus a
// RESTRICTIVE delete-block `USING (false)` — the same soft-delete pattern
// used elsewhere in the codebase, not a per-tenant isolation policy.
//
// The real, verifiable DB-layer access boundary judge enforces is soft
// delete: aether_judge_app can never physically DELETE a row directly (RLS
// blocks it); only the SECURITY DEFINER app.hard_delete() function can
// perform a physical delete. This test proves that boundary on
// judge.execution_jobs (app.hard_delete requires an `id uuid` primary key
// column, which judge.language_mappings lacks — it is keyed by
// language_key text).
//
// Architecture of the test:
//  1. Start a real PostgreSQL 18.4 container (testcontainers).
//  2. Pre-create the two required database roles. Judge has no separate
//     owner role: aether_judge_migrator both migrates and owns the schema
//     (SET ROLE aether_judge_migrator; CREATE SCHEMA ... AUTHORIZATION
//     aether_judge_migrator), so it is granted database/schema ownership
//     directly instead of via an intermediate owner role.
//  3. Apply all judge service migrations via golang-migrate.
//  4. Insert one execution job row as superuser (superusers bypass RLS).
//  5. As aether_judge_app, attempt a direct DELETE: RLS blocks it (zero rows
//     deleted, row still present).
//  6. As aether_judge_app, call app.hard_delete(): the SECURITY DEFINER
//     function bypasses RLS and physically removes the row.
func TestRLSIsolateTenants(t *testing.T) {
	t.Parallel()
	ctx := context.Background()

	pool := integration.StartPostgres(ctx, t)

	// --- pre-migration role and schema setup -----------------------------------
	for _, stmt := range []string{
		`CREATE ROLE aether_judge_migrator NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
		`CREATE ROLE aether_judge_app      NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
		// Judge has no owner role; the migrator itself owns the database and
		// public schema so it can CREATE SCHEMA judge and REVOKE on public.
		`ALTER DATABASE testdb OWNER TO aether_judge_migrator`,
		`ALTER SCHEMA public OWNER TO aether_judge_migrator`,
		// Pre-create the migration version table owned by aether_judge_migrator.
		`CREATE TABLE public.schema_migrations (version bigint NOT NULL PRIMARY KEY, dirty boolean NOT NULL)`,
		`ALTER TABLE public.schema_migrations OWNER TO aether_judge_migrator`,
	} {
		_, err := pool.Exec(ctx, stmt)
		require.NoError(t, err, "pre-migration setup: %s", stmt[:min(len(stmt), 60)])
	}

	// --- apply migrations ------------------------------------------------------
	_, file, _, _ := runtime.Caller(0)
	svcRoot := filepath.Join(filepath.Dir(file), "../../..")
	migrationsDir, err := filepath.Abs(filepath.Join(svcRoot, "migrations"))
	require.NoError(t, err)
	integration.ApplyMigrations(ctx, t, pool, migrationsDir)

	// --- committed test data ---------------------------------------------------
	jobID := uuid.New()

	_, err = pool.Exec(ctx,
		`INSERT INTO judge.execution_jobs
		     (id, idempotency_key, request_fingerprint, tenant_fairness_key, submission_correlation_id,
		      evaluation_bundle_ref, evaluation_bundle_sha256, source_ciphertext_ref, source_ciphertext_sha256,
		      request_ciphertext_ref, language_key, cpu_time_limit_ms, wall_time_limit_ms, memory_limit_bytes,
		      process_limit, expires_at)
		 VALUES ($1, $2, $3, 'rls-test-tenant:rls-test-exam', $4,
		         'bundles/rls-test', $5, 'ciphertext/rls-test', $6,
		         'request/rls-test', 'python3', 1000, 2000, 268435456,
		         1, $7)`,
		jobID, "rls-test-"+jobID.String(), deterministicHex64("fingerprint"), uuid.New(),
		deterministicHex64("bundle"), deterministicHex64("source"), time.Now().Add(time.Hour),
	)
	require.NoError(t, err, "insert execution job")

	t.Run("app role cannot directly delete an execution job", func(t *testing.T) {
		tx, err := pool.Begin(ctx)
		require.NoError(t, err)
		defer tx.Rollback(ctx) //nolint:errcheck

		_, err = tx.Exec(ctx, `SET LOCAL ROLE aether_judge_app`)
		require.NoError(t, err, "set role aether_judge_app")

		tag, err := tx.Exec(ctx, `DELETE FROM judge.execution_jobs WHERE id = $1`, jobID)
		require.NoError(t, err, "delete statement itself must not error")
		require.Equal(t, int64(0), tag.RowsAffected(), "RLS must block the delete: zero rows should be affected")

		var count int
		err = tx.QueryRow(ctx, `SELECT count(*) FROM judge.execution_jobs WHERE id = $1`, jobID).Scan(&count)
		require.NoError(t, err, "select count")
		require.Equal(t, 1, count, "the row must still be present after the blocked delete")
	})

	t.Run("app role can hard-delete via the SECURITY DEFINER function", func(t *testing.T) {
		tx, err := pool.Begin(ctx)
		require.NoError(t, err)
		defer tx.Rollback(ctx) //nolint:errcheck

		_, err = tx.Exec(ctx, `SET LOCAL ROLE aether_judge_app`)
		require.NoError(t, err, "set role aether_judge_app")

		var deleted bool
		err = tx.QueryRow(ctx,
			`SELECT app.hard_delete('judge.execution_jobs', $1, $2, 'integration test cleanup')`,
			jobID, uuid.New(),
		).Scan(&deleted)
		require.NoError(t, err, "hard_delete must succeed for the app role")
		require.True(t, deleted)

		var count int
		err = tx.QueryRow(ctx, `SELECT count(*) FROM judge.execution_jobs WHERE id = $1`, jobID).Scan(&count)
		require.NoError(t, err, "select count")
		require.Equal(t, 0, count, "the row must be physically gone after hard_delete")
	})
}

// TestSubmitFansOutBundleIntoExecutionUnits proves the full fan-out path
// (Tasks 1-2 of this plan) end to end against a real PostgreSQL: submitting
// one evaluation bundle with three test cases must leave exactly three
// judge.execution_units rows, one per test case, all created inside the same
// transaction as the execution_jobs row itself.
//
// Object storage and KMS are faked in-memory (see fakeStorage/fakeKMS below,
// mirroring the pattern already established in postgres_fanout_test.go's
// unit tests for fanOutTestCases) since libs/pkg/testutil has no MinIO
// testcontainer helper to start a real object store here.
func TestSubmitFansOutBundleIntoExecutionUnits(t *testing.T) {
	t.Parallel()
	ctx := context.Background()

	pool := integration.StartPostgres(ctx, t)

	// --- pre-migration role and schema setup -----------------------------------
	for _, stmt := range []string{
		`CREATE ROLE aether_judge_migrator NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
		`CREATE ROLE aether_judge_app      NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
		`ALTER DATABASE testdb OWNER TO aether_judge_migrator`,
		`ALTER SCHEMA public OWNER TO aether_judge_migrator`,
		`CREATE TABLE public.schema_migrations (version bigint NOT NULL PRIMARY KEY, dirty boolean NOT NULL)`,
		`ALTER TABLE public.schema_migrations OWNER TO aether_judge_migrator`,
	} {
		_, err := pool.Exec(ctx, stmt)
		require.NoError(t, err, "pre-migration setup: %s", stmt[:min(len(stmt), 60)])
	}

	// --- apply migrations ------------------------------------------------------
	_, file, _, _ := runtime.Caller(0)
	svcRoot := filepath.Join(filepath.Dir(file), "../../..")
	migrationsDir, err := filepath.Abs(filepath.Join(svcRoot, "migrations"))
	require.NoError(t, err)
	integration.ApplyMigrations(ctx, t, pool, migrationsDir)

	// --- enable the language this submission targets ----------------------------
	_, err = pool.Exec(ctx, `
		INSERT INTO judge.language_mappings (language_key, engine_language_id, engine_version, enabled, max_parallelism)
		VALUES ('python3', 71, '3.11.2', true, 4)
	`)
	require.NoError(t, err, "seed enabled language mapping")

	// --- seed a real evaluation bundle in fake storage, encrypted with the fake KMS
	objectStorage := newFakeStorage()
	keyManager := fakeKMS{}

	bundlePlaintext := []byte(`{"schema_version": 1, "test_cases": [
		{"stdin": "1\n", "expected_output": "1\n"},
		{"stdin": "2\n", "expected_output": "4\n"},
		{"stdin": "3\n", "expected_output": "9\n"}
	]}`)
	bundleCiphertext, bundleKeyRef, err := keyManager.Encrypt(ctx, bundlePlaintext)
	require.NoError(t, err, "encrypt fixture bundle")
	const bundleObjectKey = "bundles/fanout-integration-test"
	objectStorage.objects[bundleObjectKey] = bundleCiphertext
	bundleSHA256 := sha256.Sum256(bundlePlaintext)

	store := repo.NewPostgres(pool, objectStorage, keyManager)

	correlationID, err := database.NewUUIDv7()
	require.NoError(t, err)
	idempotencyKey, err := database.NewUUIDv7()
	require.NoError(t, err)

	command := app.SubmitExecution{
		IdempotencyKey:          "fanout-integration-" + idempotencyKey,
		TenantFairnessKey:       "fanout-tenant:fanout-exam",
		SubmissionCorrelationID: correlationID,
		EvaluationBundleRef:     bundleObjectKey,
		EvaluationBundleSHA256:  hex.EncodeToString(bundleSHA256[:]),
		EvaluationBundleKeyRef:  bundleKeyRef,
		SourceCiphertextRef:     "source/fanout-integration-test",
		SourceCiphertextSHA256:  deterministicHex64("source"),
		RequestCiphertextRef:    "request/fanout-integration-test",
		LanguageKey:             "python3",
		Limits: app.Limits{
			CPUTimeMS:  1000,
			WallTimeMS: 2000,
			Memory:     268435456,
			Processes:  1,
		},
		ExpiresAt: time.Now().Add(time.Hour),
	}
	require.NoError(t, command.Validate(time.Now()), "fixture command must satisfy the wrapper's own invariants")

	execution, err := store.Submit(ctx, command)
	require.NoError(t, err, "Submit")
	require.NotEmpty(t, execution.ID)
	require.Equal(t, "accepted", execution.Status)

	rows, err := pool.Query(ctx, `
		SELECT unit_number, test_case_ciphertext_ref
		FROM judge.execution_units
		WHERE job_id = $1
		ORDER BY unit_number
	`, execution.ID)
	require.NoError(t, err, "query execution units")
	defer rows.Close()

	type unitRow struct {
		number int
		ref    string
	}
	var units []unitRow
	for rows.Next() {
		var row unitRow
		require.NoError(t, rows.Scan(&row.number, &row.ref))
		units = append(units, row)
	}
	require.NoError(t, rows.Err())

	require.Len(t, units, 3, "one execution unit per test case in the bundle")
	seenRefs := make(map[string]bool, len(units))
	for i, row := range units {
		require.Equal(t, i, row.number, "unit_number must be dense and zero-based")
		require.False(t, seenRefs[row.ref], "test_case_ciphertext_ref %q must be distinct per unit", row.ref)
		seenRefs[row.ref] = true
	}
}

// TestSubmitCleansUpOrphanedStorageOnLaterTransactionFailure proves the
// storage cleanup safety net added alongside fan-out: fan-out itself
// succeeds (N per-test-case objects get uploaded and their execution_units
// rows inserted), but a LATER statement in the same transaction
// (the execution_events insert) fails, so the whole transaction rolls back.
// A storage Put cannot be undone by that rollback, so Submit must clean up
// the already-uploaded objects itself rather than leaking them — which is
// exactly what happened 100% of the time before migration 000007 fixed the
// execution_events.event_type CHECK regex.
func TestSubmitCleansUpOrphanedStorageOnLaterTransactionFailure(t *testing.T) {
	t.Parallel()
	ctx := context.Background()

	pool := integration.StartPostgres(ctx, t)

	// --- pre-migration role and schema setup -----------------------------------
	for _, stmt := range []string{
		`CREATE ROLE aether_judge_migrator NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
		`CREATE ROLE aether_judge_app      NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
		`ALTER DATABASE testdb OWNER TO aether_judge_migrator`,
		`ALTER SCHEMA public OWNER TO aether_judge_migrator`,
		`CREATE TABLE public.schema_migrations (version bigint NOT NULL PRIMARY KEY, dirty boolean NOT NULL)`,
		`ALTER TABLE public.schema_migrations OWNER TO aether_judge_migrator`,
	} {
		_, err := pool.Exec(ctx, stmt)
		require.NoError(t, err, "pre-migration setup: %s", stmt[:min(len(stmt), 60)])
	}

	// --- apply migrations ------------------------------------------------------
	_, file, _, _ := runtime.Caller(0)
	svcRoot := filepath.Join(filepath.Dir(file), "../../..")
	migrationsDir, err := filepath.Abs(filepath.Join(svcRoot, "migrations"))
	require.NoError(t, err)
	integration.ApplyMigrations(ctx, t, pool, migrationsDir)

	// --- enable the language this submission targets ----------------------------
	_, err = pool.Exec(ctx, `
		INSERT INTO judge.language_mappings (language_key, engine_language_id, engine_version, enabled, max_parallelism)
		VALUES ('python3', 71, '3.11.2', true, 4)
	`)
	require.NoError(t, err, "seed enabled language mapping")

	// --- deliberately force the statement AFTER fan-out to fail ----------------
	// Submit's next statement after fanOutIntoExecutionUnits succeeds is the
	// judge.execution_events insert. An always-false CHECK constraint fails
	// every insert into that table without touching fan-out itself, giving a
	// deterministic "later step fails" seam.
	_, err = pool.Exec(ctx, `ALTER TABLE judge.execution_events ADD CONSTRAINT force_test_failure CHECK (false)`)
	require.NoError(t, err, "seed a deliberate later-statement failure")

	// --- seed a real evaluation bundle in fake storage, encrypted with the fake KMS
	objectStorage := newFakeStorage()
	keyManager := fakeKMS{}

	bundlePlaintext := []byte(`{"schema_version": 1, "test_cases": [
		{"stdin": "1\n", "expected_output": "1\n"},
		{"stdin": "2\n", "expected_output": "4\n"},
		{"stdin": "3\n", "expected_output": "9\n"}
	]}`)
	bundleCiphertext, bundleKeyRef, err := keyManager.Encrypt(ctx, bundlePlaintext)
	require.NoError(t, err, "encrypt fixture bundle")
	const bundleObjectKey = "bundles/fanout-cleanup-integration-test"
	objectStorage.objects[bundleObjectKey] = bundleCiphertext
	bundleSHA256 := sha256.Sum256(bundlePlaintext)

	store := repo.NewPostgres(pool, objectStorage, keyManager)

	correlationID, err := database.NewUUIDv7()
	require.NoError(t, err)
	idempotencyKey, err := database.NewUUIDv7()
	require.NoError(t, err)

	command := app.SubmitExecution{
		IdempotencyKey:          "fanout-cleanup-" + idempotencyKey,
		TenantFairnessKey:       "fanout-cleanup-tenant:fanout-exam",
		SubmissionCorrelationID: correlationID,
		EvaluationBundleRef:     bundleObjectKey,
		EvaluationBundleSHA256:  hex.EncodeToString(bundleSHA256[:]),
		EvaluationBundleKeyRef:  bundleKeyRef,
		SourceCiphertextRef:     "source/fanout-cleanup-integration-test",
		SourceCiphertextSHA256:  deterministicHex64("source"),
		RequestCiphertextRef:    "request/fanout-cleanup-integration-test",
		LanguageKey:             "python3",
		Limits: app.Limits{
			CPUTimeMS:  1000,
			WallTimeMS: 2000,
			Memory:     268435456,
			Processes:  1,
		},
		ExpiresAt: time.Now().Add(time.Hour),
	}
	require.NoError(t, command.Validate(time.Now()), "fixture command must satisfy the wrapper's own invariants")

	_, err = store.Submit(ctx, command)
	require.Error(t, err, "Submit must surface the forced later-statement failure")

	var jobCount int
	err = pool.QueryRow(ctx, `SELECT count(*) FROM judge.execution_jobs`).Scan(&jobCount)
	require.NoError(t, err)
	require.Equal(t, 0, jobCount, "the whole transaction must have rolled back: no job row should exist")

	// Fan-out uploaded 3 per-test-case objects before the later statement
	// failed. Those must be cleaned up, leaving only the original bundle
	// object behind — not leaked permanently in storage.
	require.Len(t, objectStorage.objects, 1,
		"fan-out's uploaded objects must be cleaned up when the owning transaction does not commit")
	_, bundleStillPresent := objectStorage.objects[bundleObjectKey]
	require.True(t, bundleStillPresent, "cleanup must not remove the bundle object itself, only the units it uploaded")
}

// fakeStorage is an in-memory stand-in for the storage.Object port, mirroring
// the fakeStorage used by postgres_fanout_test.go's unit tests -- reused here
// (in this package's separate repo_test package, which cannot see that
// file's unexported types directly) rather than reinvented.
type fakeStorage struct {
	objects map[string][]byte
}

func newFakeStorage() *fakeStorage { return &fakeStorage{objects: make(map[string][]byte)} }

func (s *fakeStorage) Get(_ context.Context, key string) (io.ReadCloser, int64, error) {
	data, ok := s.objects[key]
	if !ok {
		return nil, 0, errors.New("object not found")
	}
	return io.NopCloser(bytes.NewReader(data)), int64(len(data)), nil
}

func (s *fakeStorage) Put(_ context.Context, key string, r io.Reader, _ int64, _ string) error {
	data, err := io.ReadAll(r)
	if err != nil {
		return err
	}
	s.objects[key] = data
	return nil
}

func (s *fakeStorage) Delete(_ context.Context, key string) error {
	delete(s.objects, key)
	return nil
}
func (s *fakeStorage) Exists(context.Context, string) (bool, error) { return false, nil }
func (s *fakeStorage) PresignGet(context.Context, string, time.Duration) (string, error) {
	return "", nil
}

// fakeKMS "encrypts" by reversing bytes and "decrypts" by reversing back --
// deterministic, reversible, and obviously not real encryption; sufficient
// for testing that plaintext survives an encrypt-then-decrypt round trip
// through the fan-out logic without depending on a real KMS. Mirrors the
// fakeKMS used by postgres_fanout_test.go's unit tests.
type fakeKMS struct{}

func (fakeKMS) Encrypt(_ context.Context, plaintext []byte) ([]byte, string, error) {
	reversed := make([]byte, len(plaintext))
	for i, b := range plaintext {
		reversed[len(plaintext)-1-i] = b
	}
	return reversed, "fake-key-ref", nil
}

func (fakeKMS) Decrypt(_ context.Context, ciphertext []byte, _ string) ([]byte, error) {
	reversed := make([]byte, len(ciphertext))
	for i, b := range ciphertext {
		reversed[len(ciphertext)-1-i] = b
	}
	return reversed, nil
}

// deterministicHex64 returns a deterministic, well-formed 64-character hex string
// satisfying the judge schema's `~ '^[0-9a-f]{64}$'` CHECK constraints. The
// content does not matter for this test — only that the shape is valid.
func deterministicHex64(seed string) string {
	const hexDigits = "0123456789abcdef"
	out := make([]byte, 64)
	for i := range out {
		out[i] = hexDigits[(int(seed[i%len(seed)])+i)%len(hexDigits)]
	}
	return string(out)
}
