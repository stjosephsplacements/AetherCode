// Package projection contains narrow, event-fed materializers owned by the
// User service. Authorization-resync requests are handled here rather than by
// request-serving code so the app role never gains canonical policy-table
// access.
package projection

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"

	"github.com/aethercode/aethercode/libs/pkg/authzprojection"
	"github.com/aethercode/aethercode/libs/pkg/messaging"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// AuthorizationResyncRequestProjection accepts target-specific bootstrap
// requests and invokes the canonical, rate-limited User database function.
// The function is SECURITY DEFINER and is the only privilege this worker gets
// over the canonical authorization batch source.
type AuthorizationResyncRequestProjection struct {
	pool *pgxpool.Pool
}

func NewAuthorizationResyncRequestProjection(pool *pgxpool.Pool) (*AuthorizationResyncRequestProjection, error) {
	if pool == nil {
		return nil, fmt.Errorf("authorization resync request projection database pool is required")
	}
	return &AuthorizationResyncRequestProjection{pool: pool}, nil
}

func (projection *AuthorizationResyncRequestProjection) Ping(contextValue context.Context) error {
	if projection == nil || projection.pool == nil {
		return fmt.Errorf("authorization resync request projection is not initialized")
	}
	if err := projection.pool.Ping(contextValue); err != nil {
		return fmt.Errorf("ping authorization resync request projection: %w", err)
	}
	return nil
}

// Apply creates at most one complete batch for a request/resync UUID pair.
// A rate-limited request remains retryable so its durable JetStream message is
// retried after the per-target admission window instead of being lost.
func (projection *AuthorizationResyncRequestProjection) Apply(contextValue context.Context, event messaging.Event) error {
	if projection == nil || projection.pool == nil {
		return fmt.Errorf("authorization resync request projection is not initialized")
	}
	request, err := authzprojection.ParseResyncRequest(event)
	if err != nil {
		return messaging.Permanent(err)
	}
	payloadHash := sha256.Sum256(event.Payload)
	var accepted bool
	err = projection.pool.QueryRow(contextValue, `
		SELECT users.process_authorization_resync_request(
			$1::uuid, $2, $3, $4::uuid, $5, $6
		)
	`, event.ID, payloadHash[:], event.OccurredAt.UTC(), request.ResyncID, request.TargetService, request.Reason).Scan(&accepted)
	if err != nil {
		return mapAuthorizationResyncRequestError(err)
	}
	if !accepted {
		return fmt.Errorf("canonical authorization resync request was not accepted")
	}
	return nil
}

func mapAuthorizationResyncRequestError(err error) error {
	var postgresError *pgconn.PgError
	if errors.As(err, &postgresError) {
		if postgresError.Code == "P0001" && postgresError.Message == "authorization resync request rate limited" {
			return fmt.Errorf("authorization resync request is rate limited: %w", err)
		}
		if postgresError.Code == "P0001" || postgresError.Code == "22023" || postgresError.Code == "23505" || postgresError.Code == "23514" {
			return messaging.Permanent(fmt.Errorf("invalid authorization resync request: %w", err))
		}
	}
	return fmt.Errorf("process authorization resync request: %w", err)
}
