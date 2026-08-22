//go:build integration

// Package integration provides helpers for starting real infrastructure
// containers (PostgreSQL, NATS, …) in tests tagged //go:build integration.
// Tests in this package are excluded from make test and only run under
// make test-integration, which requires Docker.
package integration

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/testcontainers/testcontainers-go"
	tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"
)

// StartPostgres starts a real PostgreSQL 18.4 container and returns a
// pgxpool.Pool connected as the postgres superuser. The container is
// stopped when tb.Cleanup fires.
func StartPostgres(ctx context.Context, tb testing.TB) *pgxpool.Pool {
	tb.Helper()

	container, err := tcpostgres.Run(ctx,
		"postgres:18.4",
		tcpostgres.WithDatabase("testdb"),
		tcpostgres.WithUsername("postgres"),
		tcpostgres.WithPassword("postgres"),
		testcontainers.WithWaitStrategy(
			wait.ForLog("database system is ready to accept connections").
				WithOccurrence(2),
		),
	)
	if err != nil {
		tb.Fatalf("StartPostgres: start container: %v", err)
	}
	tb.Cleanup(func() { _ = container.Terminate(ctx) })

	connStr, err := container.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		tb.Fatalf("StartPostgres: connection string: %v", err)
	}

	pool, err := pgxpool.New(ctx, connStr)
	if err != nil {
		tb.Fatalf("StartPostgres: open pool: %v", err)
	}
	tb.Cleanup(pool.Close)

	return pool
}

// PoolDSN returns the connection string that the pool was opened with,
// suitable for passing to golang-migrate or other tools that take a DSN.
func PoolDSN(pool *pgxpool.Pool) string {
	return pool.Config().ConnString()
}
