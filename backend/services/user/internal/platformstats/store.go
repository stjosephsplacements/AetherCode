package platformstats

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Link struct {
	TenantID    string
	StudentID   string
	PrincipalID string
	Platform    string
	Handle      string
}

type WorkItem struct {
	TenantID  string
	StudentID string
	Platform  string
	Handle    string
}

type Store struct {
	userPool         *pgxpool.Pool
	notificationPool *pgxpool.Pool
}

func NewStore(userPool, notificationPool *pgxpool.Pool) (*Store, error) {
	if userPool == nil {
		return nil, fmt.Errorf("user database pool is required")
	}
	return &Store{userPool: userPool, notificationPool: notificationPool}, nil
}

func (store *Store) Ping(ctx context.Context) error {
	if err := store.userPool.Ping(ctx); err != nil {
		return err
	}
	if store.notificationPool != nil {
		return store.notificationPool.Ping(ctx)
	}
	return nil
}

func (store *Store) SyncLinks(ctx context.Context, tenantID string) error {
	if store.notificationPool == nil {
		return nil
	}
	rows, err := store.notificationPool.Query(ctx, `SELECT member_id::text, platform, handle FROM notification.worker_profile_links($1)`, tenantID)
	if err != nil {
		return fmt.Errorf("list profile links: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var principalID, platform, handle string
		if err := rows.Scan(&principalID, &platform, &handle); err != nil {
			return err
		}
		var studentID string
		err = store.userPool.QueryRow(ctx, `
			SELECT id::text FROM users.students
			WHERE tenant_id = $1 AND principal_id = $2::uuid AND deleted_at IS NULL
		`, tenantID, principalID).Scan(&studentID)
		if err == pgx.ErrNoRows {
			continue
		}
		if err != nil {
			return err
		}
		if _, err := store.userPool.Exec(ctx, `SELECT users.platform_stats_upsert_link($1, $2, $3, $4)`,
			tenantID, studentID, platform, handle); err != nil {
			return err
		}
	}
	return rows.Err()
}

func (store *Store) ListTenants(ctx context.Context) ([]string, error) {
	rows, err := store.userPool.Query(ctx, `SELECT DISTINCT tenant_id::text FROM users.students WHERE deleted_at IS NULL`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	tenants := make([]string, 0, 16)
	for rows.Next() {
		var tenantID string
		if err := rows.Scan(&tenantID); err != nil {
			return nil, err
		}
		tenants = append(tenants, tenantID)
	}
	return tenants, rows.Err()
}

func (store *Store) Claim(ctx context.Context, limit int) ([]WorkItem, error) {
	rows, err := store.userPool.Query(ctx, `SELECT tenant_id::text, student_id::text, platform, handle FROM users.platform_stats_claim_refresh($1)`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]WorkItem, 0, limit)
	for rows.Next() {
		var item WorkItem
		if err := rows.Scan(&item.TenantID, &item.StudentID, &item.Platform, &item.Handle); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (store *Store) Save(ctx context.Context, item WorkItem, lines []string, status, failure string) error {
	_, err := store.userPool.Exec(ctx, `SELECT users.platform_stats_save($1, $2, $3::jsonb, $4, $5)`,
		item.StudentID, item.Platform, statsJSON(lines), status, failure)
	return err
}
