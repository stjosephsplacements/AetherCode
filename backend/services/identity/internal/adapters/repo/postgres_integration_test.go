//go:build integration

package repo_test

import (
	"context"
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base32"
	"encoding/binary"
	"fmt"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"

	"github.com/stjosephsplacements/AetherCode/libs/pkg/testutil/integration"
	"github.com/stjosephsplacements/AetherCode/services/identity/internal/adapters/repo"
	"github.com/stjosephsplacements/AetherCode/services/identity/internal/app"
	"github.com/stjosephsplacements/AetherCode/services/identity/internal/domain"
)

// TestRLSIsolateTenants proves the access boundary identity actually
// implements at the database layer.
//
// Investigation note: identity has no tenant-scoped RLS at all. Grepping
// every services/identity/migrations/*.up.sql for `ENABLE ROW LEVEL
// SECURITY` and `CREATE POLICY` shows RLS is enabled only on
// identity.principals, identity.password_credentials, and
// identity.mfa_factors (migration 000010_rls_block_deletes.up.sql), whose
// only policies are `allow_all_reads/inserts/updates USING (true)` plus a
// RESTRICTIVE `block_delete_require_hard_delete_function USING (false)` —
// the migration's own comment says so explicitly: "principals,
// password_credentials, mfa_factors don't have tenant-aware RLS yet".
// identity.refresh_session_families carries a nullable tenant_id but has no
// RLS enabled on it at all; tenant scoping for identity's own tables is
// enforced at the application layer, not by Postgres RLS. The authz.*
// tenant/global context functions bootstrap defines in this service exist to
// validate signed contexts minted for OTHER services, not to gate identity's
// own tables.
//
// The real, verifiable DB-layer access boundary identity enforces is soft
// delete: aether_identity_app can never physically DELETE a row directly
// (RLS blocks it via USING (false)); only the SECURITY DEFINER
// app.hard_delete() function, gated by GRANT EXECUTE, can perform a physical
// delete. This test proves that boundary on identity.principals.
//
// Architecture of the test:
//  1. Start a real PostgreSQL 18.4 container (testcontainers).
//  2. Pre-create the required database roles and adjust schema ownership so
//     that golang-migrate can run as the postgres superuser.
//  3. Apply all identity service migrations via golang-migrate.
//  4. Insert one principal row as superuser (superusers bypass RLS).
//  5. As aether_identity_app, attempt a direct DELETE: RLS blocks it (zero
//     rows deleted, row still present).
//  6. As aether_identity_app, call app.hard_delete(): the SECURITY DEFINER
//     function bypasses RLS and physically removes the row.
func TestRLSIsolateTenants(t *testing.T) {
	t.Parallel()
	ctx := context.Background()

	pool := migratedPool(ctx, t)

	// --- committed test data ---------------------------------------------------
	principalID := uuid.New()

	_, err := pool.Exec(ctx,
		`INSERT INTO identity.principals (id, email, display_name) VALUES ($1, $2, 'RLS Delete-Block Test')`,
		principalID, "rls-delete-block-"+principalID.String()+"@example.com",
	)
	require.NoError(t, err, "insert principal")

	t.Run("app role cannot directly delete a principal", func(t *testing.T) {
		tx, err := pool.Begin(ctx)
		require.NoError(t, err)
		defer tx.Rollback(ctx) //nolint:errcheck

		_, err = tx.Exec(ctx, `SET LOCAL ROLE aether_identity_app`)
		require.NoError(t, err, "set role aether_identity_app")

		tag, err := tx.Exec(ctx, `DELETE FROM identity.principals WHERE id = $1`, principalID)
		require.NoError(t, err, "delete statement itself must not error")
		require.Equal(t, int64(0), tag.RowsAffected(), "RLS must block the delete: zero rows should be affected")

		var count int
		err = tx.QueryRow(ctx, `SELECT count(*) FROM identity.principals WHERE id = $1`, principalID).Scan(&count)
		require.NoError(t, err, "select count")
		require.Equal(t, 1, count, "the row must still be present after the blocked delete")
	})

	t.Run("app role can hard-delete via the SECURITY DEFINER function", func(t *testing.T) {
		tx, err := pool.Begin(ctx)
		require.NoError(t, err)
		defer tx.Rollback(ctx) //nolint:errcheck

		_, err = tx.Exec(ctx, `SET LOCAL ROLE aether_identity_app`)
		require.NoError(t, err, "set role aether_identity_app")

		var deleted bool
		err = tx.QueryRow(ctx,
			`SELECT app.hard_delete('identity.principals', $1, $2, 'integration test cleanup')`,
			principalID, uuid.New(),
		).Scan(&deleted)
		require.NoError(t, err, "hard_delete must succeed for the app role")
		require.True(t, deleted)

		var count int
		err = tx.QueryRow(ctx, `SELECT count(*) FROM identity.principals WHERE id = $1`, principalID).Scan(&count)
		require.NoError(t, err, "select count")
		require.Equal(t, 0, count, "the row must be physically gone after hard_delete")
	})
}

// migratedPool starts PostgreSQL 18.4 with identity's role topology and
// applies every identity migration. The pool connects as the superuser.
func migratedPool(ctx context.Context, t *testing.T) *pgxpool.Pool {
	t.Helper()
	pool := integration.StartPostgres(ctx, t)

	// --- pre-migration role and schema setup -----------------------------------
	for _, stmt := range []string{
		`CREATE ROLE aether_identity_owner       NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
		`CREATE ROLE aether_identity_migrator    NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
		`CREATE ROLE aether_identity_app         NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
		`CREATE ROLE aether_identity_authz_reader NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
		`CREATE ROLE aether_identity_projection_worker NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
		// Migrator must be a member of owner so SET ROLE aether_identity_owner works.
		`GRANT aether_identity_owner TO aether_identity_migrator`,
		// Transfer ownership so the migration can REVOKE on the public schema.
		`ALTER DATABASE testdb OWNER TO aether_identity_owner`,
		`ALTER SCHEMA public OWNER TO aether_identity_owner`,
		// Pre-create the migration version table owned by aether_identity_owner.
		`CREATE TABLE public.schema_migrations (version bigint NOT NULL PRIMARY KEY, dirty boolean NOT NULL)`,
		`ALTER TABLE public.schema_migrations OWNER TO aether_identity_owner`,
	} {
		_, err := pool.Exec(ctx, stmt)
		require.NoError(t, err, "pre-migration setup: %s", stmt[:min(len(stmt), 60)])
	}

	// --- apply migrations ------------------------------------------------------
	_, file, _, _ := runtime.Caller(0)
	svcRoot := filepath.Join(filepath.Dir(file), "../../..")
	migrationsDir, err := filepath.Abs(filepath.Join(svcRoot, "migrations"))
	require.NoError(t, err)
	integration.ApplyMigrations(ctx, t, pool, migrationsDir)
	return pool
}

// TestBootstrapPrincipalActivatesThroughReset follows the documented day-zero
// path: bootstrap creates a verified principal with no credential, and the
// first password reset gives it one.
func TestBootstrapPrincipalActivatesThroughReset(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	pool := migratedPool(ctx, t)

	// The explicit transaction puts its start (CURRENT_TIMESTAMP) before the
	// row's clock_timestamp() created_at, as in production.
	tx, err := pool.Begin(ctx)
	require.NoError(t, err)
	_, err = tx.Exec(ctx, `SELECT pg_sleep(0.01)`)
	require.NoError(t, err)
	var principalID uuid.UUID
	err = tx.QueryRow(ctx, `SELECT identity.bootstrap_first_principal($1, 'admin@example.com', 'Admin')`,
		uuid.New()).Scan(&principalID)
	require.NoError(t, err, "bootstrap must satisfy the principals CHECK constraints")
	require.NoError(t, tx.Commit(ctx))

	repository, err := repo.NewPostgres(pool, map[string][]byte{"k": make([]byte, 32)}, "k")
	require.NoError(t, err)
	tokenHash := make([]byte, 32)
	tokenHash[0] = 1
	matched, err := repository.RequestPasswordReset(ctx, app.PasswordResetRequest{
		TokenID: uuid.NewString(), Email: "admin@example.com", TokenHash: tokenHash,
		ExpiresAt: time.Now().UTC().Add(time.Hour), RequestIP: "127.0.0.1", RequestID: uuid.NewString(),
	})
	require.NoError(t, err)
	require.True(t, matched, "a live account matches")
	matched, err = repository.RequestPasswordReset(ctx, app.PasswordResetRequest{
		TokenID: uuid.NewString(), Email: "nobody@example.com", TokenHash: make([]byte, 32),
		ExpiresAt: time.Now().UTC().Add(time.Hour), RequestIP: "127.0.0.1", RequestID: uuid.NewString(),
	})
	require.NoError(t, err)
	require.False(t, matched, "an unknown address matches nothing and sends nothing")
	require.NoError(t, repository.ResetPassword(ctx, app.PasswordReset{
		TokenHash: tokenHash, PasswordHash: "$argon2id$v=19$m=65536,t=3,p=4$c2FsdA$aGFzaA",
		RequestIP: "127.0.0.1", RequestID: uuid.NewString(),
	}), "the first reset must create the missing credential")

	var credentials int
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT count(*) FROM identity.password_credentials WHERE principal_id = $1`, principalID).Scan(&credentials))
	require.Equal(t, 1, credentials)
}

// TestProvisionedAccountLifecycle covers ADR-0019 against real PostgreSQL:
// username sign-in without email, all-or-nothing conflicts, reissue,
// disable, and discard freeing the username.
func TestProvisionedAccountLifecycle(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	pool := migratedPool(ctx, t)
	repository, err := repo.NewPostgres(pool, map[string][]byte{"k": make([]byte, 32)}, "k")
	require.NoError(t, err)
	audit := app.AccountAudit{ActorID: uuid.NewString(), RequestID: uuid.NewString()}

	hash, err := domain.HashPassword("Generated2345")
	require.NoError(t, err)
	student := app.NewAccount{PrincipalID: uuid.NewString(), Username: "22cs001", DisplayName: "Asha Kumar", PasswordHash: hash}
	faculty := app.NewAccount{PrincipalID: uuid.NewString(), Username: "faculty.one", Email: "faculty@college.edu", DisplayName: "Faculty One", PasswordHash: hash}
	require.NoError(t, repository.ProvisionAccounts(ctx, []app.NewAccount{student, faculty}, audit))

	login := func(identifier string) error {
		_, err := repository.Authenticate(ctx, app.Login{
			Identifier: identifier, Password: "Generated2345",
			RefreshFamilyID: uuid.NewString(), RefreshTokenID: uuid.NewString(), RefreshTokenHash: []byte(uuid.NewString()[:32]),
			RefreshExpiresAt: time.Now().Add(time.Hour), AccessTokenID: uuid.NewString(), AccessExpiresAt: time.Now().Add(time.Minute),
			RequestID: uuid.NewString(), LockoutThreshold: 5, LockoutDuration: time.Minute,
		})
		return err
	}
	require.NoError(t, login("22cs001"), "a provisioned student signs in by username without an email")
	require.NoError(t, login("faculty@college.edu"), "a provisioned account with an email signs in by email too")

	duplicate := app.NewAccount{PrincipalID: uuid.NewString(), Username: "22cs001", DisplayName: "Other", PasswordHash: hash}
	fresh := app.NewAccount{PrincipalID: uuid.NewString(), Username: "22cs002", DisplayName: "Fresh", PasswordHash: hash}
	err = repository.ProvisionAccounts(ctx, []app.NewAccount{fresh, duplicate}, audit)
	require.ErrorContains(t, err, "already in use: 22cs001")
	var freshRows int
	require.NoError(t, pool.QueryRow(ctx, `SELECT count(*) FROM identity.principals WHERE username = '22cs002'`).Scan(&freshRows))
	require.Zero(t, freshRows, "a conflict rejects the whole batch")

	newHash, err := domain.HashPassword("Reissued23456")
	require.NoError(t, err)
	names, err := repository.SetPasswords(ctx, []app.PasswordAssignment{{PrincipalID: student.PrincipalID, PasswordHash: newHash}}, audit)
	require.NoError(t, err)
	require.Equal(t, []app.AccountName{{PrincipalID: student.PrincipalID, Username: "22cs001", DisplayName: "Asha Kumar"}}, names)
	var liveFamilies int
	require.NoError(t, pool.QueryRow(ctx, `SELECT count(*) FROM identity.refresh_session_families WHERE principal_id = $1 AND state = 'active'`,
		student.PrincipalID).Scan(&liveFamilies))
	require.Zero(t, liveFamilies, "reissue signs the student out")
	require.Error(t, login("22cs001"), "the old password stops working")

	require.NoError(t, repository.SetAccountStatus(ctx, []string{faculty.PrincipalID}, "disabled", audit))
	require.Error(t, login("faculty.one"), "a disabled account cannot sign in")
	require.NoError(t, repository.SetAccountStatus(ctx, []string{faculty.PrincipalID}, "active", audit))
	require.NoError(t, login("faculty.one"))

	_, err = repository.SetPasswords(ctx, []app.PasswordAssignment{{PrincipalID: uuid.NewString(), PasswordHash: newHash}}, audit)
	require.ErrorContains(t, err, "not found")

	never := app.NewAccount{PrincipalID: uuid.NewString(), Username: "22cs003", DisplayName: "Never", PasswordHash: hash}
	require.NoError(t, repository.ProvisionAccounts(ctx, []app.NewAccount{never}, audit))
	require.NoError(t, repository.DiscardAccounts(ctx, []string{never.PrincipalID, faculty.PrincipalID}, audit))
	var faculties int
	require.NoError(t, pool.QueryRow(ctx, `SELECT count(*) FROM identity.principals WHERE id = $1 AND deleted_at IS NULL`, faculty.PrincipalID).Scan(&faculties))
	require.Equal(t, 1, faculties, "discard never removes an account that has signed in")
	require.NoError(t, repository.ProvisionAccounts(ctx, []app.NewAccount{{PrincipalID: uuid.NewString(), Username: "22cs003", DisplayName: "Retry", PasswordHash: hash}}, audit),
		"a discarded username can be imported again")

	var audits int
	require.NoError(t, pool.QueryRow(ctx, `SELECT count(*) FROM identity.auth_events WHERE event_type LIKE 'identity.account.%' AND metadata->>'actor_id' = $1`,
		audit.ActorID).Scan(&audits))
	require.Equal(t, 8, audits, "every account change is audited with its administrator")
}

// TestIssuedPasswordMustBeChanged covers ADR-0036: a staff-issued password
// signs in with the change required, the current password is checked, and a
// successful change clears the requirement until staff issue another.
func TestIssuedPasswordMustBeChanged(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	pool := migratedPool(ctx, t)
	repository, err := repo.NewPostgres(pool, map[string][]byte{"k": make([]byte, 32)}, "k")
	require.NoError(t, err)
	audit := app.AccountAudit{ActorID: uuid.NewString(), RequestID: uuid.NewString()}
	issued, err := domain.HashPassword("Issued234567")
	require.NoError(t, err)
	student := app.NewAccount{PrincipalID: uuid.NewString(), Username: "23cs001", DisplayName: "Ravi", PasswordHash: issued}
	require.NoError(t, repository.ProvisionAccounts(ctx, []app.NewAccount{student}, audit))

	login := func(password string) app.Session {
		session, err := repository.Authenticate(ctx, app.Login{
			Identifier: "23cs001", Password: password,
			RefreshFamilyID: uuid.NewString(), RefreshTokenID: uuid.NewString(), RefreshTokenHash: []byte(uuid.NewString()[:32]),
			RefreshExpiresAt: time.Now().Add(time.Hour), AccessTokenID: uuid.NewString(), AccessExpiresAt: time.Now().Add(time.Minute),
			RequestID: uuid.NewString(), LockoutThreshold: 5, LockoutDuration: time.Minute,
		})
		require.NoError(t, err)
		return session
	}
	require.True(t, login("Issued234567").PasswordChangeRequired, "an imported password must be replaced")

	chosen, err := domain.HashPassword("MyOwnPass7890")
	require.NoError(t, err)
	change := app.PasswordChange{PrincipalID: student.PrincipalID, CurrentPassword: "wrong", PasswordHash: chosen, RequestID: uuid.NewString()}
	require.Error(t, repository.ChangePassword(ctx, change), "the current password is checked")
	change.CurrentPassword = "Issued234567"
	require.NoError(t, repository.ChangePassword(ctx, change))
	require.False(t, login("MyOwnPass7890").PasswordChangeRequired)

	_, err = repository.SetPasswords(ctx, []app.PasswordAssignment{{PrincipalID: student.PrincipalID, PasswordHash: issued}}, audit)
	require.NoError(t, err)
	require.True(t, login("Issued234567").PasswordChangeRequired, "a reissued password must be replaced again")
}

// A disabled factor must satisfy mfa_factors' check that only active factors are verified, so disabling clears
// verified_at. It used to fail with a constraint violation (HTTP 500), leaving the factor active.
func TestDisableTOTPFactor(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	pool := migratedPool(ctx, t)
	repository, err := repo.NewPostgres(pool, map[string][]byte{"k": make([]byte, 32)}, "k")
	require.NoError(t, err)

	hash, err := domain.HashPassword("Generated2345")
	require.NoError(t, err)
	account := app.NewAccount{PrincipalID: uuid.NewString(), Username: "mfa.user", DisplayName: "MFA User", PasswordHash: hash}
	require.NoError(t, repository.ProvisionAccounts(ctx, []app.NewAccount{account}, app.AccountAudit{ActorID: uuid.NewString(), RequestID: uuid.NewString()}))

	secret, err := domain.NewTOTPSecret()
	require.NoError(t, err)
	factorID := uuid.NewString()
	require.NoError(t, repository.BeginTOTP(ctx, app.TOTPEnrollment{FactorID: factorID, PrincipalID: account.PrincipalID, Label: "phone", Secret: secret}))
	_, err = repository.ActivateTOTP(ctx, app.TOTPActivation{PrincipalID: account.PrincipalID, FactorID: factorID, Code: totpAt(t, secret, time.Now())})
	require.NoError(t, err)

	// The activation code is spent; the next 30-second slice is still inside the accepted window.
	require.NoError(t, repository.DisableTOTP(ctx, app.TOTPDisable{PrincipalID: account.PrincipalID, FactorID: factorID, Code: totpAt(t, secret, time.Now().Add(30*time.Second))}))

	var status string
	var verified bool
	require.NoError(t, pool.QueryRow(ctx, `SELECT status, verified_at IS NOT NULL FROM identity.mfa_factors WHERE id = $1`, factorID).Scan(&status, &verified))
	require.Equal(t, "disabled", status)
	require.False(t, verified)
}

// totpAt is RFC 6238 (SHA-1, 6 digits, 30 seconds) for the slice containing at.
func totpAt(t *testing.T, secret string, at time.Time) string {
	t.Helper()
	key, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(strings.ToUpper(strings.TrimRight(secret, "=")))
	require.NoError(t, err)
	var counter [8]byte
	binary.BigEndian.PutUint64(counter[:], uint64(at.Unix()/30))
	mac := hmac.New(sha1.New, key)
	mac.Write(counter[:])
	sum := mac.Sum(nil)
	offset := sum[len(sum)-1] & 0x0f
	value := (binary.BigEndian.Uint32(sum[offset:offset+4]) & 0x7fffffff) % 1000000
	return fmt.Sprintf("%06d", value)
}
