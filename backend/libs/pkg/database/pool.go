// Package database provides PostgreSQL pool, transaction-context, migration,
// and UUID primitives shared by service adapters.
package database

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stjosephsplacements/AetherCode/libs/pkg/config"
)

// Open creates and verifies a bounded PostgreSQL connection pool.
func Open(contextValue context.Context, settings config.Database) (*pgxpool.Pool, error) {
	poolConfig, err := pgxpool.ParseConfig(settings.URL)
	if err != nil {
		return nil, fmt.Errorf("parse PostgreSQL configuration: %w", err)
	}
	poolConfig.MaxConns = settings.MaxConns
	poolConfig.MinConns = settings.MinConns
	// Prevent stale connections after a DB restart or a network fault; replace
	// connections that have been idle for a long time to avoid PgBouncer and
	// load-balancer idle-timeout surprises.
	poolConfig.MaxConnLifetime = 30 * time.Minute
	poolConfig.MaxConnIdleTime = 10 * time.Minute

	pool, err := pgxpool.NewWithConfig(contextValue, poolConfig)
	if err != nil {
		return nil, fmt.Errorf("open PostgreSQL pool: %w", err)
	}
	if err := pool.Ping(contextValue); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping PostgreSQL: %w", err)
	}
	return pool, nil
}
