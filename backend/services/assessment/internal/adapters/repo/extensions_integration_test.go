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
