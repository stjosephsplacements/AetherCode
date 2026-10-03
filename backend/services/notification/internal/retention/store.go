package retention

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

const retentionRole = "aether_notification_retention_worker"

// Result reports bounded work performed by one call to the database-owned
// purge procedure. Counts are operational metrics, never notification content.
type Result struct {
	DeletedNotifications    int64
	DeletedDeliveryAttempts int64
}

func (result Result) Total() int64 {
	return result.DeletedNotifications + result.DeletedDeliveryAttempts
}

// Store uses only the dedicated retention pool. The role is intentionally
// verified at runtime so an application or migrator credential cannot be
// substituted accidentally.
type Store struct {
	pool *pgxpool.Pool
}

func NewStore(pool *pgxpool.Pool) (*Store, error) {
	if pool == nil {
		return nil, fmt.Errorf("notification retention database pool is required")
	}
	return &Store{pool: pool}, nil
}

func (store *Store) Ping(contextValue context.Context) error {
	if store == nil || store.pool == nil {
		return fmt.Errorf("notification retention store is not initialized")
	}
	var user string
	var privileged, canExecute, directTableAccess bool
	err := store.pool.QueryRow(contextValue, `
		SELECT
			current_user,
			COALESCE((SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user), true),
			has_function_privilege(
				current_user,
				'notification.purge_expired_retained_data(integer)',
				'EXECUTE'
			),
			EXISTS (
				SELECT 1
				FROM pg_class AS relation
				JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
				WHERE namespace.nspname = 'notification'
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
		return fmt.Errorf("verify notification retention database role: %w", err)
	}
	if user != retentionRole || privileged || !canExecute || directTableAccess {
		return fmt.Errorf("notification retention database role is not least-privilege")
	}
	return nil
}

func (store *Store) Purge(contextValue context.Context, limit int) (Result, error) {
	if store == nil || store.pool == nil {
		return Result{}, fmt.Errorf("notification retention store is not initialized")
	}
	if limit < 1 || limit > 10000 {
		return Result{}, fmt.Errorf("notification retention purge limit must be between 1 and 10000")
	}
	var result Result
	if err := store.pool.QueryRow(contextValue, `
		SELECT deleted_notifications, deleted_delivery_attempts
		FROM notification.purge_expired_retained_data($1)
	`, limit).Scan(&result.DeletedNotifications, &result.DeletedDeliveryAttempts); err != nil {
		return Result{}, fmt.Errorf("purge expired notification retention data: %w", err)
	}
	return result, nil
}
