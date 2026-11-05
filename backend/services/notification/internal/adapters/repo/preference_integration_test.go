//go:build integration

package repo_test

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

// The first save of a preference inserts the row; its ON CONFLICT (tenant_id, ...) clause once clashed
// with the function's output columns (SQLSTATE 42702), so no user could ever save a preference.
func TestRecipientPreferenceFirstSaveAndUpdate(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	pool := newMigratedPool(ctx, t)
	projectionReady(ctx, t, pool)
	tenant, actor := uuid.New(), uuid.New()
	grant(ctx, t, pool, actor, tenant)

	save := func(channel string, enabled bool, expected int64) (version int64, err error) {
		tx, err := pool.Begin(ctx)
		require.NoError(t, err)
		defer tx.Rollback(ctx) //nolint:errcheck
		_, err = tx.Exec(ctx, `
			INSERT INTO authz.request_contexts
			    (context_id, capability_id, backend_pid, transaction_id, actor_id, tenant_id, authz_revision, action, resource, issued_at, expires_at)
			VALUES ($1, $2, pg_backend_pid(), txid_current(), $3, $4, 1, 'notification.write', 'notification.recipient_preferences', clock_timestamp(), clock_timestamp() + interval '4 seconds')`,
			uuid.New(), uuid.New(), actor, tenant)
		require.NoError(t, err)
		_, err = tx.Exec(ctx, `SELECT set_config('app.authz_context_id', (SELECT context_id::text FROM authz.request_contexts WHERE actor_id = $1 ORDER BY issued_at DESC LIMIT 1), true)`, actor)
		require.NoError(t, err)
		_, err = tx.Exec(ctx, `SET LOCAL ROLE aether_notification_app`)
		require.NoError(t, err)
		if err := tx.QueryRow(ctx, `SELECT version FROM notification.upsert_own_recipient_preference($1, $2, $3, $4, $5)`,
			uuid.New(), tenant, channel, enabled, expected).Scan(&version); err != nil {
			return 0, err
		}
		return version, tx.Commit(ctx)
	}

	for _, channel := range []string{"in_app", "email", "sms"} {
		first, err := save(channel, false, 0)
		require.NoError(t, err, channel)
		require.EqualValues(t, 1, first, channel)
		second, err := save(channel, true, first)
		require.NoError(t, err, channel)
		require.EqualValues(t, 2, second, channel)
	}
	// A stale version is refused with the conflict error, not an internal one.
	_, err := save("in_app", true, 1)
	pgCode(t, err, "P0001")
}
