package database

import (
	"context"
	"errors"
	"fmt"
	"time"

	centralauthz "github.com/aethercode/aethercode/libs/pkg/authz"
	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// WithTenantTx begins a protected transaction only after the central User
// service has issued a fresh signed allow decision. It never sets actor,
// tenant, or revision GUCs directly: the database's security-definer
// authz.set_context routine verifies the HMAC, exact projection revision, and
// backend/transaction binding before it sets the opaque local context ID used
// by FORCE RLS policies.
func WithTenantTx(
	contextValue context.Context,
	pool *pgxpool.Pool,
	capability centralauthz.Capability,
	fn func(pgx.Tx) error,
) error {
	if err := capability.ValidateAt(time.Now()); err != nil {
		return err
	}
	transaction, err := pool.BeginTx(contextValue, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer func() { _ = transaction.Rollback(contextValue) }()

	var tenantID any
	if capability.TenantID != "" {
		tenantID = capability.TenantID
	}
	if _, err := transaction.Exec(contextValue, `
		SELECT authz.set_context($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
	`, capability.ActorID, tenantID, capability.AuthzRevision,
		capability.Decision, capability.CapabilityID, capability.Action, capability.Resource,
		capability.IssuedAt.UTC(), capability.ExpiresAt.UTC(), capability.KeyID, capability.Signature); err != nil {
		return contextError(err)
	}
	if err := fn(transaction); err != nil {
		return err
	}
	if err := transaction.Commit(contextValue); err != nil {
		return fmt.Errorf("commit transaction: %w", err)
	}
	return nil
}

// projectionLagMessage is raised by every service's authz.set_context when its
// local copy of a principal's grants has not caught up with the revision the
// central decision used, for example seconds after a role is granted.
const projectionLagMessage = "local authorization projection is not current"

// contextError reports projection lag as a retryable unavailable error; any
// other set_context failure (bad signature, replay, expiry) stays internal.
func contextError(err error) error {
	var postgresError *pgconn.PgError
	if errors.As(err, &postgresError) && postgresError.Code == "28000" && postgresError.Message == projectionLagMessage {
		return &apperrors.Error{Code: apperrors.CodeUnavailable, Message: "permissions are still being updated; retry in a few seconds", Cause: err}
	}
	return fmt.Errorf("set signed transaction authorization context: %w", err)
}
