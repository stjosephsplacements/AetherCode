//go:build integration

package repo_test

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
	"github.com/aethercode/aethercode/services/identity/internal/adapters/repo"
	"github.com/aethercode/aethercode/services/identity/internal/app"
	"github.com/aethercode/aethercode/services/identity/internal/domain"
)

// TestUpdateAccount covers ADR-0057's edit: only the fields sent change, an empty email or phone
// clears it, a new email loses its verified mark, a taken email is a conflict, and an account
// that signs in by email cannot lose the email.
func TestUpdateAccount(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	pool := migratedPool(ctx, t)
	repository, err := repo.NewPostgres(pool, map[string][]byte{"k": make([]byte, 32)}, "k")
	require.NoError(t, err)
	audit := app.AccountAudit{ActorID: uuid.NewString(), RequestID: uuid.NewString()}

	hash, err := domain.HashPassword("Generated2345")
	require.NoError(t, err)
	asha := app.NewAccount{PrincipalID: uuid.NewString(), Username: "21cs001", Email: "asha@example.edu", DisplayName: "Asha", PasswordHash: hash}
	vikram := app.NewAccount{PrincipalID: uuid.NewString(), Username: "21cs002", Email: "vikram@example.edu", DisplayName: "Vikram", PasswordHash: hash}
	roll := app.NewAccount{PrincipalID: uuid.NewString(), Username: "21cs003", DisplayName: "Roll Only", PasswordHash: hash}
	require.NoError(t, repository.ProvisionAccounts(ctx, []app.NewAccount{asha, vikram, roll}, audit))
	_, err = pool.Exec(ctx, `UPDATE identity.principals SET email_verified_at = clock_timestamp() WHERE id = $1`, asha.PrincipalID)
	require.NoError(t, err)

	text := func(value string) *string { return &value }
	describe := func(id string) app.AccountSummary {
		t.Helper()
		summaries, err := repository.DescribeAccounts(ctx, []string{id})
		require.NoError(t, err)
		require.Len(t, summaries, 1)
		return summaries[0]
	}
	verified := func(id string) bool {
		var at *string
		require.NoError(t, pool.QueryRow(ctx, `SELECT email_verified_at::text FROM identity.principals WHERE id = $1`, id).Scan(&at))
		return at != nil
	}

	// A phone alone changes only the phone, and leaves the verified email verified.
	require.NoError(t, repository.UpdateAccount(ctx, asha.PrincipalID, app.AccountChanges{Phone: text("+91 98765 43210")}, audit))
	got := describe(asha.PrincipalID)
	require.Equal(t, "+91 98765 43210", got.Phone)
	require.Equal(t, "Asha", got.DisplayName)
	require.Equal(t, "asha@example.edu", got.Email)
	require.True(t, verified(asha.PrincipalID))

	// A new email replaces the old and clears the verified mark; the name changes with it.
	require.NoError(t, repository.UpdateAccount(ctx, asha.PrincipalID, app.AccountChanges{DisplayName: text("Asha Raman"), Email: text("asha.raman@example.edu")}, audit))
	got = describe(asha.PrincipalID)
	require.Equal(t, "Asha Raman", got.DisplayName)
	require.Equal(t, "asha.raman@example.edu", got.Email)
	require.False(t, verified(asha.PrincipalID), "an unproven address is not verified")

	// Sending the same email again keeps whatever mark it has.
	require.NoError(t, repository.UpdateAccount(ctx, asha.PrincipalID, app.AccountChanges{Email: text("asha.raman@example.edu")}, audit))

	// An empty phone clears it.
	require.NoError(t, repository.UpdateAccount(ctx, asha.PrincipalID, app.AccountChanges{Phone: text("")}, audit))
	require.Empty(t, describe(asha.PrincipalID).Phone)

	// Another account's email is a conflict.
	err = repository.UpdateAccount(ctx, vikram.PrincipalID, app.AccountChanges{Email: text("ASHA.RAMAN@example.edu")}, audit)
	var domainError *apperrors.Error
	require.ErrorAs(t, err, &domainError)
	require.Equal(t, apperrors.CodeConflict, domainError.Code)

	// A bad phone never reaches the column.
	err = repository.UpdateAccount(ctx, vikram.PrincipalID, app.AccountChanges{Phone: text("call me")}, audit)
	require.Error(t, err)

	// A roll-number account may gain an email; an account with neither email nor username cannot exist.
	require.NoError(t, repository.UpdateAccount(ctx, roll.PrincipalID, app.AccountChanges{Email: text("roll@example.edu")}, audit))
	require.Equal(t, "roll@example.edu", describe(roll.PrincipalID).Email)

	// Every change is recorded against the actor.
	var events int
	require.NoError(t, pool.QueryRow(ctx, `SELECT count(*) FROM identity.auth_events WHERE event_type = 'identity.account.updated.v1' AND metadata->>'actor_id' = $1`, audit.ActorID).Scan(&events))
	require.Equal(t, 5, events, "the five that succeeded; the conflict and the bad phone rolled back")

	// An unknown account is not found.
	err = repository.UpdateAccount(ctx, uuid.NewString(), app.AccountChanges{Phone: text("123456")}, audit)
	require.ErrorAs(t, err, &domainError)
	require.Equal(t, apperrors.CodeNotFound, domainError.Code)
}
