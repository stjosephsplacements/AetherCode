//go:build integration

package repo_test

import (
	"context"
	"regexp"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

// TestExtensionFunctionCallsResolve guards against the defect behind migration
// 000019: PL/pgSQL resolves calls only at run time, so a body may reference an
// extensions.* function that was never created and still migrate cleanly. Every
// such reference in a routine body must name an existing function.
func TestExtensionFunctionCallsResolve(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	pool := migratedPool(ctx, t)

	defined := map[string]bool{}
	rows, err := pool.Query(ctx, `
		SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'extensions'`)
	require.NoError(t, err)
	for rows.Next() {
		var name string
		require.NoError(t, rows.Scan(&name))
		defined[name] = true
	}
	rows.Close()
	require.NoError(t, rows.Err())

	// Collect findings and close the result set before asserting: failing while
	// rows are open would leave a connection checked out and hang pool cleanup.
	call := regexp.MustCompile(`extensions\.([a-z_0-9]+)\s*\(`)
	bodies, err := pool.Query(ctx, `
		SELECT n.nspname || '.' || p.proname, p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
		WHERE n.nspname IN ('assessment', 'app', 'authz')`)
	require.NoError(t, err)
	checked := 0
	var undefined []string
	for bodies.Next() {
		var routine, source string
		require.NoError(t, bodies.Scan(&routine, &source))
		for _, match := range call.FindAllStringSubmatch(source, -1) {
			checked++
			if !defined[match[1]] {
				undefined = append(undefined, routine+" → extensions."+match[1]+"()")
			}
		}
	}
	bodies.Close()
	require.NoError(t, bodies.Err())
	require.Empty(t, undefined, "routines call undefined extension functions")
	require.Positive(t, checked, "expected routines that call extensions.* functions")
}

// TestUUIDGenerateV7ReturnsVersion7 checks the 000019 shim yields distinct
// RFC 9562 version-7 identifiers when called by the owner, as the
// security-definer materialization routines do.
func TestUUIDGenerateV7ReturnsVersion7(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	pool := migratedPool(ctx, t)

	transaction, err := pool.Begin(ctx)
	require.NoError(t, err)
	defer func() { _ = transaction.Rollback(ctx) }()
	_, err = transaction.Exec(ctx, `SET LOCAL ROLE aether_assessment_owner`)
	require.NoError(t, err)

	var first, second uuid.UUID
	require.NoError(t, transaction.QueryRow(ctx, `SELECT extensions.uuid_generate_v7(), extensions.uuid_generate_v7()`).Scan(&first, &second))
	require.Equal(t, uuid.Version(7), first.Version())
	require.Equal(t, uuid.Version(7), second.Version())
	require.NotEqual(t, first, second)
}

// TestProjectionWorkerCanClaimMaterializationEvents guards migrations 000021
// and 000022: the materialization consumers run as the projection worker,
// claim each event in app.projection_inbox_messages, and call the
// materialization functions in schema assessment.
func TestProjectionWorkerCanClaimMaterializationEvents(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	pool := migratedPool(ctx, t)
	for _, function := range []string{
		"assessment.apply_student_enrollment(uuid, uuid, uuid, uuid)",
		"assessment.materialize_from_enrollment(uuid, uuid, uuid, uuid)",
		"assessment.materialize_from_batch_affiliation(uuid, uuid, uuid, uuid, text)",
		"assessment.apply_batch_projection(uuid, uuid, uuid, uuid)",
		"assessment.backfill_from_assignment_rule(uuid, uuid, uuid, text, uuid)",
	} {
		var usable bool
		require.NoError(t, pool.QueryRow(ctx, `
			SELECT has_schema_privilege('aether_assessment_projection_worker', 'assessment', 'USAGE')
			   AND has_function_privilege('aether_assessment_projection_worker', $1, 'EXECUTE')`, function).Scan(&usable))
		require.True(t, usable, "the projection worker must be able to call %s", function)
	}
	transaction, err := pool.Begin(ctx)
	require.NoError(t, err)
	defer transaction.Rollback(ctx) //nolint:errcheck
	_, err = transaction.Exec(ctx, `SET LOCAL ROLE aether_assessment_projection_worker`)
	require.NoError(t, err)
	eventID := uuid.New()
	_, err = transaction.Exec(ctx, `
		INSERT INTO app.projection_inbox_messages (consumer_name, event_id, payload_sha256, occurred_at)
		VALUES ('assessment_batch_affiliation_v1', $1, sha256('payload'), now())`, eventID)
	require.NoError(t, err, "the projection worker claims materialization events")
	_, err = transaction.Exec(ctx, `
		UPDATE app.projection_inbox_messages SET processed_at = clock_timestamp(), last_error = NULL
		WHERE consumer_name = 'assessment_batch_affiliation_v1' AND event_id = $1`, eventID)
	require.NoError(t, err, "the projection worker completes materialization events")
}
