// Package repo contains Identity's PostgreSQL persistence adapter.
package repo

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/aethercode/aethercode/libs/pkg/database"
	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
	"github.com/aethercode/aethercode/libs/pkg/messaging"
	"github.com/aethercode/aethercode/services/identity/internal/app"
	"github.com/aethercode/aethercode/services/identity/internal/domain"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Postgres owns all Identity state transitions.  Every externally observable
// authentication change records a security event and an outbox event in the
// same database transaction as the durable state change.
type Postgres struct {
	pool          *pgxpool.Pool
	outbox        *messaging.OutboxStore
	mfaMasterKeys map[string][]byte
	mfaKeyRef     string
}

// NewPostgres creates the database adapter and validates its fixed outbox
// target before the service begins serving requests.
func NewPostgres(pool *pgxpool.Pool, mfaMasterKeys map[string][]byte, mfaKeyReference string) (*Postgres, error) {
	if pool == nil {
		return nil, fmt.Errorf("identity database pool is required")
	}
	mfaKeyReference = strings.TrimSpace(mfaKeyReference)
	if mfaKeyReference == "" || len(mfaMasterKeys) == 0 {
		return nil, fmt.Errorf("identity MFA key reference and master-key set are required")
	}
	keySet := make(map[string][]byte, len(mfaMasterKeys))
	for reference, key := range mfaMasterKeys {
		reference = strings.TrimSpace(reference)
		if reference == "" || len(key) != 32 {
			return nil, fmt.Errorf("identity MFA master-key set contains an invalid key")
		}
		keySet[reference] = append([]byte(nil), key...)
	}
	if _, found := keySet[mfaKeyReference]; !found {
		return nil, fmt.Errorf("identity MFA current key reference is not configured")
	}
	outbox, err := messaging.NewOutboxStore(pool, "app.outbox_events")
	if err != nil {
		return nil, fmt.Errorf("create identity outbox store: %w", err)
	}
	return &Postgres{pool: pool, outbox: outbox, mfaMasterKeys: keySet, mfaKeyRef: mfaKeyReference}, nil
}

// Ping reports whether the service-owned database can accept requests.
func (repository *Postgres) Ping(contextValue context.Context) error {
	if err := repository.pool.Ping(contextValue); err != nil {
		return fmt.Errorf("ping Identity database: %w", err)
	}
	return nil
}

// Register creates a pending principal, its password credential, and one
// verification bearer hash.  The raw bearer never reaches PostgreSQL.
func (repository *Postgres) Register(contextValue context.Context, command app.Registration) error {
	transaction, err := repository.pool.BeginTx(contextValue, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return fmt.Errorf("begin identity registration: %w", err)
	}
	defer func() { _ = transaction.Rollback(contextValue) }()

	_, err = transaction.Exec(contextValue, `
		INSERT INTO identity.principals (id, email, display_name)
		VALUES ($1, $2, $3)
	`, command.PrincipalID, command.Email, command.DisplayName)
	if err != nil {
		return mapRegistrationError(err)
	}
	if _, err := transaction.Exec(contextValue, `
		INSERT INTO identity.password_credentials (principal_id, password_hash)
		VALUES ($1, $2)
	`, command.PrincipalID, command.PasswordHash); err != nil {
		return fmt.Errorf("store password credential: %w", err)
	}
	if _, err := transaction.Exec(contextValue, `
		INSERT INTO identity.email_verification_tokens (
			id, principal_id, token_hash, expires_at, request_ip
		) VALUES ($1, $2, $3, $4, NULLIF($5, '')::inet)
	`, command.VerificationTokenID, command.PrincipalID, command.VerificationTokenHash,
		command.VerificationExpiresAt.UTC(), command.RequestIP); err != nil {
		return fmt.Errorf("store email verification token: %w", err)
	}
	if err := repository.recordAuthEvent(contextValue, transaction, authEvent{
		PrincipalID: command.PrincipalID, EventType: "identity.registration.v1", Outcome: "success",
		RequestID: command.RequestID, IPAddress: command.RequestIP,
	}); err != nil {
		return err
	}
	payload, err := json.Marshal(struct {
		PrincipalID           string    `json:"principal_id"`
		Email                 string    `json:"email"`
		DisplayName           string    `json:"display_name"`
		VerificationTokenID   string    `json:"verification_token_id"`
		VerificationExpiresAt time.Time `json:"verification_expires_at"`
	}{
		PrincipalID: command.PrincipalID, Email: command.Email, DisplayName: command.DisplayName,
		VerificationTokenID: command.VerificationTokenID, VerificationExpiresAt: command.VerificationExpiresAt.UTC(),
	})
	if err != nil {
		return fmt.Errorf("encode principal registered event: %w", err)
	}
	if err := repository.enqueue(contextValue, transaction, command.PrincipalID, "identity.principal.registered.v1", payload); err != nil {
		return err
	}
	if err := transaction.Commit(contextValue); err != nil {
		return fmt.Errorf("commit identity registration: %w", err)
	}
	return nil
}

// VerifyEmail atomically consumes a verification token before activating the
// principal.  It gives callers one generic failure result for every bad token.
func (repository *Postgres) VerifyEmail(contextValue context.Context, tokenHash []byte) (string, error) {
	transaction, err := repository.pool.BeginTx(contextValue, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return "", fmt.Errorf("begin email verification: %w", err)
	}
	defer func() { _ = transaction.Rollback(contextValue) }()

	var tokenID, principalID, status string
	var expiresAt time.Time
	var consumedAt *time.Time
	err = transaction.QueryRow(contextValue, `
		SELECT token.id, principal.id, principal.status, token.expires_at, token.consumed_at
		FROM identity.email_verification_tokens AS token
		JOIN identity.principals AS principal ON principal.id = token.principal_id
		WHERE token.token_hash = $1 AND principal.deleted_at IS NULL
		FOR UPDATE OF token, principal
	`, tokenHash).Scan(&tokenID, &principalID, &status, &expiresAt, &consumedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", unauthorized("verification token is invalid")
	}
	if err != nil {
		return "", fmt.Errorf("read verification token: %w", err)
	}
	now := time.Now().UTC()
	if consumedAt != nil || !expiresAt.After(now) || status == "disabled" || status == "locked" {
		return "", unauthorized("verification token is invalid")
	}
	if _, err := transaction.Exec(contextValue, `
		UPDATE identity.email_verification_tokens
		SET consumed_at = clock_timestamp()
		WHERE id = $1 AND consumed_at IS NULL
	`, tokenID); err != nil {
		return "", fmt.Errorf("consume verification token: %w", err)
	}
	if _, err := transaction.Exec(contextValue, `
		UPDATE identity.principals
		SET status = 'active', email_verified_at = COALESCE(email_verified_at, clock_timestamp()), version = version + 1
		WHERE id = $1 AND status = 'pending_verification'
	`, principalID); err != nil {
		return "", fmt.Errorf("activate verified principal: %w", err)
	}
	if err := repository.recordAuthEvent(contextValue, transaction, authEvent{
		PrincipalID: principalID, EventType: "identity.email_verified.v1", Outcome: "success",
	}); err != nil {
		return "", err
	}
	payload, err := json.Marshal(struct {
		PrincipalID string `json:"principal_id"`
	}{PrincipalID: principalID})
	if err != nil {
		return "", fmt.Errorf("encode email verified event: %w", err)
	}
	if err := repository.enqueue(contextValue, transaction, principalID, "identity.principal.email_verified.v1", payload); err != nil {
		return "", err
	}
	if err := transaction.Commit(contextValue); err != nil {
		return "", fmt.Errorf("commit email verification: %w", err)
	}
	return principalID, nil
}

// Authenticate verifies a password, applies account-lockout state, and creates
// one refresh-session family.  Login errors deliberately do not reveal which
// branch failed.
func (repository *Postgres) Authenticate(contextValue context.Context, command app.Login) (app.Session, error) {
	transaction, err := repository.pool.BeginTx(contextValue, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return app.Session{}, fmt.Errorf("begin login: %w", err)
	}
	defer func() { _ = transaction.Rollback(contextValue) }()

	principal, found, err := repository.lockPrincipalByEmail(contextValue, transaction, command.Email)
	if err != nil {
		return app.Session{}, err
	}
	if !found {
		consumePasswordWork(command.Password)
		if err := repository.recordAuthEvent(contextValue, transaction, authEvent{
			EventType: "identity.login.v1", Outcome: "failure", RequestID: command.RequestID,
			IPAddress: command.RequestIP, UserAgent: command.UserAgent,
			Metadata: map[string]string{"reason": "invalid_credentials"},
		}); err != nil {
			return app.Session{}, err
		}
		if err := transaction.Commit(contextValue); err != nil {
			return app.Session{}, fmt.Errorf("commit unknown-principal login audit: %w", err)
		}
		return app.Session{}, unauthorized("invalid email or password")
	}

	lockout, err := lockAccountLockout(contextValue, transaction, principal.ID)
	if err != nil {
		return app.Session{}, err
	}
	now := time.Now().UTC()
	if lockout.LockedUntil != nil && lockout.LockedUntil.After(now) {
		// Keep password work constant even when the account is locked, so a
		// timing observer cannot distinguish the account state.
		_ = domain.VerifyPassword(principal.PasswordHash, command.Password)
		if err := repository.recordAuthEvent(contextValue, transaction, authEvent{
			PrincipalID: principal.ID, TenantID: command.TenantID, EventType: "identity.login.v1", Outcome: "denied",
			RequestID: command.RequestID, IPAddress: command.RequestIP, UserAgent: command.UserAgent,
			Metadata: map[string]string{"reason": "account_locked"},
		}); err != nil {
			return app.Session{}, err
		}
		if err := transaction.Commit(contextValue); err != nil {
			return app.Session{}, fmt.Errorf("commit locked login audit: %w", err)
		}
		return app.Session{}, unauthorized("invalid email or password")
	}
	if lockout.LockedUntil != nil {
		// A completed lockout is cleared before evaluating the new password.
		// This makes a correct login unlock the account without needing a
		// scheduled state mutation, while preserving the audit trail.
		if _, err := transaction.Exec(contextValue, `
			UPDATE identity.account_lockouts
			SET failed_attempt_count = 0, locked_until = NULL, last_failed_at = NULL,
				version = version + 1
			WHERE principal_id = $1
		`, principal.ID); err != nil {
			return app.Session{}, fmt.Errorf("clear expired account lockout: %w", err)
		}
		if principal.Status == "locked" {
			if _, err := transaction.Exec(contextValue, `
				UPDATE identity.principals SET status = 'active', version = version + 1 WHERE id = $1
			`, principal.ID); err != nil {
				return app.Session{}, fmt.Errorf("clear expired principal lock: %w", err)
			}
			principal.Status = "active"
		}
		lockout = lockoutRecord{}
	}
	passwordOK := domain.VerifyPassword(principal.PasswordHash, command.Password)

	if !passwordOK || principal.Status != "active" {
		if err := repository.recordFailedLogin(contextValue, transaction, principal, command, lockout, now); err != nil {
			return app.Session{}, err
		}
		if err := transaction.Commit(contextValue); err != nil {
			return app.Session{}, fmt.Errorf("commit failed login: %w", err)
		}
		return app.Session{}, unauthorized("invalid email or password")
	}

	if _, err := transaction.Exec(contextValue, `
		INSERT INTO identity.account_lockouts (principal_id, failed_attempt_count, locked_until, last_failed_at)
		VALUES ($1, 0, NULL, NULL)
		ON CONFLICT (principal_id) DO UPDATE
		SET failed_attempt_count = 0, locked_until = NULL, last_failed_at = NULL, version = identity.account_lockouts.version + 1
	`, principal.ID); err != nil {
		return app.Session{}, fmt.Errorf("clear account lockout: %w", err)
	}
	if _, err := transaction.Exec(contextValue, `
		UPDATE identity.principals
		SET last_authenticated_at = clock_timestamp(), status = 'active', version = version + 1
		WHERE id = $1
	`, principal.ID); err != nil {
		return app.Session{}, fmt.Errorf("update authenticated principal: %w", err)
	}
	if err := lockPrincipalMFAState(contextValue, transaction, principal.ID); err != nil {
		return app.Session{}, err
	}
	hasMFA, err := hasActiveMFAFactor(contextValue, transaction, principal.ID)
	if err != nil {
		return app.Session{}, err
	}
	if hasMFA {
		if err := repository.recordAuthEvent(contextValue, transaction, authEvent{
			PrincipalID: principal.ID, TenantID: command.TenantID, EventType: "identity.mfa.challenge_required.v1", Outcome: "success",
			RequestID: command.RequestID, IPAddress: command.RequestIP, UserAgent: command.UserAgent,
		}); err != nil {
			return app.Session{}, err
		}
		if err := transaction.Commit(contextValue); err != nil {
			return app.Session{}, fmt.Errorf("commit password-verified MFA challenge: %w", err)
		}
		return app.Session{PrincipalID: principal.ID, TenantID: command.TenantID, AuthzRevision: 1, MFARequired: true}, nil
	}
	if err := createRefreshSession(contextValue, transaction, refreshSessionCommand{
		PrincipalID: principal.ID, TenantID: command.TenantID, FamilyID: command.RefreshFamilyID,
		TokenID: command.RefreshTokenID, TokenHash: command.RefreshTokenHash, ExpiresAt: command.RefreshExpiresAt,
		AccessTokenID: command.AccessTokenID, AccessExpiresAt: command.AccessExpiresAt, UserAgent: command.UserAgent,
	}); err != nil {
		return app.Session{}, err
	}
	if err := repository.recordAuthEvent(contextValue, transaction, authEvent{
		PrincipalID: principal.ID, TenantID: command.TenantID, EventType: "identity.login.v1", Outcome: "success",
		RequestID: command.RequestID, IPAddress: command.RequestIP, UserAgent: command.UserAgent,
	}); err != nil {
		return app.Session{}, err
	}
	payload, err := json.Marshal(struct {
		PrincipalID string `json:"principal_id"`
		FamilyID    string `json:"refresh_family_id"`
	}{PrincipalID: principal.ID, FamilyID: command.RefreshFamilyID})
	if err != nil {
		return app.Session{}, fmt.Errorf("encode login event: %w", err)
	}
	if err := repository.enqueue(contextValue, transaction, principal.ID, "identity.session.created.v1", payload); err != nil {
		return app.Session{}, err
	}
	if err := transaction.Commit(contextValue); err != nil {
		return app.Session{}, fmt.Errorf("commit login: %w", err)
	}
	return app.Session{PrincipalID: principal.ID, TenantID: command.TenantID, AuthzRevision: 1}, nil
}

// RotateRefresh consumes one bearer exactly once.  Any replay or invalid state
// revokes the whole family before returning the generic unauthorized result.
func (repository *Postgres) RotateRefresh(contextValue context.Context, command app.RefreshRotation) (app.Session, error) {
	transaction, err := repository.pool.BeginTx(contextValue, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return app.Session{}, fmt.Errorf("begin refresh rotation: %w", err)
	}
	defer func() { _ = transaction.Rollback(contextValue) }()

	refresh, found, err := lockRefreshToken(contextValue, transaction, command.CurrentTokenHash)
	if err != nil {
		return app.Session{}, err
	}
	if !found {
		if err := repository.recordAuthEvent(contextValue, transaction, authEvent{
			EventType: "identity.refresh.v1", Outcome: "failure", RequestID: command.RequestID,
			IPAddress: command.RequestIP, UserAgent: command.UserAgent,
			Metadata: map[string]string{"reason": "invalid_token"},
		}); err != nil {
			return app.Session{}, err
		}
		if err := transaction.Commit(contextValue); err != nil {
			return app.Session{}, fmt.Errorf("commit invalid refresh audit: %w", err)
		}
		return app.Session{}, unauthorized("refresh token is invalid")
	}
	now := time.Now().UTC()
	if refresh.UsedAt != nil || refresh.RevokedAt != nil || refresh.TokenExpiresAt.Before(now) ||
		refresh.FamilyState != "active" || !refresh.FamilyExpiresAt.After(now) || refresh.PrincipalStatus != "active" {
		if err := revokeFamily(contextValue, transaction, refresh.FamilyID, "refresh_replay_or_invalid"); err != nil {
			return app.Session{}, err
		}
		if err := repository.recordAuthEvent(contextValue, transaction, authEvent{
			PrincipalID: refresh.PrincipalID, TenantID: refresh.TenantID, EventType: "identity.refresh.v1", Outcome: "denied",
			RequestID: command.RequestID, IPAddress: command.RequestIP, UserAgent: command.UserAgent,
			Metadata: map[string]string{"reason": "replay_or_invalid"},
		}); err != nil {
			return app.Session{}, err
		}
		if err := transaction.Commit(contextValue); err != nil {
			return app.Session{}, fmt.Errorf("commit invalid refresh revocation: %w", err)
		}
		return app.Session{}, unauthorized("refresh token is invalid")
	}
	if _, err := transaction.Exec(contextValue, `
		UPDATE identity.refresh_tokens
		SET used_at = clock_timestamp(), replacement_token_id = $2
		WHERE id = $1 AND used_at IS NULL AND revoked_at IS NULL
	`, refresh.TokenID, command.NewTokenID); err != nil {
		return app.Session{}, fmt.Errorf("consume refresh token: %w", err)
	}
	if _, err := transaction.Exec(contextValue, `
		INSERT INTO identity.refresh_tokens (id, family_id, parent_token_id, token_hash, expires_at)
		VALUES ($1, $2, $3, $4, $5)
	`, command.NewTokenID, refresh.FamilyID, refresh.TokenID, command.NewTokenHash, command.NewExpiresAt.UTC()); err != nil {
		return app.Session{}, fmt.Errorf("create replacement refresh token: %w", err)
	}
	if _, err := transaction.Exec(contextValue, `
		INSERT INTO identity.access_token_sessions (token_id, family_id, principal_id, expires_at)
		VALUES ($1, $2, $3, $4)
	`, command.AccessTokenID, refresh.FamilyID, refresh.PrincipalID, command.AccessExpiresAt.UTC()); err != nil {
		return app.Session{}, fmt.Errorf("create refreshed access-token session: %w", err)
	}
	if _, err := transaction.Exec(contextValue, `
		UPDATE identity.refresh_session_families
		SET last_seen_at = clock_timestamp(), version = version + 1
		WHERE id = $1 AND state = 'active'
	`, refresh.FamilyID); err != nil {
		return app.Session{}, fmt.Errorf("update refresh session family: %w", err)
	}
	if err := repository.recordAuthEvent(contextValue, transaction, authEvent{
		PrincipalID: refresh.PrincipalID, TenantID: refresh.TenantID, EventType: "identity.refresh.v1", Outcome: "success",
		RequestID: command.RequestID, IPAddress: command.RequestIP, UserAgent: command.UserAgent,
	}); err != nil {
		return app.Session{}, err
	}
	if err := transaction.Commit(contextValue); err != nil {
		return app.Session{}, fmt.Errorf("commit refresh rotation: %w", err)
	}
	return app.Session{PrincipalID: refresh.PrincipalID, TenantID: refresh.TenantID, AuthzRevision: refresh.AuthzRevision}, nil
}

// RevokeRefresh revokes the enclosing family when a caller logs out.  Unknown
// tokens are deliberately treated as already logged out.
func (repository *Postgres) RevokeRefresh(contextValue context.Context, tokenHash []byte, reason string) error {
	transaction, err := repository.pool.BeginTx(contextValue, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return fmt.Errorf("begin refresh revocation: %w", err)
	}
	defer func() { _ = transaction.Rollback(contextValue) }()
	var familyID, principalID, tenantID string
	err = transaction.QueryRow(contextValue, `
		SELECT token.family_id, family.principal_id, COALESCE(family.tenant_id::text, '')
		FROM identity.refresh_tokens AS token
		JOIN identity.refresh_session_families AS family ON family.id = token.family_id
		WHERE token.token_hash = $1
		FOR UPDATE OF token, family
	`, tokenHash).Scan(&familyID, &principalID, &tenantID)
	if errors.Is(err, pgx.ErrNoRows) {
		return transaction.Commit(contextValue)
	}
	if err != nil {
		return fmt.Errorf("look up refresh family for logout: %w", err)
	}
	if err := revokeFamily(contextValue, transaction, familyID, reason); err != nil {
		return err
	}
	if err := repository.recordAuthEvent(contextValue, transaction, authEvent{
		PrincipalID: principalID, TenantID: tenantID, EventType: "identity.logout.v1", Outcome: "success",
	}); err != nil {
		return err
	}
	if err := transaction.Commit(contextValue); err != nil {
		return fmt.Errorf("commit logout: %w", err)
	}
	return nil
}

// RequestPasswordReset creates a reset token for a live principal without
// leaking whether the supplied email exists.
func (repository *Postgres) RequestPasswordReset(contextValue context.Context, command app.PasswordResetRequest) error {
	transaction, err := repository.pool.BeginTx(contextValue, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return fmt.Errorf("begin password reset request: %w", err)
	}
	defer func() { _ = transaction.Rollback(contextValue) }()
	var principalID string
	err = transaction.QueryRow(contextValue, `
		SELECT id
		FROM identity.principals
		WHERE lower(email) = lower($1) AND deleted_at IS NULL AND status = 'active'
		FOR UPDATE
	`, command.Email).Scan(&principalID)
	if errors.Is(err, pgx.ErrNoRows) {
		if err := repository.recordAuthEvent(contextValue, transaction, authEvent{
			EventType: "identity.password_reset_requested.v1", Outcome: "failure", RequestID: command.RequestID,
			IPAddress: command.RequestIP, Metadata: map[string]string{"reason": "unknown_or_inactive_principal"},
		}); err != nil {
			return err
		}
		if err := transaction.Commit(contextValue); err != nil {
			return fmt.Errorf("commit generic password reset request: %w", err)
		}
		return nil
	}
	if err != nil {
		return fmt.Errorf("look up password reset principal: %w", err)
	}
	if _, err := transaction.Exec(contextValue, `
		UPDATE identity.password_reset_tokens
		SET consumed_at = clock_timestamp()
		WHERE principal_id = $1 AND consumed_at IS NULL
	`, principalID); err != nil {
		return fmt.Errorf("retire prior reset tokens: %w", err)
	}
	if _, err := transaction.Exec(contextValue, `
		INSERT INTO identity.password_reset_tokens (id, principal_id, token_hash, expires_at, request_ip)
		VALUES ($1, $2, $3, $4, NULLIF($5, '')::inet)
	`, command.TokenID, principalID, command.TokenHash, command.ExpiresAt.UTC(), command.RequestIP); err != nil {
		return fmt.Errorf("store password reset token: %w", err)
	}
	if err := repository.recordAuthEvent(contextValue, transaction, authEvent{
		PrincipalID: principalID, EventType: "identity.password_reset_requested.v1", Outcome: "success",
		RequestID: command.RequestID, IPAddress: command.RequestIP,
	}); err != nil {
		return err
	}
	payload, err := json.Marshal(struct {
		PrincipalID string    `json:"principal_id"`
		Email       string    `json:"email"`
		TokenID     string    `json:"password_reset_token_id"`
		ExpiresAt   time.Time `json:"expires_at"`
	}{PrincipalID: principalID, Email: command.Email, TokenID: command.TokenID, ExpiresAt: command.ExpiresAt.UTC()})
	if err != nil {
		return fmt.Errorf("encode password reset requested event: %w", err)
	}
	if err := repository.enqueue(contextValue, transaction, principalID, "identity.password_reset.requested.v1", payload); err != nil {
		return err
	}
	if err := transaction.Commit(contextValue); err != nil {
		return fmt.Errorf("commit password reset request: %w", err)
	}
	return nil
}

// ResetPassword changes credentials, consumes the one-time token, clears any
// lockout, and revokes every active refresh family in one transaction.
func (repository *Postgres) ResetPassword(contextValue context.Context, command app.PasswordReset) error {
	transaction, err := repository.pool.BeginTx(contextValue, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return fmt.Errorf("begin password reset: %w", err)
	}
	defer func() { _ = transaction.Rollback(contextValue) }()
	var tokenID, principalID string
	var expiresAt time.Time
	var consumedAt *time.Time
	err = transaction.QueryRow(contextValue, `
		SELECT token.id, principal.id, token.expires_at, token.consumed_at
		FROM identity.password_reset_tokens AS token
		JOIN identity.principals AS principal ON principal.id = token.principal_id
		JOIN identity.password_credentials AS credential ON credential.principal_id = principal.id
		WHERE token.token_hash = $1
		  AND principal.deleted_at IS NULL
		  AND principal.status IN ('active', 'locked')
		FOR UPDATE OF token, principal, credential
	`, command.TokenHash).Scan(&tokenID, &principalID, &expiresAt, &consumedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return unauthorized("password reset token is invalid")
	}
	if err != nil {
		return fmt.Errorf("read password reset token: %w", err)
	}
	if consumedAt != nil || !expiresAt.After(time.Now().UTC()) {
		return unauthorized("password reset token is invalid")
	}
	if _, err := transaction.Exec(contextValue, `
		UPDATE identity.password_reset_tokens
		SET consumed_at = clock_timestamp()
		WHERE id = $1 AND consumed_at IS NULL
	`, tokenID); err != nil {
		return fmt.Errorf("consume password reset token: %w", err)
	}
	if _, err := transaction.Exec(contextValue, `
		UPDATE identity.password_credentials
		SET password_hash = $2, changed_at = clock_timestamp(), must_change = false, version = version + 1
		WHERE principal_id = $1
	`, principalID, command.PasswordHash); err != nil {
		return fmt.Errorf("update password credential: %w", err)
	}
	if _, err := transaction.Exec(contextValue, `
		UPDATE identity.principals
		SET status = 'active', version = version + 1
		WHERE id = $1
	`, principalID); err != nil {
		return fmt.Errorf("unlock password-reset principal: %w", err)
	}
	if _, err := transaction.Exec(contextValue, `
		INSERT INTO identity.account_lockouts (principal_id, failed_attempt_count, locked_until, last_failed_at)
		VALUES ($1, 0, NULL, NULL)
		ON CONFLICT (principal_id) DO UPDATE
		SET failed_attempt_count = 0, locked_until = NULL, last_failed_at = NULL, version = identity.account_lockouts.version + 1
	`, principalID); err != nil {
		return fmt.Errorf("clear password-reset lockout: %w", err)
	}
	if _, err := transaction.Exec(contextValue, `
		UPDATE identity.refresh_session_families
		SET state = 'revoked', revoked_at = clock_timestamp(), revoke_reason = 'password_reset', version = version + 1
		WHERE principal_id = $1 AND state = 'active'
	`, principalID); err != nil {
		return fmt.Errorf("revoke password-reset sessions: %w", err)
	}
	if _, err := transaction.Exec(contextValue, `
		UPDATE identity.access_token_sessions
		SET revoked_at = clock_timestamp(), revoke_reason = 'password_reset'
		WHERE principal_id = $1 AND revoked_at IS NULL
	`, principalID); err != nil {
		return fmt.Errorf("revoke password-reset access tokens: %w", err)
	}
	if err := repository.recordAuthEvent(contextValue, transaction, authEvent{
		PrincipalID: principalID, EventType: "identity.password_reset.v1", Outcome: "success",
		RequestID: command.RequestID, IPAddress: command.RequestIP,
	}); err != nil {
		return err
	}
	payload, err := json.Marshal(struct {
		PrincipalID string `json:"principal_id"`
	}{PrincipalID: principalID})
	if err != nil {
		return fmt.Errorf("encode password reset event: %w", err)
	}
	if err := repository.enqueue(contextValue, transaction, principalID, "identity.password.changed.v1", payload); err != nil {
		return err
	}
	if err := transaction.Commit(contextValue); err != nil {
		return fmt.Errorf("commit password reset: %w", err)
	}
	return nil
}

// ValidateAccessToken checks the durable token/session chain after the caller
// has already validated the Ed25519 JWS signature. It is deliberately a direct
// read rather than a cache so revocations are visible immediately.
func (repository *Postgres) ValidateAccessToken(contextValue context.Context, principalID, tokenID string) error {
	var valid bool
	err := repository.pool.QueryRow(contextValue, `
		SELECT EXISTS (
			SELECT 1
			FROM identity.access_token_sessions AS access_token
			JOIN identity.refresh_session_families AS family ON family.id = access_token.family_id
			JOIN identity.principals AS principal ON principal.id = access_token.principal_id
			WHERE access_token.token_id = $1
			  AND access_token.principal_id = $2
			  AND access_token.revoked_at IS NULL
			  AND access_token.expires_at > clock_timestamp()
			  AND family.state = 'active'
			  AND family.expires_at > clock_timestamp()
			  AND principal.status = 'active'
			  AND principal.deleted_at IS NULL
		)
	`, tokenID, principalID).Scan(&valid)
	if err != nil {
		return fmt.Errorf("validate access-token session: %w", err)
	}
	if !valid {
		return unauthorized("access token is invalid")
	}
	return nil
}

// CreateMFAChallenge records a short-lived one-time bearer hash after the
// password phase succeeded. It does not create a refresh family yet.
func (repository *Postgres) CreateMFAChallenge(contextValue context.Context, command app.MFAChallenge) error {
	transaction, err := repository.pool.BeginTx(contextValue, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return fmt.Errorf("begin MFA challenge creation: %w", err)
	}
	defer func() { _ = transaction.Rollback(contextValue) }()
	if err := lockPrincipalMFAState(contextValue, transaction, command.PrincipalID); err != nil {
		return err
	}
	hasMFA, err := hasActiveMFAFactor(contextValue, transaction, command.PrincipalID)
	if err != nil {
		return err
	}
	if !hasMFA {
		return unauthorized("MFA challenge is invalid")
	}
	if _, err := transaction.Exec(contextValue, `
		UPDATE identity.mfa_login_challenges
		SET consumed_at = clock_timestamp(), version = version + 1
		WHERE principal_id = $1 AND consumed_at IS NULL
	`, command.PrincipalID); err != nil {
		return fmt.Errorf("retire prior MFA challenges: %w", err)
	}
	if _, err := transaction.Exec(contextValue, `
		INSERT INTO identity.mfa_login_challenges (
			id, principal_id, tenant_id, token_hash, expires_at, request_ip, user_agent
		) VALUES ($1, $2, NULLIF($3, '')::uuid, $4, $5, NULLIF($6, '')::inet, NULLIF($7, ''))
	`, command.ID, command.PrincipalID, command.TenantID, command.TokenHash, command.ExpiresAt.UTC(),
		command.RequestIP, truncate(command.UserAgent, 512)); err != nil {
		return fmt.Errorf("store MFA login challenge: %w", err)
	}
	if err := repository.recordAuthEvent(contextValue, transaction, authEvent{
		PrincipalID: command.PrincipalID, TenantID: command.TenantID, EventType: "identity.mfa.challenge_created.v1", Outcome: "success",
		RequestID: command.RequestID, IPAddress: command.RequestIP, UserAgent: command.UserAgent,
	}); err != nil {
		return err
	}
	if err := transaction.Commit(contextValue); err != nil {
		return fmt.Errorf("commit MFA challenge creation: %w", err)
	}
	return nil
}

// CompleteMFAChallenge accepts one valid active TOTP or unused recovery code,
// consumes the challenge, and only then creates a durable session family.
func (repository *Postgres) CompleteMFAChallenge(contextValue context.Context, command app.MFAChallengeCompletion) (app.Session, error) {
	transaction, err := repository.pool.BeginTx(contextValue, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return app.Session{}, fmt.Errorf("begin MFA challenge completion: %w", err)
	}
	defer func() { _ = transaction.Rollback(contextValue) }()
	challenge, found, err := lockMFAChallenge(contextValue, transaction, command.ChallengeTokenHash)
	if err != nil {
		return app.Session{}, err
	}
	if !found || challenge.ConsumedAt != nil || !challenge.ExpiresAt.After(time.Now().UTC()) || challenge.FailureCount >= 5 {
		return app.Session{}, unauthorized("MFA challenge is invalid")
	}
	if err := lockPrincipalMFAState(contextValue, transaction, challenge.PrincipalID); err != nil {
		return app.Session{}, err
	}
	factors, err := lockActiveMFAFactors(contextValue, transaction, challenge.PrincipalID)
	if err != nil {
		return app.Session{}, err
	}
	if len(factors) == 0 {
		return app.Session{}, unauthorized("MFA challenge is invalid")
	}
	verifiedFactorID, verifiedByRecovery, err := repository.verifyMFAProof(contextValue, transaction, factors, command.Code)
	if err != nil {
		return app.Session{}, err
	}
	if verifiedFactorID == "" {
		if _, err := transaction.Exec(contextValue, `
			UPDATE identity.mfa_login_challenges
			SET failure_count = failure_count + 1,
				consumed_at = CASE WHEN failure_count + 1 >= 5 THEN clock_timestamp() ELSE consumed_at END,
				version = version + 1
			WHERE id = $1 AND consumed_at IS NULL
		`, challenge.ID); err != nil {
			return app.Session{}, fmt.Errorf("record MFA challenge failure: %w", err)
		}
		if err := repository.recordAuthEvent(contextValue, transaction, authEvent{
			PrincipalID: challenge.PrincipalID, TenantID: challenge.TenantID, EventType: "identity.mfa.challenge.v1", Outcome: "failure",
			RequestID: command.RequestID, IPAddress: command.RequestIP, UserAgent: command.UserAgent,
			Metadata: map[string]string{"reason": "invalid_proof"},
		}); err != nil {
			return app.Session{}, err
		}
		if err := transaction.Commit(contextValue); err != nil {
			return app.Session{}, fmt.Errorf("commit invalid MFA proof audit: %w", err)
		}
		return app.Session{}, unauthorized("MFA challenge is invalid")
	}
	if _, err := transaction.Exec(contextValue, `
		UPDATE identity.mfa_login_challenges
		SET consumed_at = clock_timestamp(), version = version + 1
		WHERE id = $1 AND consumed_at IS NULL
	`, challenge.ID); err != nil {
		return app.Session{}, fmt.Errorf("consume MFA challenge: %w", err)
	}
	if _, err := transaction.Exec(contextValue, `
		UPDATE identity.mfa_factors
		SET last_used_at = clock_timestamp(), version = version + 1
		WHERE id = $1
	`, verifiedFactorID); err != nil {
		return app.Session{}, fmt.Errorf("mark MFA factor used: %w", err)
	}
	if err := createRefreshSession(contextValue, transaction, refreshSessionCommand{
		PrincipalID: challenge.PrincipalID, TenantID: challenge.TenantID, FamilyID: command.RefreshFamilyID,
		TokenID: command.RefreshTokenID, TokenHash: command.RefreshTokenHash, ExpiresAt: command.RefreshExpiresAt,
		AccessTokenID: command.AccessTokenID, AccessExpiresAt: command.AccessExpiresAt, UserAgent: command.UserAgent,
	}); err != nil {
		return app.Session{}, err
	}
	metadata := map[string]string{"proof": "totp"}
	if verifiedByRecovery {
		metadata["proof"] = "recovery_code"
	}
	if err := repository.recordAuthEvent(contextValue, transaction, authEvent{
		PrincipalID: challenge.PrincipalID, TenantID: challenge.TenantID, EventType: "identity.mfa.challenge_completed.v1", Outcome: "success",
		RequestID: command.RequestID, IPAddress: command.RequestIP, UserAgent: command.UserAgent, Metadata: metadata,
	}); err != nil {
		return app.Session{}, err
	}
	payload, err := json.Marshal(struct {
		PrincipalID string `json:"principal_id"`
		FamilyID    string `json:"refresh_family_id"`
	}{PrincipalID: challenge.PrincipalID, FamilyID: command.RefreshFamilyID})
	if err != nil {
		return app.Session{}, fmt.Errorf("encode MFA session event: %w", err)
	}
	if err := repository.enqueue(contextValue, transaction, challenge.PrincipalID, "identity.session.created.v1", payload); err != nil {
		return app.Session{}, err
	}
	if err := transaction.Commit(contextValue); err != nil {
		return app.Session{}, fmt.Errorf("commit MFA challenge completion: %w", err)
	}
	return app.Session{PrincipalID: challenge.PrincipalID, TenantID: challenge.TenantID, AuthzRevision: 1}, nil
}

type mfaChallengeRecord struct {
	ID           string
	PrincipalID  string
	TenantID     string
	ExpiresAt    time.Time
	ConsumedAt   *time.Time
	FailureCount int
}

func lockMFAChallenge(contextValue context.Context, transaction pgx.Tx, tokenHash []byte) (mfaChallengeRecord, bool, error) {
	var challenge mfaChallengeRecord
	err := transaction.QueryRow(contextValue, `
		SELECT id, principal_id, COALESCE(tenant_id::text, ''), expires_at, consumed_at, failure_count
		FROM identity.mfa_login_challenges
		WHERE token_hash = $1
		FOR UPDATE
	`, tokenHash).Scan(
		&challenge.ID, &challenge.PrincipalID, &challenge.TenantID, &challenge.ExpiresAt, &challenge.ConsumedAt, &challenge.FailureCount,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return mfaChallengeRecord{}, false, nil
	}
	if err != nil {
		return mfaChallengeRecord{}, false, fmt.Errorf("lock MFA login challenge: %w", err)
	}
	return challenge, true, nil
}

func lockPrincipalMFAState(contextValue context.Context, transaction pgx.Tx, principalID string) error {
	if _, err := transaction.Exec(contextValue, `
		SELECT pg_advisory_xact_lock(hashtextextended($1, 814219))
	`, principalID); err != nil {
		return fmt.Errorf("lock principal MFA state: %w", err)
	}
	return nil
}

func hasActiveMFAFactor(contextValue context.Context, transaction pgx.Tx, principalID string) (bool, error) {
	var found bool
	if err := transaction.QueryRow(contextValue, `
		SELECT EXISTS (
			SELECT 1 FROM identity.mfa_factors
			WHERE principal_id = $1 AND factor_type = 'totp' AND status = 'active'
		)
	`, principalID).Scan(&found); err != nil {
		return false, fmt.Errorf("check active MFA factors: %w", err)
	}
	return found, nil
}

func lockActiveMFAFactors(contextValue context.Context, transaction pgx.Tx, principalID string) ([]mfaFactor, error) {
	rows, err := transaction.Query(contextValue, `
		SELECT id, status, secret_ciphertext, encrypted_data_key, key_reference
		FROM identity.mfa_factors
		WHERE principal_id = $1 AND factor_type = 'totp' AND status = 'active'
		ORDER BY id
		FOR UPDATE
	`, principalID)
	if err != nil {
		return nil, fmt.Errorf("lock active MFA factors: %w", err)
	}
	defer rows.Close()
	factors := make([]mfaFactor, 0, 1)
	for rows.Next() {
		var factor mfaFactor
		if err := rows.Scan(&factor.ID, &factor.Status, &factor.Ciphertext, &factor.EncryptedDataKey, &factor.KeyReference); err != nil {
			return nil, fmt.Errorf("scan active MFA factor: %w", err)
		}
		factors = append(factors, factor)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate active MFA factors: %w", err)
	}
	return factors, nil
}

func (repository *Postgres) verifyMFAProof(contextValue context.Context, transaction pgx.Tx, factors []mfaFactor, code string) (string, bool, error) {
	for _, factor := range factors {
		secret, err := repository.unprotectFactor(factor)
		if err != nil {
			return "", false, err
		}
		if domain.ValidateTOTP(secret, code, time.Now().UTC()) {
			return factor.ID, false, nil
		}
	}
	recoveryHash := domain.HashRecoveryCode(code)
	for _, factor := range factors {
		command, err := transaction.Exec(contextValue, `
			UPDATE identity.mfa_recovery_codes
			SET used_at = clock_timestamp()
			WHERE factor_id = $1 AND code_hash = $2 AND used_at IS NULL
		`, factor.ID, recoveryHash[:])
		if err != nil {
			return "", false, fmt.Errorf("consume MFA recovery code: %w", err)
		}
		if command.RowsAffected() == 1 {
			return factor.ID, true, nil
		}
	}
	return "", false, nil
}

type refreshSessionCommand struct {
	PrincipalID     string
	TenantID        string
	FamilyID        string
	TokenID         string
	TokenHash       []byte
	ExpiresAt       time.Time
	AccessTokenID   string
	AccessExpiresAt time.Time
	UserAgent       string
}

func createRefreshSession(contextValue context.Context, transaction pgx.Tx, command refreshSessionCommand) error {
	metadata, err := json.Marshal(map[string]string{"user_agent": truncate(command.UserAgent, 512)})
	if err != nil {
		return fmt.Errorf("encode refresh metadata: %w", err)
	}
	if _, err := transaction.Exec(contextValue, `
		INSERT INTO identity.refresh_session_families (
			id, principal_id, tenant_id, authz_revision, expires_at, metadata
		) VALUES ($1, $2, NULLIF($3, '')::uuid, 1, $4, $5::jsonb)
	`, command.FamilyID, command.PrincipalID, command.TenantID, command.ExpiresAt.UTC(), metadata); err != nil {
		return fmt.Errorf("create refresh session family: %w", err)
	}
	if _, err := transaction.Exec(contextValue, `
		INSERT INTO identity.refresh_tokens (id, family_id, token_hash, expires_at)
		VALUES ($1, $2, $3, $4)
	`, command.TokenID, command.FamilyID, command.TokenHash, command.ExpiresAt.UTC()); err != nil {
		return fmt.Errorf("create refresh token: %w", err)
	}
	if _, err := transaction.Exec(contextValue, `
		INSERT INTO identity.access_token_sessions (token_id, family_id, principal_id, expires_at)
		VALUES ($1, $2, $3, $4)
	`, command.AccessTokenID, command.FamilyID, command.PrincipalID, command.AccessExpiresAt.UTC()); err != nil {
		return fmt.Errorf("create access-token session: %w", err)
	}
	return nil
}

// BeginTOTP envelope-encrypts a pending factor before it reaches PostgreSQL.
// The plain seed remains only in the request process long enough for the
// authenticated caller to encode a QR URI.
func (repository *Postgres) BeginTOTP(contextValue context.Context, command app.TOTPEnrollment) error {
	masterKey, found := repository.mfaMasterKeys[repository.mfaKeyRef]
	if !found {
		return fmt.Errorf("configured current MFA key is unavailable")
	}
	protected, err := domain.ProtectMFASecret(masterKey, command.Secret)
	if err != nil {
		return fmt.Errorf("protect TOTP enrollment secret: %w", err)
	}
	secretHash := domain.HashToken(command.Secret)
	transaction, err := repository.pool.BeginTx(contextValue, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return fmt.Errorf("begin TOTP enrollment: %w", err)
	}
	defer func() { _ = transaction.Rollback(contextValue) }()
	if err := lockPrincipalMFAState(contextValue, transaction, command.PrincipalID); err != nil {
		return err
	}
	_, err = transaction.Exec(contextValue, `
		INSERT INTO identity.mfa_factors (
			id, principal_id, factor_type, label, secret_ciphertext,
			encrypted_data_key, key_reference, secret_sha256, status
		) VALUES ($1, $2, 'totp', $3, $4, $5, $6, $7, 'pending')
	`, command.FactorID, command.PrincipalID, command.Label, protected.Ciphertext,
		protected.EncryptedDataKey, repository.mfaKeyRef, secretHash[:])
	if err != nil {
		var postgresError *pgconn.PgError
		if errors.As(err, &postgresError) && postgresError.Code == "23505" {
			return apperrors.New(apperrors.CodeConflict, "an active factor with that label already exists")
		}
		return fmt.Errorf("store pending TOTP factor: %w", err)
	}
	if err := repository.recordAuthEvent(contextValue, transaction, authEvent{
		PrincipalID: command.PrincipalID, EventType: "identity.mfa.enrollment_started.v1", Outcome: "success",
	}); err != nil {
		return err
	}
	payload, err := json.Marshal(struct {
		PrincipalID string `json:"principal_id"`
		FactorID    string `json:"factor_id"`
	}{PrincipalID: command.PrincipalID, FactorID: command.FactorID})
	if err != nil {
		return fmt.Errorf("encode TOTP enrollment event: %w", err)
	}
	if err := repository.enqueue(contextValue, transaction, command.PrincipalID, "identity.mfa.enrollment_started.v1", payload); err != nil {
		return err
	}
	if err := transaction.Commit(contextValue); err != nil {
		return fmt.Errorf("commit TOTP enrollment: %w", err)
	}
	return nil
}

// ActivateTOTP verifies the pending seed, activates it, and writes hashed
// recovery codes in the same transaction. Raw recovery codes are returned
// once and are never written to an event, log, or database field.
func (repository *Postgres) ActivateTOTP(contextValue context.Context, command app.TOTPActivation) ([]string, error) {
	transaction, err := repository.pool.BeginTx(contextValue, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return nil, fmt.Errorf("begin TOTP activation: %w", err)
	}
	defer func() { _ = transaction.Rollback(contextValue) }()
	if err := lockPrincipalMFAState(contextValue, transaction, command.PrincipalID); err != nil {
		return nil, err
	}
	factor, found, err := lockMFAFactor(contextValue, transaction, command.PrincipalID, command.FactorID)
	if err != nil {
		return nil, err
	}
	if !found || factor.Status != "pending" {
		return nil, apperrors.New(apperrors.CodeNotFound, "pending TOTP factor was not found")
	}
	secret, err := repository.unprotectFactor(factor)
	if err != nil {
		return nil, err
	}
	if !domain.ValidateTOTP(secret, command.Code, time.Now().UTC()) {
		if err := repository.recordAuthEvent(contextValue, transaction, authEvent{
			PrincipalID: command.PrincipalID, EventType: "identity.mfa.activation.v1", Outcome: "failure",
			Metadata: map[string]string{"reason": "invalid_totp"},
		}); err != nil {
			return nil, err
		}
		if err := transaction.Commit(contextValue); err != nil {
			return nil, fmt.Errorf("commit invalid TOTP activation audit: %w", err)
		}
		return nil, unauthorized("TOTP code is invalid")
	}
	if _, err := transaction.Exec(contextValue, `
		UPDATE identity.mfa_factors
		SET status = 'active', verified_at = clock_timestamp(), last_used_at = clock_timestamp(), version = version + 1
		WHERE id = $1 AND status = 'pending'
	`, factor.ID); err != nil {
		return nil, fmt.Errorf("activate TOTP factor: %w", err)
	}
	recoveryCodes := make([]string, 0, 10)
	for index := 0; index < 10; index++ {
		code, codeErr := domain.NewRecoveryCode()
		if codeErr != nil {
			return nil, codeErr
		}
		hash := domain.HashRecoveryCode(code)
		if _, err := transaction.Exec(contextValue, `
			INSERT INTO identity.mfa_recovery_codes (factor_id, code_hash) VALUES ($1, $2)
		`, factor.ID, hash[:]); err != nil {
			return nil, fmt.Errorf("store MFA recovery code: %w", err)
		}
		recoveryCodes = append(recoveryCodes, code)
	}
	if err := repository.recordAuthEvent(contextValue, transaction, authEvent{
		PrincipalID: command.PrincipalID, EventType: "identity.mfa.enabled.v1", Outcome: "success",
	}); err != nil {
		return nil, err
	}
	payload, err := json.Marshal(struct {
		PrincipalID string `json:"principal_id"`
		FactorID    string `json:"factor_id"`
	}{PrincipalID: command.PrincipalID, FactorID: factor.ID})
	if err != nil {
		return nil, fmt.Errorf("encode MFA enabled event: %w", err)
	}
	if err := repository.enqueue(contextValue, transaction, command.PrincipalID, "identity.mfa.enabled.v1", payload); err != nil {
		return nil, err
	}
	if err := transaction.Commit(contextValue); err != nil {
		return nil, fmt.Errorf("commit TOTP activation: %w", err)
	}
	return recoveryCodes, nil
}

// DisableTOTP marks an active factor disabled after a current valid proof and
// revokes sessions so a security-sensitive factor change takes effect now.
func (repository *Postgres) DisableTOTP(contextValue context.Context, command app.TOTPDisable) error {
	transaction, err := repository.pool.BeginTx(contextValue, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return fmt.Errorf("begin TOTP disable: %w", err)
	}
	defer func() { _ = transaction.Rollback(contextValue) }()
	if err := lockPrincipalMFAState(contextValue, transaction, command.PrincipalID); err != nil {
		return err
	}
	factor, found, err := lockMFAFactor(contextValue, transaction, command.PrincipalID, command.FactorID)
	if err != nil {
		return err
	}
	if !found || factor.Status != "active" {
		return apperrors.New(apperrors.CodeNotFound, "active TOTP factor was not found")
	}
	secret, err := repository.unprotectFactor(factor)
	if err != nil {
		return err
	}
	if !domain.ValidateTOTP(secret, command.Code, time.Now().UTC()) {
		if err := repository.recordAuthEvent(contextValue, transaction, authEvent{
			PrincipalID: command.PrincipalID, EventType: "identity.mfa.disable.v1", Outcome: "failure",
			Metadata: map[string]string{"reason": "invalid_totp"},
		}); err != nil {
			return err
		}
		if err := transaction.Commit(contextValue); err != nil {
			return fmt.Errorf("commit invalid TOTP disable audit: %w", err)
		}
		return unauthorized("TOTP code is invalid")
	}
	if _, err := transaction.Exec(contextValue, `
		UPDATE identity.mfa_factors
		SET status = 'disabled', version = version + 1
		WHERE id = $1 AND status = 'active'
	`, factor.ID); err != nil {
		return fmt.Errorf("disable TOTP factor: %w", err)
	}
	if _, err := transaction.Exec(contextValue, `
		UPDATE identity.refresh_session_families
		SET state = 'revoked', revoked_at = clock_timestamp(), revoke_reason = 'mfa_factor_disabled', version = version + 1
		WHERE principal_id = $1 AND state = 'active'
	`, command.PrincipalID); err != nil {
		return fmt.Errorf("revoke sessions after MFA disable: %w", err)
	}
	if _, err := transaction.Exec(contextValue, `
		UPDATE identity.access_token_sessions
		SET revoked_at = clock_timestamp(), revoke_reason = 'mfa_factor_disabled'
		WHERE principal_id = $1 AND revoked_at IS NULL
	`, command.PrincipalID); err != nil {
		return fmt.Errorf("revoke access tokens after MFA disable: %w", err)
	}
	if err := repository.recordAuthEvent(contextValue, transaction, authEvent{
		PrincipalID: command.PrincipalID, EventType: "identity.mfa.disabled.v1", Outcome: "success",
	}); err != nil {
		return err
	}
	payload, err := json.Marshal(struct {
		PrincipalID string `json:"principal_id"`
		FactorID    string `json:"factor_id"`
	}{PrincipalID: command.PrincipalID, FactorID: factor.ID})
	if err != nil {
		return fmt.Errorf("encode MFA disabled event: %w", err)
	}
	if err := repository.enqueue(contextValue, transaction, command.PrincipalID, "identity.mfa.disabled.v1", payload); err != nil {
		return err
	}
	if err := transaction.Commit(contextValue); err != nil {
		return fmt.Errorf("commit TOTP disable: %w", err)
	}
	return nil
}

type mfaFactor struct {
	ID               string
	Status           string
	Ciphertext       []byte
	EncryptedDataKey []byte
	KeyReference     string
}

func lockMFAFactor(contextValue context.Context, transaction pgx.Tx, principalID, factorID string) (mfaFactor, bool, error) {
	var factor mfaFactor
	err := transaction.QueryRow(contextValue, `
		SELECT id, status, secret_ciphertext, encrypted_data_key, key_reference
		FROM identity.mfa_factors
		WHERE id = $1 AND principal_id = $2 AND factor_type = 'totp'
		FOR UPDATE
	`, factorID, principalID).Scan(
		&factor.ID, &factor.Status, &factor.Ciphertext, &factor.EncryptedDataKey, &factor.KeyReference,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return mfaFactor{}, false, nil
	}
	if err != nil {
		return mfaFactor{}, false, fmt.Errorf("lock TOTP factor: %w", err)
	}
	return factor, true, nil
}

func (repository *Postgres) unprotectFactor(factor mfaFactor) (string, error) {
	masterKey, found := repository.mfaMasterKeys[factor.KeyReference]
	if !found {
		return "", fmt.Errorf("MFA key reference %q is not available", factor.KeyReference)
	}
	secret, err := domain.UnprotectMFASecret(masterKey, domain.ProtectedSecret{
		Ciphertext: factor.Ciphertext, EncryptedDataKey: factor.EncryptedDataKey,
	})
	if err != nil {
		return "", fmt.Errorf("decrypt TOTP factor: %w", err)
	}
	return secret, nil
}

type principalRecord struct {
	ID           string
	Status       string
	PasswordHash string
}

func (repository *Postgres) lockPrincipalByEmail(contextValue context.Context, transaction pgx.Tx, email string) (principalRecord, bool, error) {
	var principal principalRecord
	err := transaction.QueryRow(contextValue, `
		SELECT principal.id, principal.status, credential.password_hash
		FROM identity.principals AS principal
		JOIN identity.password_credentials AS credential ON credential.principal_id = principal.id
		WHERE lower(principal.email) = lower($1) AND principal.deleted_at IS NULL
		FOR UPDATE OF principal, credential
	`, email).Scan(&principal.ID, &principal.Status, &principal.PasswordHash)
	if errors.Is(err, pgx.ErrNoRows) {
		return principalRecord{}, false, nil
	}
	if err != nil {
		return principalRecord{}, false, fmt.Errorf("lock login principal: %w", err)
	}
	return principal, true, nil
}

type lockoutRecord struct {
	FailedAttempts int
	LockedUntil    *time.Time
}

func lockAccountLockout(contextValue context.Context, transaction pgx.Tx, principalID string) (lockoutRecord, error) {
	var lockout lockoutRecord
	err := transaction.QueryRow(contextValue, `
		SELECT failed_attempt_count, locked_until
		FROM identity.account_lockouts
		WHERE principal_id = $1
		FOR UPDATE
	`, principalID).Scan(&lockout.FailedAttempts, &lockout.LockedUntil)
	if errors.Is(err, pgx.ErrNoRows) {
		return lockoutRecord{}, nil
	}
	if err != nil {
		return lockoutRecord{}, fmt.Errorf("lock account lockout: %w", err)
	}
	return lockout, nil
}

func (repository *Postgres) recordFailedLogin(
	contextValue context.Context,
	transaction pgx.Tx,
	principal principalRecord,
	command app.Login,
	lockout lockoutRecord,
	now time.Time,
) error {
	if principal.Status != "active" && principal.Status != "locked" {
		return repository.recordAuthEvent(contextValue, transaction, authEvent{
			PrincipalID: principal.ID, TenantID: command.TenantID, EventType: "identity.login.v1", Outcome: "denied",
			RequestID: command.RequestID, IPAddress: command.RequestIP, UserAgent: command.UserAgent,
			Metadata: map[string]string{"reason": "principal_not_active"},
		})
	}
	failedAttempts := lockout.FailedAttempts + 1
	var lockedUntil any
	status := principal.Status
	if failedAttempts >= command.LockoutThreshold {
		lockedUntil = now.Add(command.LockoutDuration)
		status = "locked"
	} else {
		lockedUntil = nil
	}
	if _, err := transaction.Exec(contextValue, `
		INSERT INTO identity.account_lockouts (principal_id, failed_attempt_count, locked_until, last_failed_at)
		VALUES ($1, $2, $3, clock_timestamp())
		ON CONFLICT (principal_id) DO UPDATE
		SET failed_attempt_count = EXCLUDED.failed_attempt_count,
			locked_until = EXCLUDED.locked_until,
			last_failed_at = EXCLUDED.last_failed_at,
			version = identity.account_lockouts.version + 1
	`, principal.ID, failedAttempts, lockedUntil); err != nil {
		return fmt.Errorf("record failed login lockout: %w", err)
	}
	if status == "locked" {
		if _, err := transaction.Exec(contextValue, `
			UPDATE identity.principals SET status = 'locked', version = version + 1 WHERE id = $1
		`, principal.ID); err != nil {
			return fmt.Errorf("lock principal: %w", err)
		}
	}
	reason := "invalid_credentials"
	if principal.Status != "active" {
		reason = "principal_not_active"
	}
	return repository.recordAuthEvent(contextValue, transaction, authEvent{
		PrincipalID: principal.ID, TenantID: command.TenantID, EventType: "identity.login.v1", Outcome: "failure",
		RequestID: command.RequestID, IPAddress: command.RequestIP, UserAgent: command.UserAgent,
		Metadata: map[string]string{"reason": reason},
	})
}

type refreshRecord struct {
	TokenID         string
	FamilyID        string
	PrincipalID     string
	TenantID        string
	AuthzRevision   int64
	FamilyState     string
	FamilyExpiresAt time.Time
	TokenExpiresAt  time.Time
	UsedAt          *time.Time
	RevokedAt       *time.Time
	PrincipalStatus string
}

func lockRefreshToken(contextValue context.Context, transaction pgx.Tx, tokenHash []byte) (refreshRecord, bool, error) {
	var refresh refreshRecord
	err := transaction.QueryRow(contextValue, `
		SELECT token.id, token.family_id, family.principal_id, COALESCE(family.tenant_id::text, ''),
		       family.authz_revision, family.state, family.expires_at, token.expires_at,
		       token.used_at, token.revoked_at, principal.status
		FROM identity.refresh_tokens AS token
		JOIN identity.refresh_session_families AS family ON family.id = token.family_id
		JOIN identity.principals AS principal ON principal.id = family.principal_id
		WHERE token.token_hash = $1
		FOR UPDATE OF token, family, principal
	`, tokenHash).Scan(
		&refresh.TokenID, &refresh.FamilyID, &refresh.PrincipalID, &refresh.TenantID,
		&refresh.AuthzRevision, &refresh.FamilyState, &refresh.FamilyExpiresAt, &refresh.TokenExpiresAt,
		&refresh.UsedAt, &refresh.RevokedAt, &refresh.PrincipalStatus,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return refreshRecord{}, false, nil
	}
	if err != nil {
		return refreshRecord{}, false, fmt.Errorf("lock refresh token: %w", err)
	}
	return refresh, true, nil
}

func revokeFamily(contextValue context.Context, transaction pgx.Tx, familyID, reason string) error {
	_, err := transaction.Exec(contextValue, `
		UPDATE identity.refresh_session_families
		SET state = 'revoked', revoked_at = COALESCE(revoked_at, clock_timestamp()),
			revoke_reason = COALESCE(revoke_reason, $2), version = version + 1
		WHERE id = $1 AND state <> 'expired'
	`, familyID, truncate(reason, 120))
	if err != nil {
		return fmt.Errorf("revoke refresh family: %w", err)
	}
	if _, err := transaction.Exec(contextValue, `
		UPDATE identity.access_token_sessions
		SET revoked_at = COALESCE(revoked_at, clock_timestamp()), revoke_reason = COALESCE(revoke_reason, $2)
		WHERE family_id = $1 AND revoked_at IS NULL
	`, familyID, truncate(reason, 120)); err != nil {
		return fmt.Errorf("revoke family access tokens: %w", err)
	}
	return nil
}

type authEvent struct {
	PrincipalID string
	TenantID    string
	EventType   string
	Outcome     string
	RequestID   string
	IPAddress   string
	UserAgent   string
	Metadata    map[string]string
}

func (repository *Postgres) recordAuthEvent(contextValue context.Context, transaction pgx.Tx, event authEvent) error {
	eventID, err := database.NewUUIDv7()
	if err != nil {
		return err
	}
	metadata := event.Metadata
	if metadata == nil {
		metadata = map[string]string{}
	}
	encodedMetadata, err := json.Marshal(metadata)
	if err != nil {
		return fmt.Errorf("encode authentication event metadata: %w", err)
	}
	_, err = transaction.Exec(contextValue, `
		INSERT INTO identity.auth_events (
			event_id, principal_id, tenant_id, event_type, outcome, request_id,
			ip_address, user_agent, metadata
		) VALUES (
			$1, NULLIF($2, '')::uuid, NULLIF($3, '')::uuid, $4, $5, NULLIF($6, '')::uuid,
			NULLIF($7, '')::inet, NULLIF($8, ''), $9::jsonb
		)
	`, eventID, event.PrincipalID, event.TenantID, event.EventType, event.Outcome, event.RequestID,
		event.IPAddress, truncate(event.UserAgent, 512), encodedMetadata)
	if err != nil {
		return fmt.Errorf("record authentication event: %w", err)
	}
	return nil
}

func (repository *Postgres) enqueue(contextValue context.Context, transaction pgx.Tx, aggregateID, eventType string, payload json.RawMessage) error {
	eventID, err := database.NewUUIDv7()
	if err != nil {
		return err
	}
	if err := repository.outbox.Enqueue(contextValue, transaction, database.OutboxEvent{
		EventID:       eventID,
		AggregateType: "identity.principal",
		AggregateID:   aggregateID,
		EventType:     eventType,
		SchemaVersion: 1,
		Payload:       payload,
		OccurredAt:    time.Now().UTC(),
	}); err != nil {
		return fmt.Errorf("enqueue identity outbox event: %w", err)
	}
	return nil
}

func mapRegistrationError(err error) error {
	var postgresError *pgconn.PgError
	if errors.As(err, &postgresError) && postgresError.Code == "23505" {
		return apperrors.New(apperrors.CodeConflict, "an account with that email already exists")
	}
	return fmt.Errorf("create principal: %w", err)
}

func unauthorized(message string) error {
	return apperrors.New(apperrors.CodeUnauthorized, message)
}

func truncate(value string, maximum int) string {
	value = strings.TrimSpace(value)
	if len(value) <= maximum {
		return value
	}
	return value[:maximum]
}

var (
	dummyPasswordHash     string
	dummyPasswordHashOnce sync.Once
)

// consumePasswordWork keeps unknown-email login timing in the same Argon2id
// cost class as a known-account password check.
func consumePasswordWork(password string) {
	dummyPasswordHashOnce.Do(func() {
		// This constant is not an account credential and exists only to provide
		// a valid Argon2id input for anti-enumeration work.
		dummyPasswordHash, _ = domain.HashPassword("AetherCodeDummy2026")
	})
	_ = domain.VerifyPassword(dummyPasswordHash, password)
}

// GetPrincipal retrieves an active (non-deleted) principal by ID.
// Soft-deleted principals are filtered by the WHERE clause.
func (repository *Postgres) GetPrincipal(contextValue context.Context, principalID string) (*app.Principal, error) {
	var principal app.Principal
	var deletedBy, deletionReason *string
	err := repository.pool.QueryRow(contextValue, `
		SELECT id, email, display_name, status, email_verified_at, last_authenticated_at,
		       version, created_at, updated_at, deleted_at, deleted_by::text, deletion_reason
		FROM identity.principals
		WHERE id = $1 AND deleted_at IS NULL
	`, principalID).Scan(
		&principal.ID, &principal.Email, &principal.DisplayName, &principal.Status,
		&principal.EmailVerifiedAt, &principal.LastAuthenticatedAt, &principal.Version,
		&principal.CreatedAt, &principal.UpdatedAt, &principal.DeletedAt, &deletedBy, &deletionReason,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, apperrors.New(apperrors.CodeNotFound, "principal not found")
	}
	if err != nil {
		return nil, fmt.Errorf("query principal: %w", err)
	}
	principal.DeletedBy = deletedBy
	principal.DeletionReason = deletionReason
	return &principal, nil
}

// GetPrincipalIncludeDeleted retrieves a principal including soft-deleted records.
// Requires authorization check before calling (SuperAdmin or role with archive access).
func (repository *Postgres) GetPrincipalIncludeDeleted(contextValue context.Context, principalID string) (*app.Principal, error) {
	var principal app.Principal
	var deletedBy, deletionReason *string
	err := repository.pool.QueryRow(contextValue, `
		SELECT id, email, display_name, status, email_verified_at, last_authenticated_at,
		       version, created_at, updated_at, deleted_at, deleted_by::text, deletion_reason
		FROM identity.principals
		WHERE id = $1
	`, principalID).Scan(
		&principal.ID, &principal.Email, &principal.DisplayName, &principal.Status,
		&principal.EmailVerifiedAt, &principal.LastAuthenticatedAt, &principal.Version,
		&principal.CreatedAt, &principal.UpdatedAt, &principal.DeletedAt, &deletedBy, &deletionReason,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, apperrors.New(apperrors.CodeNotFound, "principal not found")
	}
	if err != nil {
		return nil, fmt.Errorf("query principal: %w", err)
	}
	principal.DeletedBy = deletedBy
	principal.DeletionReason = deletionReason
	return &principal, nil
}

// SoftDeletePrincipal marks a principal as deleted with audit trail.
// Uses shared database.SoftDelete function.
func (repository *Postgres) SoftDeletePrincipal(contextValue context.Context, command app.DeletePrincipal) error {
	transaction, err := repository.pool.BeginTx(contextValue, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return fmt.Errorf("begin principal soft delete: %w", err)
	}
	defer func() { _ = transaction.Rollback(contextValue) }()

	// Parse UUIDs
	principalID, err := parseUUID(command.ID)
	if err != nil {
		return fmt.Errorf("parse principal ID: %w", err)
	}
	actorID, err := parseUUID(command.ActorID)
	if err != nil {
		return fmt.Errorf("parse actor ID: %w", err)
	}

	// Perform soft delete
	now := time.Now().UTC()
	result, err := transaction.Exec(contextValue, `
		UPDATE identity.principals
		SET deleted_at = $1, deleted_by = $2, deletion_reason = $3, updated_at = $1
		WHERE id = $4 AND deleted_at IS NULL
	`, now, actorID, command.Reason, principalID)
	if err != nil {
		return fmt.Errorf("soft delete principal: %w", err)
	}
	if result.RowsAffected() == 0 {
		return apperrors.New(apperrors.CodeNotFound, "principal not found or already deleted")
	}

	// Record auth event
	if err := repository.recordAuthEvent(contextValue, transaction, authEvent{
		PrincipalID: command.ID,
		EventType:   "identity.principal.soft_deleted.v1",
		Outcome:     "success",
		Metadata:    map[string]string{"deleted_by": command.ActorID, "reason": command.Reason},
	}); err != nil {
		return err
	}

	// Enqueue outbox event
	payload, err := json.Marshal(struct {
		PrincipalID string `json:"principal_id"`
		DeletedBy   string `json:"deleted_by"`
		Reason      string `json:"reason"`
	}{
		PrincipalID: command.ID,
		DeletedBy:   command.ActorID,
		Reason:      command.Reason,
	})
	if err != nil {
		return fmt.Errorf("encode principal deleted event: %w", err)
	}
	if err := repository.enqueue(contextValue, transaction, command.ID, "identity.principal.soft_deleted.v1", payload); err != nil {
		return err
	}

	return transaction.Commit(contextValue)
}

// HardDeletePrincipal permanently removes a principal via security-definer function.
// Only SuperAdmin can execute this (enforced via RLS and function).
func (repository *Postgres) HardDeletePrincipal(contextValue context.Context, command app.DeletePrincipal) error {
	transaction, err := repository.pool.BeginTx(contextValue, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return fmt.Errorf("begin principal hard delete: %w", err)
	}
	defer func() { _ = transaction.Rollback(contextValue) }()

	// Parse UUIDs
	principalID, err := parseUUID(command.ID)
	if err != nil {
		return fmt.Errorf("parse principal ID: %w", err)
	}
	actorID, err := parseUUID(command.ActorID)
	if err != nil {
		return fmt.Errorf("parse actor ID: %w", err)
	}

	// Call security-definer function that checks SuperAdmin role via RLS
	var success bool
	err = transaction.QueryRow(contextValue, `
		SELECT app.hard_delete($1, $2, $3, $4)
	`, "identity.principals", principalID, actorID, command.Reason).Scan(&success)
	if err != nil {
		return fmt.Errorf("hard delete principal: %w", err)
	}
	if !success {
		return apperrors.New(apperrors.CodeUnauthorized, "hard delete denied: insufficient permissions or record not found")
	}

	// Record auth event
	if err := repository.recordAuthEvent(contextValue, transaction, authEvent{
		PrincipalID: command.ID,
		EventType:   "identity.principal.hard_deleted.v1",
		Outcome:     "success",
		Metadata:    map[string]string{"deleted_by": command.ActorID, "reason": command.Reason},
	}); err != nil {
		return err
	}

	return transaction.Commit(contextValue)
}

func parseUUID(value string) (string, error) {
	if len(value) != 36 {
		return "", fmt.Errorf("invalid UUID format")
	}
	return strings.ToLower(value), nil
}
