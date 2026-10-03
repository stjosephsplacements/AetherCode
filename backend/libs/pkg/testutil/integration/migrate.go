//go:build integration

package integration

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ApplyMigrations runs every pending migration from migrationsDir against the
// database that pool is connected to. It uses golang-migrate directly,
// bypassing the production migration-ledger validation — suitable only for
// ephemeral test containers where the ledger role topology does not exist.
//
// Callers are responsible for any pre-migration setup required by the
// service's migrations (e.g. creating database roles, changing schema
// ownership). See services/user tests for an example.
func ApplyMigrations(ctx context.Context, tb testing.TB, pool *pgxpool.Pool, migrationsDir string) {
	tb.Helper()

	dsn := pool.Config().ConnString()
	sourceURL := fmt.Sprintf("file://%s", migrationsDir)

	m, err := migrate.New(sourceURL, dsn)
	if err != nil {
		tb.Fatalf("ApplyMigrations: open migrate: %v", err)
	}
	defer func() { _, _ = m.Close() }()

	if err := m.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		tb.Fatalf("ApplyMigrations: up: %v", err)
	}
}
