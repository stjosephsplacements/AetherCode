// Package projection consumes Tenant domain events into User's local opaque-ID
// validation projection. It never reads Tenant's database directly.
package projection

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/aethercode/aethercode/libs/pkg/messaging"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

const tenantProjectionConsumer = "user.tenant-projection.v1"

type TenantProjection struct {
	pool *pgxpool.Pool
}

func NewTenantProjection(pool *pgxpool.Pool) (*TenantProjection, error) {
	if pool == nil {
		return nil, fmt.Errorf("User projection database pool is required")
	}
	return &TenantProjection{pool: pool}, nil
}

func (projection *TenantProjection) Ping(contextValue context.Context) error {
	if projection == nil || projection.pool == nil {
		return fmt.Errorf("User tenant projection is not initialized")
	}
	if err := projection.pool.Ping(contextValue); err != nil {
		return fmt.Errorf("ping User projection database: %w", err)
	}
	return nil
}

// Apply is idempotent across broker redelivery and process failover. The inbox
// record, materialized projection, and processed marker commit together.
func (projection *TenantProjection) Apply(contextValue context.Context, event messaging.Event) error {
	if projection == nil || projection.pool == nil {
		return fmt.Errorf("User tenant projection is not initialized")
	}
	if event.SchemaVersion != 1 {
		return messaging.Permanent(fmt.Errorf("unsupported Tenant event schema version %d", event.SchemaVersion))
	}
	if event.Type != "tenant.department.created.v1" &&
		event.Type != "tenant.placement_department.created.v1" &&
		event.Type != "tenant.batch.created.v1" {
		return messaging.Permanent(fmt.Errorf("unsupported Tenant event type %q", event.Type))
	}
	if !validUUID(event.ID) {
		return messaging.Permanent(fmt.Errorf("Tenant event ID is not a UUID"))
	}
	transaction, err := projection.pool.BeginTx(contextValue, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("begin Tenant projection transaction: %w", err)
	}
	defer func() { _ = transaction.Rollback(contextValue) }()

	payloadHash := sha256.Sum256(event.Payload)
	var claimedID string
	err = transaction.QueryRow(contextValue, `
		INSERT INTO users.tenant_projection_inbox_messages (
			event_id, payload_sha256, occurred_at
		) VALUES ($1, $2, $3)
		ON CONFLICT (event_id) DO NOTHING
		RETURNING event_id::text
	`, event.ID, payloadHash[:], event.OccurredAt.UTC()).Scan(&claimedID)
	if errors.Is(err, pgx.ErrNoRows) {
		if commitErr := transaction.Commit(contextValue); commitErr != nil {
			return fmt.Errorf("commit duplicate Tenant projection event: %w", commitErr)
		}
		return nil
	}
	if err != nil {
		return fmt.Errorf("claim Tenant projection event: %w", err)
	}

	if err := projection.applyEvent(contextValue, transaction, event); err != nil {
		return err
	}
	if _, err := transaction.Exec(contextValue, `
		UPDATE users.tenant_projection_inbox_messages
		SET processed_at = clock_timestamp(), last_error = NULL
		WHERE event_id = $1
	`, claimedID); err != nil {
		return fmt.Errorf("complete Tenant projection inbox event: %w", err)
	}
	if err := transaction.Commit(contextValue); err != nil {
		return fmt.Errorf("commit Tenant projection event: %w", err)
	}
	return nil
}

func (projection *TenantProjection) applyEvent(contextValue context.Context, transaction pgx.Tx, event messaging.Event) error {
	switch event.Type {
	case "tenant.department.created.v1":
		var payload struct {
			DepartmentID   string `json:"department_id"`
			TenantID       string `json:"tenant_id"`
			DepartmentType string `json:"department_type"`
		}
		if err := json.Unmarshal(event.Payload, &payload); err != nil {
			return messaging.Permanent(fmt.Errorf("decode college department event: %w", err))
		}
		if !validUUID(payload.DepartmentID) || !validUUID(payload.TenantID) || payload.DepartmentType != "college" {
			return messaging.Permanent(fmt.Errorf("college department event has invalid ownership fields"))
		}
		_, err := transaction.Exec(contextValue, `
			INSERT INTO users.tenant_department_projections (
				department_id, tenant_id, placement_organization_id, department_type,
				status, source_event_id, source_occurred_at
			) VALUES ($1, $2, NULL, 'college', 'active', $3, $4)
			ON CONFLICT (department_id) DO UPDATE
			SET tenant_id = EXCLUDED.tenant_id,
				placement_organization_id = NULL,
				department_type = EXCLUDED.department_type,
				status = EXCLUDED.status,
				source_event_id = EXCLUDED.source_event_id,
				source_occurred_at = EXCLUDED.source_occurred_at,
				projected_at = clock_timestamp()
			WHERE users.tenant_department_projections.source_occurred_at <= EXCLUDED.source_occurred_at
		`, payload.DepartmentID, payload.TenantID, event.ID, event.OccurredAt.UTC())
		return projectionWriteError(err, "apply college department projection")
	case "tenant.placement_department.created.v1":
		var payload struct {
			DepartmentID            string `json:"department_id"`
			PlacementOrganizationID string `json:"placement_organization_id"`
			DepartmentType          string `json:"department_type"`
		}
		if err := json.Unmarshal(event.Payload, &payload); err != nil {
			return messaging.Permanent(fmt.Errorf("decode placement department event: %w", err))
		}
		if !validUUID(payload.DepartmentID) || !validUUID(payload.PlacementOrganizationID) || payload.DepartmentType != "placement" {
			return messaging.Permanent(fmt.Errorf("placement department event has invalid ownership fields"))
		}
		_, err := transaction.Exec(contextValue, `
			INSERT INTO users.tenant_department_projections (
				department_id, tenant_id, placement_organization_id, department_type,
				status, source_event_id, source_occurred_at
			) VALUES ($1, NULL, $2, 'placement', 'active', $3, $4)
			ON CONFLICT (department_id) DO UPDATE
			SET tenant_id = NULL,
				placement_organization_id = EXCLUDED.placement_organization_id,
				department_type = EXCLUDED.department_type,
				status = EXCLUDED.status,
				source_event_id = EXCLUDED.source_event_id,
				source_occurred_at = EXCLUDED.source_occurred_at,
				projected_at = clock_timestamp()
			WHERE users.tenant_department_projections.source_occurred_at <= EXCLUDED.source_occurred_at
		`, payload.DepartmentID, payload.PlacementOrganizationID, event.ID, event.OccurredAt.UTC())
		return projectionWriteError(err, "apply placement department projection")
	case "tenant.batch.created.v1":
		var payload struct {
			BatchID      string `json:"batch_id"`
			TenantID     string `json:"tenant_id"`
			DepartmentID string `json:"department_id"`
		}
		if err := json.Unmarshal(event.Payload, &payload); err != nil {
			return messaging.Permanent(fmt.Errorf("decode batch event: %w", err))
		}
		if !validUUID(payload.BatchID) || !validUUID(payload.TenantID) || !validUUID(payload.DepartmentID) {
			return messaging.Permanent(fmt.Errorf("batch event has invalid ownership fields"))
		}
		_, err := transaction.Exec(contextValue, `
			INSERT INTO users.tenant_batch_projections (
				batch_id, tenant_id, department_id, status, source_event_id, source_occurred_at
			) VALUES ($1, $2, $3, 'active', $4, $5)
			ON CONFLICT (batch_id) DO UPDATE
			SET tenant_id = EXCLUDED.tenant_id,
				department_id = EXCLUDED.department_id,
				status = EXCLUDED.status,
				source_event_id = EXCLUDED.source_event_id,
				source_occurred_at = EXCLUDED.source_occurred_at,
				projected_at = clock_timestamp()
			WHERE users.tenant_batch_projections.source_occurred_at <= EXCLUDED.source_occurred_at
		`, payload.BatchID, payload.TenantID, payload.DepartmentID, event.ID, event.OccurredAt.UTC())
		return projectionWriteError(err, "apply batch projection")
	default:
		return messaging.Permanent(fmt.Errorf("unsupported Tenant event type %q", event.Type))
	}
}

func projectionWriteError(err error, operation string) error {
	if err == nil {
		return nil
	}
	var postgresError *pgconn.PgError
	if errors.As(err, &postgresError) && (postgresError.Code == "22P02" || postgresError.Code == "23514") {
		return messaging.Permanent(fmt.Errorf("%s: %w", operation, err))
	}
	return fmt.Errorf("%s: %w", operation, err)
}

func validUUID(value string) bool {
	parsed, err := uuid.Parse(strings.TrimSpace(value))
	return err == nil && strings.EqualFold(parsed.String(), strings.TrimSpace(value))
}
