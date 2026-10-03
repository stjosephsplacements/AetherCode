// Package database provides PostgreSQL pool, transaction-context, migration,
// and UUID primitives shared by service adapters.
package database

import (
	"context"
	"fmt"

	"github.com/aethercode/aethercode/libs/pkg/config"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Open creates and verifies a bounded PostgreSQL connection pool.
func Open(contextValue context.Context, settings config.Database) (*pgxpool.Pool, error) {
	poolConfig, err := pgxpool.ParseConfig(settings.URL)
	if err != nil {
		return nil, fmt.Errorf("parse PostgreSQL configuration: %w", err)
	}
	poolConfig.MaxConns = settings.MaxConns
	poolConfig.MinConns = settings.MinConns

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
