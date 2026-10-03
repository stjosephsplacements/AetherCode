package expiry

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

const expiryRole = "aether_submission_expiry_worker"

// Store uses only the dedicated expiry pool. The role is intentionally
// verified at runtime so an application or migrator credential cannot be
// substituted accidentally.
type Store struct {
	pool *pgxpool.Pool
}

func NewStore(pool *pgxpool.Pool) (*Store, error) {
	if pool == nil {
		return nil, fmt.Errorf("submission expiry database pool is required")
	}
	return &Store{pool: pool}, nil
}

func (store *Store) Ping(contextValue context.Context) error {
	if store == nil || store.pool == nil {
		return fmt.Errorf("submission expiry store is not initialized")
	}
	var user string
	var privileged, canExecute, directTableAccess bool
	err := store.pool.QueryRow(contextValue, `
		SELECT
			current_user,
			COALESCE((SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user), true),
			has_function_privilege(
				current_user,
				'submission.expire_overdue_attempts(integer)',
				'EXECUTE'
			),
			EXISTS (
				SELECT 1
				FROM pg_class AS relation
				JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
				WHERE namespace.nspname = 'submission'
				  AND relation.relkind IN ('r', 'p')
				  AND (
					  has_table_privilege(current_user, relation.oid, 'SELECT')
					  OR has_table_privilege(current_user, relation.oid, 'INSERT')
					  OR has_table_privilege(current_user, relation.oid, 'UPDATE')
					  OR has_table_privilege(current_user, relation.oid, 'DELETE')
				  )
			)
	`).Scan(&user, &privileged, &canExecute, &directTableAccess)
	if err != nil {
		return fmt.Errorf("verify submission expiry database role: %w", err)
	}
	if user != expiryRole || privileged || !canExecute || directTableAccess {
		return fmt.Errorf("submission expiry database role is not least-privilege")
	}
	return nil
}

func (store *Store) ExpireOverdue(contextValue context.Context, limit int) (int, error) {
	if store == nil || store.pool == nil {
		return 0, fmt.Errorf("submission expiry store is not initialized")
	}
	if limit < 1 || limit > 5000 {
		return 0, fmt.Errorf("submission expiry batch limit must be between 1 and 5000")
	}
	var expired int
	if err := store.pool.QueryRow(contextValue, `
		SELECT submission.expire_overdue_attempts($1)
	`, limit).Scan(&expired); err != nil {
		return 0, fmt.Errorf("expire overdue submission attempts: %w", err)
	}
	return expired, nil
}
