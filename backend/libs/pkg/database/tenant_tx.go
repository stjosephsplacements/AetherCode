package database

import (
	"context"
	"fmt"
	"time"

	centralauthz "github.com/aethercode/aethercode/libs/pkg/authz"
	"github.com/jackc/pgx/v5"
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
		return fmt.Errorf("set signed transaction authorization context: %w", err)
	}
	if err := fn(transaction); err != nil {
		return err
	}
	if err := transaction.Commit(contextValue); err != nil {
		return fmt.Errorf("commit transaction: %w", err)
	}
	return nil
}
