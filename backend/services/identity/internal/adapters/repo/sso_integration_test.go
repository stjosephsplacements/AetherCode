//go:build integration

package repo_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
	"github.com/aethercode/aethercode/services/identity/internal/adapters/repo"
	"github.com/aethercode/aethercode/services/identity/internal/app"
	"github.com/aethercode/aethercode/services/identity/internal/domain"
)

// TestSingleSignOn covers ADR-0042's database side: provisioning queues the
// account for the provider, sync results are recorded, SSO signs in the
// account with the same username and links it, and a different subject is
// refused, as is a name with no AetherCode account.
func TestSingleSignOn(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	pool := migratedPool(ctx, t)
	repository, err := repo.NewPostgres(pool, map[string][]byte{"k": make([]byte, 32)}, "k")
	require.NoError(t, err)

	hash, err := domain.HashPassword("Generated2345")
	require.NoError(t, err)
	student := app.NewAccount{PrincipalID: uuid.NewString(), Username: "23ec014", DisplayName: "Meera Nair", PasswordHash: hash}
	require.NoError(t, repository.ProvisionAccounts(ctx, []app.NewAccount{student},
		app.AccountAudit{ActorID: uuid.NewString(), RequestID: uuid.NewString()}))

	summaries, err := repository.DescribeAccounts(ctx, []string{student.PrincipalID, uuid.NewString()})
	require.NoError(t, err)
	require.Equal(t, []app.AccountSummary{{PrincipalID: student.PrincipalID, Username: "23ec014", DisplayName: "Meera Nair", Status: "active"}}, summaries,
		"existing accounts are described by name and status only (ADR-0043)")

	due, err := repository.DueDirectorySync(ctx, 10)
	require.NoError(t, err)
	require.Len(t, due, 1, "a provisioned account is queued for the provider")
	require.Equal(t, "23ec014", due[0].Username)
	require.Equal(t, hash, due[0].PasswordHash)
	require.True(t, due[0].MustChange)

	// A failure is retried later; a success leaves the queue.
	require.NoError(t, repository.FinishDirectorySync(ctx, student.PrincipalID, due[0].RequestedAt, errors.New("provider down")))
	due, err = repository.DueDirectorySync(ctx, 10)
	require.NoError(t, err)
	require.Empty(t, due, "a failed sync waits for its backoff")
	_, err = pool.Exec(ctx, `UPDATE identity.sso_directory_sync SET next_attempt_at = clock_timestamp()`)
	require.NoError(t, err)
	due, err = repository.DueDirectorySync(ctx, 10)
	require.NoError(t, err)
	require.Len(t, due, 1)
	require.NoError(t, repository.LinkDirectoryUser(ctx, student.PrincipalID, "zitadel-user-1", true))
	require.NoError(t, repository.FinishDirectorySync(ctx, student.PrincipalID, due[0].RequestedAt, nil))
	due, err = repository.DueDirectorySync(ctx, 10)
	require.NoError(t, err)
	require.Empty(t, due)

	// A password change queues the account again, still linked.
	_, err = pool.Exec(ctx, `UPDATE identity.password_credentials SET password_hash = $2 WHERE principal_id = $1`, student.PrincipalID, hash)
	require.NoError(t, err)
	due, err = repository.DueDirectorySync(ctx, 10)
	require.NoError(t, err)
	require.Len(t, due, 1)
	require.Equal(t, "zitadel-user-1", due[0].DirectoryUserID)
	require.True(t, due[0].CreatedHere)

	signIn := func(subject, username string) (app.Session, error) {
		return repository.AuthenticateSSO(ctx, app.SSOLogin{
			Identity:        app.SSOIdentity{Subject: subject, Username: username},
			RefreshFamilyID: uuid.NewString(), RefreshTokenID: uuid.NewString(), RefreshTokenHash: []byte(uuid.NewString()[:32]),
			RefreshExpiresAt: time.Now().Add(time.Hour), AccessTokenID: uuid.NewString(), AccessExpiresAt: time.Now().Add(time.Minute),
			RequestID: uuid.NewString(),
		})
	}
	session, err := signIn("subject-1", "23ec014")
	require.NoError(t, err, "the provider's user signs in as the account with the same username")
	require.Equal(t, student.PrincipalID, session.PrincipalID)
	require.False(t, session.PasswordChangeRequired, "the provider handled the password")
	session, err = signIn("subject-1", "renamed-in-provider")
	require.NoError(t, err, "once linked, the subject signs in whatever the username")
	require.Equal(t, student.PrincipalID, session.PrincipalID)

	_, err = signIn("subject-2", "23ec014")
	requireCode(t, err, apperrors.CodeForbidden, "another provider user with the same username is refused")
	_, err = signIn("subject-3", "nobody")
	requireCode(t, err, apperrors.CodeForbidden, "a provider user without an AetherCode account is refused")

	_, err = pool.Exec(ctx, `UPDATE identity.principals SET status = 'disabled' WHERE id = $1`, student.PrincipalID)
	require.NoError(t, err)
	_, err = signIn("subject-1", "23ec014")
	requireCode(t, err, apperrors.CodeForbidden, "a disabled account cannot sign in through SSO")
}

func requireCode(t *testing.T, err error, code apperrors.Code, message string) {
	t.Helper()
	var appErr *apperrors.Error
	require.True(t, errors.As(err, &appErr), "%s: got %v", message, err)
	require.Equal(t, code, appErr.Code, message)
}
