package repo

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
	"github.com/aethercode/aethercode/services/identity/internal/app"
	"github.com/jackc/pgx/v5"
)

// AuthenticateSSO starts a session for the account the provider vouched for
// (ADR-0042). The account is found by its link to the provider's subject, or
// on first use by username, which is then linked. A link to a different
// subject is refused, so a username reused in the provider cannot take over
// an account. Password lockout does not apply: the provider authenticated.
func (repository *Postgres) AuthenticateSSO(contextValue context.Context, command app.SSOLogin) (app.Session, error) {
	transaction, err := repository.pool.BeginTx(contextValue, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return app.Session{}, fmt.Errorf("begin SSO login: %w", err)
	}
	defer func() { _ = transaction.Rollback(contextValue) }()

	var principalID, status string
	var linkedSubject *string
	err = transaction.QueryRow(contextValue, `
		SELECT principal.id, principal.status, link.subject
		FROM identity.principals AS principal
		LEFT JOIN identity.sso_links AS link ON link.principal_id = principal.id
		WHERE principal.deleted_at IS NULL
		  AND (link.subject = $1 OR (principal.username = $2 AND $2 <> ''))
		ORDER BY (link.subject = $1) DESC NULLS LAST
		LIMIT 1
		FOR UPDATE OF principal
	`, command.Identity.Subject, command.Identity.Username).Scan(&principalID, &status, &linkedSubject)
	denied := func(reason, message string, code apperrors.Code) (app.Session, error) {
		if err := repository.recordAuthEvent(contextValue, transaction, authEvent{
			PrincipalID: principalID, EventType: "identity.login.v1", Outcome: "failure", RequestID: command.RequestID,
			IPAddress: command.RequestIP, UserAgent: command.UserAgent,
			Metadata: map[string]string{"reason": reason, "method": "sso"},
		}); err != nil {
			return app.Session{}, err
		}
		if err := transaction.Commit(contextValue); err != nil {
			return app.Session{}, fmt.Errorf("commit SSO login audit: %w", err)
		}
		return app.Session{}, apperrors.New(code, message)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return denied("no_account", "Your St. Joseph's account has no AetherCode account yet. Ask your faculty to add you.", apperrors.CodeForbidden)
	}
	if err != nil {
		return app.Session{}, fmt.Errorf("find SSO principal: %w", err)
	}
	if linkedSubject != nil && *linkedSubject != command.Identity.Subject {
		return denied("subject_mismatch", "This AetherCode account is linked to a different St. Joseph's account.", apperrors.CodeForbidden)
	}
	if status != "active" && status != "locked" {
		return denied("account_"+status, "This account is disabled. Ask your faculty.", apperrors.CodeForbidden)
	}
	if linkedSubject == nil {
		if _, err := transaction.Exec(contextValue, `
			INSERT INTO identity.sso_links (principal_id, subject) VALUES ($1, $2)
			ON CONFLICT (principal_id) DO UPDATE SET subject = EXCLUDED.subject
		`, principalID, command.Identity.Subject); err != nil {
			return app.Session{}, fmt.Errorf("link SSO subject: %w", err)
		}
	}
	if _, err := transaction.Exec(contextValue, `
		UPDATE identity.principals SET last_authenticated_at = clock_timestamp(), version = version + 1 WHERE id = $1
	`, principalID); err != nil {
		return app.Session{}, fmt.Errorf("update SSO principal: %w", err)
	}
	if err := createRefreshSession(contextValue, transaction, refreshSessionCommand{
		PrincipalID: principalID, FamilyID: command.RefreshFamilyID, TokenID: command.RefreshTokenID,
		TokenHash: command.RefreshTokenHash, ExpiresAt: command.RefreshExpiresAt, AccessTokenID: command.AccessTokenID,
		AccessExpiresAt: command.AccessExpiresAt, UserAgent: command.UserAgent,
	}); err != nil {
		return app.Session{}, err
	}
	if err := repository.recordAuthEvent(contextValue, transaction, authEvent{
		PrincipalID: principalID, EventType: "identity.login.v1", Outcome: "success", RequestID: command.RequestID,
		IPAddress: command.RequestIP, UserAgent: command.UserAgent, Metadata: map[string]string{"method": "sso"},
	}); err != nil {
		return app.Session{}, err
	}
	payload, err := json.Marshal(struct {
		PrincipalID string `json:"principal_id"`
		FamilyID    string `json:"refresh_family_id"`
	}{PrincipalID: principalID, FamilyID: command.RefreshFamilyID})
	if err != nil {
		return app.Session{}, fmt.Errorf("encode login event: %w", err)
	}
	if err := repository.enqueue(contextValue, transaction, principalID, "identity.session.created.v1", payload); err != nil {
		return app.Session{}, err
	}
	if err := transaction.Commit(contextValue); err != nil {
		return app.Session{}, fmt.Errorf("commit SSO login: %w", err)
	}
	return app.Session{PrincipalID: principalID, AuthzRevision: 1}, nil
}

// DueDirectorySync returns accounts waiting to be copied to the provider.
// Accounts without a password are dropped from the queue: there is nothing
// to sign in with.
func (repository *Postgres) DueDirectorySync(contextValue context.Context, limit int) ([]app.DirectoryAccount, error) {
	if _, err := repository.pool.Exec(contextValue, `
		DELETE FROM identity.sso_directory_sync AS queued
		WHERE NOT EXISTS (
			SELECT 1 FROM identity.principals AS principal
			JOIN identity.password_credentials AS credential ON credential.principal_id = principal.id
			WHERE principal.id = queued.principal_id AND principal.deleted_at IS NULL
		)
	`); err != nil {
		return nil, fmt.Errorf("drop accounts without a password from directory sync: %w", err)
	}
	rows, err := repository.pool.Query(contextValue, `
		SELECT principal.id, COALESCE(principal.username, lower(principal.email)), COALESCE(principal.email, ''),
		       principal.display_name, credential.password_hash, credential.must_change,
		       COALESCE(link.directory_user_id, ''), COALESCE(link.created_by_aethercode, false), queued.requested_at
		FROM identity.sso_directory_sync AS queued
		JOIN identity.principals AS principal ON principal.id = queued.principal_id
		JOIN identity.password_credentials AS credential ON credential.principal_id = principal.id
		LEFT JOIN identity.sso_links AS link ON link.principal_id = principal.id
		WHERE queued.next_attempt_at <= clock_timestamp()
		ORDER BY queued.next_attempt_at
		LIMIT $1
	`, limit)
	if err != nil {
		return nil, fmt.Errorf("read directory sync: %w", err)
	}
	defer rows.Close()
	var accounts []app.DirectoryAccount
	for rows.Next() {
		var account app.DirectoryAccount
		if err := rows.Scan(&account.PrincipalID, &account.Username, &account.Email, &account.DisplayName, &account.PasswordHash,
			&account.MustChange, &account.DirectoryUserID, &account.CreatedHere, &account.RequestedAt); err != nil {
			return nil, fmt.Errorf("scan directory sync: %w", err)
		}
		accounts = append(accounts, account)
	}
	return accounts, rows.Err()
}

// LinkDirectoryUser records the provider account an AetherCode account maps to.
func (repository *Postgres) LinkDirectoryUser(contextValue context.Context, principalID, directoryUserID string, createdHere bool) error {
	_, err := repository.pool.Exec(contextValue, `
		INSERT INTO identity.sso_links (principal_id, directory_user_id, created_by_aethercode) VALUES ($1, $2, $3)
		ON CONFLICT (principal_id) DO UPDATE
		SET directory_user_id = EXCLUDED.directory_user_id, created_by_aethercode = EXCLUDED.created_by_aethercode
	`, principalID, directoryUserID, createdHere)
	if err != nil {
		return fmt.Errorf("link directory account: %w", err)
	}
	return nil
}

// FinishDirectorySync removes a synced account from the queue, unless it was
// requested again meanwhile, or schedules a retry with backoff up to 6 hours.
func (repository *Postgres) FinishDirectorySync(contextValue context.Context, principalID string, requestedAt time.Time, syncErr error) error {
	if syncErr == nil {
		_, err := repository.pool.Exec(contextValue, `
			DELETE FROM identity.sso_directory_sync WHERE principal_id = $1 AND requested_at = $2
		`, principalID, requestedAt)
		return err
	}
	message := syncErr.Error()
	if len(message) > 1000 {
		message = message[:1000]
	}
	_, err := repository.pool.Exec(contextValue, `
		UPDATE identity.sso_directory_sync
		SET attempts = attempts + 1, last_error = $2,
		    next_attempt_at = clock_timestamp() + least(interval '1 minute' * power(2, least(attempts, 9)), interval '6 hours')
		WHERE principal_id = $1
	`, principalID, message)
	return err
}
