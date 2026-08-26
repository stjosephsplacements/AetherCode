//go:build integration

package main

import (
	"context"
	"testing"

	"github.com/aethercode/aethercode/libs/pkg/testutil/integration"
	"github.com/jackc/pgx/v5"
)

// TestRequireAudienceMatchesDatabaseRejectsMismatch proves publish's
// audience guard rejects a mistyped/wrong --audience before any row is
// inserted, mirroring scripts/provision-authz-context-key's own guard.
func TestRequireAudienceMatchesDatabaseRejectsMismatch(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	pool := integration.StartPostgres(ctx, t)
	dsn := integration.PoolDSN(pool)

	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatalf("pgx.Connect() error = %v", err)
	}
	t.Cleanup(func() { _ = conn.Close(ctx) })

	// StartPostgres always provisions a database literally named "testdb".
	if err := requireAudienceMatchesDatabase(ctx, conn, "wrong_audience"); err == nil {
		t.Fatal("requireAudienceMatchesDatabase() with mismatched audience: expected error, got nil")
	}
	if err := requireAudienceMatchesDatabase(ctx, conn, "testdb"); err != nil {
		t.Fatalf("requireAudienceMatchesDatabase() with matching audience: unexpected error = %v", err)
	}
}
