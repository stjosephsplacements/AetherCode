// Package repo implements SEB persistence using the least-privileged
// application role. Multi-table security transitions are database procedures
// that re-check the transaction's signed authorization context.
package repo

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/aethercode/aethercode/libs/pkg/database"
	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
	"github.com/aethercode/aethercode/libs/pkg/messaging"
	"github.com/aethercode/aethercode/services/seb/internal/app"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Postgres struct {
	pool   *pgxpool.Pool
	outbox *messaging.OutboxStore
}

func NewPostgres(pool *pgxpool.Pool) (*Postgres, error) {
	if pool == nil {
		return nil, fmt.Errorf("SEB database pool is required")
	}
	outbox, err := messaging.NewOutboxStore(pool, "app.outbox_events")
	if err != nil {
		return nil, err
	}
	return &Postgres{pool: pool, outbox: outbox}, nil
}

func (repository *Postgres) Ping(ctx context.Context) error {
	if repository == nil || repository.pool == nil {
		return fmt.Errorf("SEB database repository is not initialized")
	}
	if err := repository.pool.Ping(ctx); err != nil {
		return fmt.Errorf("ping SEB database: %w", err)
	}
	return nil
}

func (repository *Postgres) CreateConfiguration(ctx context.Context, transaction pgx.Tx, command app.CreateConfiguration) (app.Configuration, error) {
	var configuration app.Configuration
	err := transaction.QueryRow(ctx, `
		INSERT INTO seb.configurations (
			id, tenant_id, exam_id, exam_version_id, configuration_version,
			config_object_key, config_checksum, encryption_key_reference,
			config_key_hash, browser_exam_key_hash, created_by
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULLIF($10, '')::char(64), $11)
		RETURNING id::text, tenant_id::text, exam_id::text, exam_version_id::text,
			configuration_version, config_object_key, config_checksum,
			encryption_key_reference, lifecycle_state, created_by::text, created_at
	`, command.ID, command.TenantID, command.ExamID, command.ExamVersionID,
		command.ConfigurationVersion, command.ConfigObjectKey, command.ConfigChecksum,
		command.EncryptionKeyRef, command.ConfigKeyHash, command.BrowserExamKeyHash,
		command.CreatedBy).Scan(
		&configuration.ID, &configuration.TenantID, &configuration.ExamID,
		&configuration.ExamVersionID, &configuration.ConfigurationVersion,
		&configuration.ConfigObjectKey, &configuration.ConfigChecksum,
		&configuration.EncryptionKeyRef, &configuration.LifecycleState,
		&configuration.CreatedBy, &configuration.CreatedAt,
	)
	if err != nil {
		return app.Configuration{}, mapWriteError(err, "SEB configuration already exists or conflicts with an active configuration")
	}
	payload, err := json.Marshal(struct {
		ConfigurationID      string `json:"configuration_id"`
		TenantID             string `json:"tenant_id"`
		ExamID               string `json:"exam_id"`
		ExamVersionID        string `json:"exam_version_id"`
		ConfigurationVersion int    `json:"configuration_version"`
	}{configuration.ID, configuration.TenantID, configuration.ExamID, configuration.ExamVersionID, configuration.ConfigurationVersion})
	if err != nil {
		return app.Configuration{}, fmt.Errorf("encode SEB configuration event: %w", err)
	}
	if err := repository.enqueue(ctx, transaction, command.EventID, "seb_configuration", configuration.ID, configuration.TenantID, "seb.configuration.created.v1", payload); err != nil {
		return app.Configuration{}, err
	}
	return configuration, nil
}

func (repository *Postgres) GetConfiguration(ctx context.Context, transaction pgx.Tx, tenantID, configurationID string) (app.Configuration, error) {
	var configuration app.Configuration
	err := transaction.QueryRow(ctx, `
		SELECT id::text, tenant_id::text, exam_id::text, exam_version_id::text,
			configuration_version, config_object_key, config_checksum,
			encryption_key_reference, lifecycle_state, created_by::text, created_at
		FROM seb.configurations
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
	`, tenantID, configurationID).Scan(
		&configuration.ID, &configuration.TenantID, &configuration.ExamID,
		&configuration.ExamVersionID, &configuration.ConfigurationVersion,
		&configuration.ConfigObjectKey, &configuration.ConfigChecksum,
		&configuration.EncryptionKeyRef, &configuration.LifecycleState,
		&configuration.CreatedBy, &configuration.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return app.Configuration{}, apperrors.New(apperrors.CodeNotFound, "SEB configuration was not found")
	}
	if err != nil {
		return app.Configuration{}, fmt.Errorf("read SEB configuration: %w", err)
	}
	return configuration, nil
}

func (repository *Postgres) RotateConfiguration(ctx context.Context, transaction pgx.Tx, command app.RotateConfiguration) (app.Configuration, error) {
	var configuration app.Configuration
	err := transaction.QueryRow(ctx, `
		SELECT id::text, tenant_id::text, exam_id::text, exam_version_id::text,
			configuration_version, config_object_key, config_checksum,
			encryption_key_reference, lifecycle_state, created_by::text, created_at
		FROM seb.rotate_configuration(
			$1, $2, $3, $4, $5, $6, $7, $8, $9, $10::char(64),
			NULLIF($11, '')::char(64), $12, $13, $14, $15
		)
	`, command.PreviousConfigurationID, command.ReplacementID, command.RotationID,
		command.EventID, command.TenantID, command.ExamID, command.ExamVersionID,
		command.ConfigurationVersion, command.ConfigObjectKey, command.ConfigChecksum,
		command.BrowserExamKeyHash, command.EncryptionKeyRef, command.ConfigKeyHash,
		command.Reason, command.RotatedBy).Scan(
		&configuration.ID, &configuration.TenantID, &configuration.ExamID,
		&configuration.ExamVersionID, &configuration.ConfigurationVersion,
		&configuration.ConfigObjectKey, &configuration.ConfigChecksum,
		&configuration.EncryptionKeyRef, &configuration.LifecycleState,
		&configuration.CreatedBy, &configuration.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return app.Configuration{}, apperrors.New(apperrors.CodeConflict, "SEB configuration is not active or was changed concurrently")
	}
	if err != nil {
		return app.Configuration{}, mapWriteError(err, "SEB configuration rotation was rejected")
	}
	return configuration, nil
}

func (repository *Postgres) RevokeConfiguration(ctx context.Context, transaction pgx.Tx, command app.RevokeConfiguration) (app.Configuration, error) {
	var configuration app.Configuration
	err := transaction.QueryRow(ctx, `
		SELECT id::text, tenant_id::text, exam_id::text, exam_version_id::text,
			configuration_version, config_object_key, config_checksum,
			encryption_key_reference, lifecycle_state, created_by::text, created_at
		FROM seb.revoke_configuration($1, $2, $3, $4, $5)
	`, command.ID, command.EventID, command.TenantID, command.Reason, command.RevokedBy).Scan(
		&configuration.ID, &configuration.TenantID, &configuration.ExamID,
		&configuration.ExamVersionID, &configuration.ConfigurationVersion,
		&configuration.ConfigObjectKey, &configuration.ConfigChecksum,
		&configuration.EncryptionKeyRef, &configuration.LifecycleState,
		&configuration.CreatedBy, &configuration.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return app.Configuration{}, apperrors.New(apperrors.CodeConflict, "SEB configuration is not active or was changed concurrently")
	}
	if err != nil {
		return app.Configuration{}, mapWriteError(err, "SEB configuration revocation was rejected")
	}
	return configuration, nil
}

func (repository *Postgres) IssueSession(ctx context.Context, transaction pgx.Tx, command app.IssueSession) (app.Session, error) {
	var session app.Session
	err := transaction.QueryRow(ctx, `
		SELECT id::text, tenant_id::text, configuration_id::text, attempt_id::text,
			candidate_id::text, lifecycle_state, issued_at, activated_at, closed_at,
			expires_at, COALESCE(closed_reason, ''), version
		FROM seb.issue_session($1, $2, $3, $4, $5, $6, $7, $8::char(64))
	`, command.ID, command.EventID, command.TenantID, command.ConfigurationID,
		command.AttemptID, command.CandidateID, command.ExpiresAt.UTC(), command.QuitTokenHash).Scan(
		&session.ID, &session.TenantID, &session.ConfigurationID, &session.AttemptID,
		&session.CandidateID, &session.LifecycleState, &session.IssuedAt,
		&session.ActivatedAt, &session.ClosedAt, &session.ExpiresAt,
		&session.ClosedReason, &session.Version,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return app.Session{}, apperrors.New(apperrors.CodeConflict, "SEB configuration is not active")
	}
	if err != nil {
		return app.Session{}, mapWriteError(err, "SEB session could not be issued")
	}
	return session, nil
}

func (repository *Postgres) GetSession(ctx context.Context, transaction pgx.Tx, tenantID, sessionID string) (app.Session, error) {
	var session app.Session
	err := transaction.QueryRow(ctx, `
		SELECT id::text, tenant_id::text, configuration_id::text, attempt_id::text,
			candidate_id::text, lifecycle_state, issued_at, activated_at, closed_at,
			expires_at, COALESCE(closed_reason, ''), version
		FROM seb.sessions WHERE tenant_id = $1 AND id = $2
	`, tenantID, sessionID).Scan(
		&session.ID, &session.TenantID, &session.ConfigurationID, &session.AttemptID,
		&session.CandidateID, &session.LifecycleState, &session.IssuedAt,
		&session.ActivatedAt, &session.ClosedAt, &session.ExpiresAt,
		&session.ClosedReason, &session.Version,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return app.Session{}, apperrors.New(apperrors.CodeNotFound, "SEB session was not found")
	}
	if err != nil {
		return app.Session{}, fmt.Errorf("read SEB session: %w", err)
	}
	return session, nil
}

func (repository *Postgres) CloseSession(ctx context.Context, transaction pgx.Tx, command app.CloseSession) (app.Session, error) {
	var session app.Session
	err := transaction.QueryRow(ctx, `
		UPDATE seb.sessions
		SET lifecycle_state = 'closed', closed_at = clock_timestamp(), closed_reason = $4,
			version = version + 1
		WHERE id = $1 AND tenant_id = $2 AND version = $3
		  AND lifecycle_state IN ('issued', 'active') AND expires_at > clock_timestamp()
		RETURNING id::text, tenant_id::text, configuration_id::text, attempt_id::text,
			candidate_id::text, lifecycle_state, issued_at, activated_at, closed_at,
			expires_at, COALESCE(closed_reason, ''), version
	`, command.ID, command.TenantID, command.ExpectedVersion, command.Reason).Scan(
		&session.ID, &session.TenantID, &session.ConfigurationID, &session.AttemptID,
		&session.CandidateID, &session.LifecycleState, &session.IssuedAt,
		&session.ActivatedAt, &session.ClosedAt, &session.ExpiresAt,
		&session.ClosedReason, &session.Version,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return app.Session{}, apperrors.New(apperrors.CodeConflict, "SEB session is not active or has changed")
	}
	if err != nil {
		return app.Session{}, mapWriteError(err, "SEB session could not be closed")
	}
	payload, marshalErr := json.Marshal(struct {
		SessionID string `json:"session_id"`
		TenantID  string `json:"tenant_id"`
		AttemptID string `json:"attempt_id"`
		Reason    string `json:"reason"`
	}{session.ID, session.TenantID, session.AttemptID, session.ClosedReason})
	if marshalErr != nil {
		return app.Session{}, fmt.Errorf("encode SEB session close event: %w", marshalErr)
	}
	if enqueueErr := repository.enqueue(ctx, transaction, command.EventID, "seb_session", session.ID, session.TenantID, "seb.session.closed.v1", payload); enqueueErr != nil {
		return app.Session{}, enqueueErr
	}
	return session, nil
}

func (repository *Postgres) ValidateSessionHeader(ctx context.Context, transaction pgx.Tx, command app.ValidateSessionHeader) (app.ValidationResult, error) {
	var result app.ValidationResult
	err := transaction.QueryRow(ctx, `
		SELECT session_id::text, configuration_id::text, attempt_id::text,
			header_kind, validation_result, occurred_at
		FROM seb.validate_session_header(
			$1, $2, $3, $4, $5, NULLIF($6, '')::char(64),
			NULLIF($7, '')::char(64)
		)
	`, command.ValidationEventID, command.TenantID, command.SessionID,
		command.HeaderKind, command.HeaderPresent, command.PresentedHeaderHash,
		command.RequestFingerprintHash).Scan(
		&result.SessionID, &result.ConfigurationID, &result.AttemptID,
		&result.HeaderKind, &result.ValidationResult, &result.OccurredAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		// Do not distinguish an absent session from a session owned by another
		// candidate. The database procedure returns no row for both conditions.
		return app.ValidationResult{}, apperrors.New(apperrors.CodeForbidden, "SEB session validation was denied")
	}
	if err != nil {
		return app.ValidationResult{}, mapWriteError(err, "SEB validation could not be recorded")
	}
	return result, nil
}

func (repository *Postgres) enqueue(ctx context.Context, transaction pgx.Tx, eventID, aggregateType, aggregateID, tenantID, eventType string, payload json.RawMessage) error {
	if err := repository.outbox.Enqueue(ctx, transaction, database.OutboxEvent{
		EventID: eventID, AggregateType: aggregateType, AggregateID: aggregateID,
		TenantID: tenantID, EventType: eventType, SchemaVersion: 1,
		Payload: payload, OccurredAt: time.Now().UTC(),
	}); err != nil {
		return fmt.Errorf("enqueue SEB domain event: %w", err)
	}
	return nil
}

func (repository *Postgres) SoftDeleteConfiguration(ctx context.Context, transaction pgx.Tx, command app.DeleteConfiguration) error {
	result, err := transaction.Exec(ctx, `
		UPDATE seb.configurations
		SET deleted_at = clock_timestamp(), deleted_by = $3::uuid, deletion_reason = $4
		WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
	`, command.ID, command.TenantID, command.ActorID, command.Reason)
	if err != nil {
		return fmt.Errorf("soft delete SEB configuration: %w", err)
	}
	if result.RowsAffected() == 0 {
		return apperrors.New(apperrors.CodeNotFound, "configuration not found or already deleted")
	}
	eventID, err := database.NewUUIDv7()
	if err != nil {
		return err
	}
	payload, _ := json.Marshal(struct {
		ConfigurationID string `json:"configuration_id"`
		TenantID        string `json:"tenant_id"`
		ActorID         string `json:"actor_id"`
		Reason          string `json:"reason"`
	}{command.ID, command.TenantID, command.ActorID, command.Reason})
	return repository.enqueue(ctx, transaction, eventID, "configuration", command.ID, command.TenantID, "seb.configuration.soft_deleted.v1", payload)
}

func (repository *Postgres) HardDeleteConfiguration(ctx context.Context, transaction pgx.Tx, command app.DeleteConfiguration) error {
	var success bool
	err := transaction.QueryRow(ctx, `
		SELECT app.hard_delete($1, $2::uuid, $3::uuid, $4)
	`, "seb.configurations", command.ID, command.ActorID, command.Reason).Scan(&success)
	if err != nil {
		return fmt.Errorf("hard delete SEB configuration: %w", err)
	}
	if !success {
		return apperrors.New(apperrors.CodeForbidden, "hard delete denied")
	}
	return nil
}

func mapWriteError(err error, message string) error {
	var postgresError *pgconn.PgError
	if errors.As(err, &postgresError) {
		switch postgresError.Code {
		case "23505":
			return apperrors.New(apperrors.CodeConflict, message)
		case "23503", "23514", "22P02", "22023":
			return apperrors.New(apperrors.CodeInvalidArgument, message)
		case "P0002":
			return apperrors.New(apperrors.CodeNotFound, message)
		case "55000":
			return apperrors.New(apperrors.CodeConflict, message)
		case "42501", "28000":
			return apperrors.New(apperrors.CodeForbidden, "authorization is no longer current")
		}
	}
	return fmt.Errorf("SEB persistence: %w", err)
}
