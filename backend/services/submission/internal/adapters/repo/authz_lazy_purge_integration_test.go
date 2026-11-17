//go:build integration

package repo_test

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/stretchr/testify/require"
)

// TestAuthzExpiryHoldsWithoutPurge proves that skipping the per-request purge
// (migration 000048) weakens nothing: expiry and single use are enforced on
// read and on consume, so rows that nobody has deleted yet change no decision.
func TestAuthzExpiryHoldsWithoutPurge(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	pool := startSubmissionDatabase(ctx, t)

	actor := newID(t)
	authorizeActorsInTenant(ctx, t, pool, actor)
	keyID := uuid.New()
	_, err := pool.Exec(ctx, `
		INSERT INTO authz.context_keys (key_id, audience, key_material, not_before, not_after)
		VALUES ($1, current_database(), decode(repeat('ab', 32), 'hex'), now() - interval '1 hour', now() + interval '1 hour')`, keyID)
	require.NoError(t, err)

	// setContext signs the way the User service does and calls the real routine.
	setContext := func(capability uuid.UUID, issuedOffset, ttl string) error {
		_, err := pool.Exec(ctx, `
			WITH t AS (SELECT clock_timestamp() + $5::interval AS issued, clock_timestamp() + $5::interval + $6::interval AS expires)
			SELECT authz.set_context($1, $2, 1, 'allow', $3, 'submission.read', 'submission.attempts', NULL::uuid[], t.issued, t.expires, $4,
				extensions.hmac(convert_to(format('aether-authz-context-v3|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s',
					current_database(), $4::uuid, $3::uuid, $1::uuid, $2::uuid, 1, 'allow', 'submission.read', 'submission.attempts', '',
					to_char(t.issued AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
					to_char(t.expires AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')), 'UTF8'),
					decode(repeat('ab', 32), 'hex'), 'sha256'))
			FROM t`, actor, unitTenantID, capability, keyID, issuedOffset, ttl)
		return err
	}

	// A signed capability works once; the replay is refused although nothing purged it.
	capability := uuid.New()
	require.NoError(t, setContext(capability, "0 seconds", "4 seconds"))
	err = setContext(capability, "0 seconds", "4 seconds")
	refused(t, err)

	// Presented again after its lifetime has passed, the same capability is refused by its timestamps
	// whether or not its replay row was purged.
	err = setContext(capability, "-10 seconds", "4 seconds")
	refused(t, err)

	// An expired context row that is still in the table grants nothing.
	var allowed bool
	transaction, err := pool.Begin(ctx)
	require.NoError(t, err)
	defer transaction.Rollback(ctx) //nolint:errcheck
	var contextID string
	require.NoError(t, transaction.QueryRow(ctx, `
		INSERT INTO authz.request_contexts
		    (context_id, capability_id, backend_pid, transaction_id, actor_id, tenant_id, authz_revision, action, resource, issued_at, expires_at)
		VALUES (gen_random_uuid(), gen_random_uuid(), pg_backend_pid(), txid_current(), $1, $2, 1,
		        'submission.read', 'submission.attempts', clock_timestamp() - interval '10 seconds', clock_timestamp() - interval '5 seconds')
		RETURNING context_id::text`, actor, unitTenantID).Scan(&contextID))
	_, err = transaction.Exec(ctx, `SELECT set_config('app.authz_context_id', $1, true)`, contextID)
	require.NoError(t, err)
	require.NoError(t, transaction.QueryRow(ctx,
		`SELECT authz.current_context_allows($1, 'submission.read', 'submission.attempts')`, unitTenantID).Scan(&allowed))
	require.False(t, allowed)
}

func refused(t *testing.T, err error) {
	t.Helper()
	var pgErr *pgconn.PgError
	require.ErrorAs(t, err, &pgErr)
	require.Equal(t, "28000", pgErr.Code)
}
