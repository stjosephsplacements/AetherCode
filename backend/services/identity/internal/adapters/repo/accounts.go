package repo

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/aethercode/aethercode/libs/pkg/database"
	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
	"github.com/aethercode/aethercode/services/identity/internal/app"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// ProvisionAccounts inserts active principals and their credentials in one
// transaction. Taken usernames or emails reject the whole batch and are named
// in the error so the administrator can fix the file.
func (repository *Postgres) ProvisionAccounts(contextValue context.Context, accounts []app.NewAccount, audit app.AccountAudit) error {
	ids := make([]string, len(accounts))
	usernames := make([]string, len(accounts))
	emails := make([]string, len(accounts))
	displayNames := make([]string, len(accounts))
	hashes := make([]string, len(accounts))
	for index, account := range accounts {
		ids[index], usernames[index], emails[index] = account.PrincipalID, account.Username, account.Email
		displayNames[index], hashes[index] = account.DisplayName, account.PasswordHash
	}
	return repository.accountTransaction(contextValue, "provision accounts", func(transaction pgx.Tx) error {
		if err := rejectTakenIdentifiers(contextValue, transaction, usernames, emails); err != nil {
			return err
		}
		if _, err := transaction.Exec(contextValue, `
			INSERT INTO identity.principals (id, username, email, display_name, status)
			SELECT id, username, NULLIF(email, ''), display_name, 'active'
			FROM unnest($1::uuid[], $2::text[], $3::text[], $4::text[]) AS account(id, username, email, display_name)
		`, ids, usernames, emails, displayNames); err != nil {
			var postgresError *pgconn.PgError
			if errors.As(err, &postgresError) && postgresError.Code == "23505" {
				return apperrors.New(apperrors.CodeConflict, "a username or email was taken while importing; retry the import")
			}
			return fmt.Errorf("insert provisioned principals: %w", err)
		}
		if _, err := transaction.Exec(contextValue, `
			INSERT INTO identity.password_credentials (principal_id, password_hash)
			SELECT * FROM unnest($1::uuid[], $2::text[])
		`, ids, hashes); err != nil {
			return fmt.Errorf("insert provisioned credentials: %w", err)
		}
		return recordAccountEvents(contextValue, transaction, ids, "identity.account.provisioned.v1", audit)
	})
}

// SetPasswords replaces credentials, clears lockouts, and ends every session
// of the given principals. Disabled accounts stay disabled.
func (repository *Postgres) SetPasswords(contextValue context.Context, assignments []app.PasswordAssignment, audit app.AccountAudit) ([]app.AccountName, error) {
	ids := make([]string, len(assignments))
	hashes := make([]string, len(assignments))
	for index, assignment := range assignments {
		ids[index], hashes[index] = assignment.PrincipalID, assignment.PasswordHash
	}
	var names []app.AccountName
	return names, repository.accountTransaction(contextValue, "reissue passwords", func(transaction pgx.Tx) error {
		var err error
		if names, err = lockLivePrincipals(contextValue, transaction, ids); err != nil {
			return err
		}
		if _, err := transaction.Exec(contextValue, `
			INSERT INTO identity.password_credentials (principal_id, password_hash)
			SELECT * FROM unnest($1::uuid[], $2::text[])
			ON CONFLICT (principal_id) DO UPDATE
			SET password_hash = EXCLUDED.password_hash, changed_at = clock_timestamp(), must_change = false,
			    version = identity.password_credentials.version + 1
		`, ids, hashes); err != nil {
			return fmt.Errorf("replace credentials: %w", err)
		}
		if _, err := transaction.Exec(contextValue, `
			UPDATE identity.principals SET status = 'active', version = version + 1
			WHERE id = ANY($1::uuid[]) AND status = 'locked'
		`, ids); err != nil {
			return fmt.Errorf("unlock reissued principals: %w", err)
		}
		if err := clearLockouts(contextValue, transaction, ids); err != nil {
			return err
		}
		if err := revokeSessions(contextValue, transaction, ids, "password_reissued"); err != nil {
			return err
		}
		return recordAccountEvents(contextValue, transaction, ids, "identity.account.password_reissued.v1", audit)
	})
}

// SetAccountStatus enables or disables principals. Enabling also clears a
// lockout; disabling ends every session at once.
func (repository *Postgres) SetAccountStatus(contextValue context.Context, ids []string, status string, audit app.AccountAudit) error {
	return repository.accountTransaction(contextValue, "set account status", func(transaction pgx.Tx) error {
		if _, err := lockLivePrincipals(contextValue, transaction, ids); err != nil {
			return err
		}
		if _, err := transaction.Exec(contextValue, `
			UPDATE identity.principals SET status = $2, version = version + 1
			WHERE id = ANY($1::uuid[]) AND status <> $2
		`, ids, status); err != nil {
			return fmt.Errorf("update account status: %w", err)
		}
		if status == "active" {
			if err := clearLockouts(contextValue, transaction, ids); err != nil {
				return err
			}
		} else if err := revokeSessions(contextValue, transaction, ids, "account_disabled"); err != nil {
			return err
		}
		eventType := "identity.account.enabled.v1"
		if status == "disabled" {
			eventType = "identity.account.disabled.v1"
		}
		return recordAccountEvents(contextValue, transaction, ids, eventType, audit)
	})
}

// DiscardAccounts soft-deletes provisioned principals that have never signed
// in, freeing their usernames after a failed import.
func (repository *Postgres) DiscardAccounts(contextValue context.Context, ids []string, audit app.AccountAudit) error {
	return repository.accountTransaction(contextValue, "discard accounts", func(transaction pgx.Tx) error {
		rows, err := transaction.Query(contextValue, `
			UPDATE identity.principals
			SET deleted_at = clock_timestamp(), deleted_by = $2, deletion_reason = 'provisioning rolled back'
			WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL AND last_authenticated_at IS NULL
			RETURNING id::text
		`, ids, audit.ActorID)
		if err != nil {
			return fmt.Errorf("discard provisioned principals: %w", err)
		}
		discarded, err := pgx.CollectRows(rows, pgx.RowTo[string])
		if err != nil {
			return fmt.Errorf("discard provisioned principals: %w", err)
		}
		if len(discarded) == 0 {
			return nil
		}
		return recordAccountEvents(contextValue, transaction, discarded, "identity.account.discarded.v1", audit)
	})
}

func (repository *Postgres) accountTransaction(contextValue context.Context, operation string, work func(pgx.Tx) error) error {
	transaction, err := repository.pool.BeginTx(contextValue, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return fmt.Errorf("begin %s: %w", operation, err)
	}
	defer func() { _ = transaction.Rollback(contextValue) }()
	if err := work(transaction); err != nil {
		return err
	}
	if err := transaction.Commit(contextValue); err != nil {
		return fmt.Errorf("commit %s: %w", operation, err)
	}
	return nil
}

// rejectTakenIdentifiers reports up to ten usernames or emails that already
// belong to a live principal.
func rejectTakenIdentifiers(contextValue context.Context, transaction pgx.Tx, usernames, emails []string) error {
	rows, err := transaction.Query(contextValue, `
		SELECT identifier FROM (
			SELECT username AS identifier FROM identity.principals
			WHERE deleted_at IS NULL AND username = ANY($1::text[])
			UNION
			SELECT lower(email) FROM identity.principals
			WHERE deleted_at IS NULL AND lower(email) = ANY($2::text[])
		) AS taken
		ORDER BY identifier
		LIMIT 10
	`, usernames, emails)
	if err != nil {
		return fmt.Errorf("check taken identifiers: %w", err)
	}
	taken, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return fmt.Errorf("read taken identifiers: %w", err)
	}
	if len(taken) > 0 {
		return apperrors.New(apperrors.CodeConflict, "already in use: "+strings.Join(taken, ", "))
	}
	return nil
}

// lockLivePrincipals locks every principal and fails unless all exist and are
// not deleted, so a batch change never applies partially.
func lockLivePrincipals(contextValue context.Context, transaction pgx.Tx, ids []string) ([]app.AccountName, error) {
	rows, err := transaction.Query(contextValue, `
		SELECT id::text, COALESCE(username, ''), display_name FROM identity.principals
		WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL
		FOR UPDATE
	`, ids)
	if err != nil {
		return nil, fmt.Errorf("lock principals: %w", err)
	}
	locked, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (app.AccountName, error) {
		var name app.AccountName
		return name, row.Scan(&name.PrincipalID, &name.Username, &name.DisplayName)
	})
	if err != nil {
		return nil, fmt.Errorf("lock principals: %w", err)
	}
	if len(locked) != len(ids) {
		return nil, apperrors.New(apperrors.CodeNotFound, "one or more accounts were not found")
	}
	return locked, nil
}

func clearLockouts(contextValue context.Context, transaction pgx.Tx, ids []string) error {
	if _, err := transaction.Exec(contextValue, `
		UPDATE identity.account_lockouts
		SET failed_attempt_count = 0, locked_until = NULL, last_failed_at = NULL, version = version + 1
		WHERE principal_id = ANY($1::uuid[])
	`, ids); err != nil {
		return fmt.Errorf("clear account lockouts: %w", err)
	}
	return nil
}

func revokeSessions(contextValue context.Context, transaction pgx.Tx, ids []string, reason string) error {
	if _, err := transaction.Exec(contextValue, `
		UPDATE identity.refresh_session_families
		SET state = 'revoked', revoked_at = clock_timestamp(), revoke_reason = $2, version = version + 1
		WHERE principal_id = ANY($1::uuid[]) AND state = 'active'
	`, ids, reason); err != nil {
		return fmt.Errorf("revoke refresh sessions: %w", err)
	}
	if _, err := transaction.Exec(contextValue, `
		UPDATE identity.access_token_sessions
		SET revoked_at = clock_timestamp(), revoke_reason = $2
		WHERE principal_id = ANY($1::uuid[]) AND revoked_at IS NULL
	`, ids, reason); err != nil {
		return fmt.Errorf("revoke access tokens: %w", err)
	}
	return nil
}

// recordAccountEvents writes one audit row per principal, naming the
// administrator who acted.
func recordAccountEvents(contextValue context.Context, transaction pgx.Tx, ids []string, eventType string, audit app.AccountAudit) error {
	eventIDs := make([]string, len(ids))
	for index := range ids {
		eventID, err := database.NewUUIDv7()
		if err != nil {
			return err
		}
		eventIDs[index] = eventID
	}
	if _, err := transaction.Exec(contextValue, `
		INSERT INTO identity.auth_events (event_id, principal_id, event_type, outcome, request_id, metadata)
		SELECT event_id, principal_id, $3, 'success', $4, jsonb_build_object('actor_id', $5::text)
		FROM unnest($1::uuid[], $2::uuid[]) AS event(event_id, principal_id)
	`, eventIDs, ids, eventType, audit.RequestID, audit.ActorID); err != nil {
		return fmt.Errorf("record account audit events: %w", err)
	}
	return nil
}
