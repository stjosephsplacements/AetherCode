// Package repo implements Notification persistence with the non-owner
// application role. All caller-visible state and its outbox event are written
// in one RLS-bound transaction.
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
	"github.com/aethercode/aethercode/services/notification/internal/app"
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
		return nil, fmt.Errorf("notification database pool is required")
	}
	outbox, err := messaging.NewOutboxStore(pool, "app.outbox_events")
	if err != nil {
		return nil, err
	}
	return &Postgres{pool: pool, outbox: outbox}, nil
}

func (repository *Postgres) Ping(ctx context.Context) error {
	if repository == nil || repository.pool == nil {
		return fmt.Errorf("notification database repository is not initialized")
	}
	if err := repository.pool.Ping(ctx); err != nil {
		return fmt.Errorf("ping notification database: %w", err)
	}
	return nil
}

func (repository *Postgres) UpsertOwnPreference(ctx context.Context, transaction pgx.Tx, command app.UpsertOwnPreference) (app.Preference, error) {
	var preference app.Preference
	err := transaction.QueryRow(ctx, `
		SELECT id::text, tenant_id::text, recipient_id::text, channel, enabled, updated_at, version
		FROM notification.upsert_own_recipient_preference($1, $2, 'in_app', $3, $4)
	`, command.ID, command.TenantID, command.Enabled, command.ExpectedVersion).Scan(
		&preference.ID, &preference.TenantID, &preference.RecipientID, &preference.Channel,
		&preference.Enabled, &preference.UpdatedAt, &preference.Version,
	)
	if err != nil {
		return app.Preference{}, mapWriteError(err, "notification preference could not be updated")
	}
	return preference, nil
}

func (repository *Postgres) ListOwnPreferences(ctx context.Context, transaction pgx.Tx, tenantID string) ([]app.Preference, error) {
	rows, err := transaction.Query(ctx, `
		SELECT id::text, tenant_id::text, recipient_id::text, channel, enabled, updated_at, version
		FROM notification.recipient_preferences
		WHERE tenant_id = $1 AND recipient_id = authz.current_context_actor_id()
		ORDER BY channel
	`, tenantID)
	if err != nil {
		return nil, fmt.Errorf("list notification preferences: %w", err)
	}
	defer rows.Close()
	preferences := make([]app.Preference, 0)
	for rows.Next() {
		var preference app.Preference
		if err := rows.Scan(
			&preference.ID, &preference.TenantID, &preference.RecipientID, &preference.Channel,
			&preference.Enabled, &preference.UpdatedAt, &preference.Version,
		); err != nil {
			return nil, fmt.Errorf("scan notification preference: %w", err)
		}
		preferences = append(preferences, preference)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate notification preferences: %w", err)
	}
	return preferences, nil
}

func (repository *Postgres) GetRecipientPreference(ctx context.Context, transaction pgx.Tx, recipientID, channel string) (*app.Preference, error) {
	var preference app.Preference
	err := transaction.QueryRow(ctx, `
		SELECT id::text, tenant_id::text, recipient_id::text, channel, enabled, updated_at, version
		FROM notification.recipient_preferences
		WHERE recipient_id = $1 AND channel = $2
		LIMIT 1
	`, recipientID, channel).Scan(
		&preference.ID, &preference.TenantID, &preference.RecipientID, &preference.Channel,
		&preference.Enabled, &preference.UpdatedAt, &preference.Version,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get recipient preference: %w", err)
	}
	return &preference, nil
}

func (repository *Postgres) ScheduleNotification(ctx context.Context, transaction pgx.Tx, command app.ScheduleNotification) (app.Notification, error) {
	var notification app.Notification
	err := transaction.QueryRow(ctx, `
		INSERT INTO notification.notifications (
			id, tenant_id, recipient_id, category, template_code,
			content_object_key, content_checksum, encryption_key_reference,
			scheduled_at, retention_until, legal_hold, retention_subject_id
		)
		SELECT
			$1, $2, $3, $4, $5, $6, $7, $8, $9,
			clock_timestamp() + make_interval(days => COALESCE(policy.notification_delivery_days, 90)),
			notification.has_active_legal_hold($2, $3, NULLIF($10, '')::uuid),
			NULLIF($10, '')::uuid
		FROM (SELECT 1) AS source
		LEFT JOIN notification.tenant_retention_policies AS policy ON policy.tenant_id = $2
		RETURNING id::text, tenant_id::text, recipient_id::text, category, template_code,
			content_object_key, content_checksum, encryption_key_reference, lifecycle_state,
			scheduled_at, created_at, completed_at, retention_until, legal_hold,
			COALESCE(retention_subject_id::text, ''), version
	`, command.ID, command.TenantID, command.RecipientID, command.Category, command.TemplateCode,
		command.ContentObjectKey, command.ContentChecksum, command.EncryptionKeyRef,
		command.ScheduledAt.UTC(), command.RetentionSubjectID).Scan(notificationFields(&notification)...)
	if err != nil {
		return app.Notification{}, mapWriteError(err, "notification could not be scheduled")
	}
	payload, err := json.Marshal(struct {
		NotificationID string    `json:"notification_id"`
		TenantID       string    `json:"tenant_id"`
		RecipientID    string    `json:"recipient_id"`
		Category       string    `json:"category"`
		TemplateCode   string    `json:"template_code"`
		ScheduledAt    time.Time `json:"scheduled_at"`
	}{
		NotificationID: notification.ID, TenantID: notification.TenantID,
		RecipientID: notification.RecipientID, Category: notification.Category,
		TemplateCode: notification.TemplateCode, ScheduledAt: notification.ScheduledAt.UTC(),
	})
	if err != nil {
		return app.Notification{}, fmt.Errorf("encode notification scheduled event: %w", err)
	}
	if err := repository.enqueue(ctx, transaction, command.EventID, notification.ID, notification.TenantID, "notification.scheduled.v1", payload); err != nil {
		return app.Notification{}, err
	}
	return notification, nil
}

func (repository *Postgres) ListOwnNotifications(ctx context.Context, transaction pgx.Tx, tenantID string, limit int) ([]app.Notification, error) {
	rows, err := transaction.Query(ctx, `
		SELECT id::text, tenant_id::text, recipient_id::text, category, template_code,
			content_object_key, content_checksum, encryption_key_reference, lifecycle_state,
			scheduled_at, created_at, completed_at, retention_until, legal_hold,
			COALESCE(retention_subject_id::text, ''), version
		FROM notification.notifications
		WHERE tenant_id = $1 AND recipient_id = authz.current_context_actor_id()
		  AND deleted_at IS NULL
		ORDER BY created_at DESC, id DESC
		LIMIT $2
	`, tenantID, limit)
	if err != nil {
		return nil, fmt.Errorf("list notifications: %w", err)
	}
	defer rows.Close()
	notifications := make([]app.Notification, 0, limit)
	for rows.Next() {
		var notification app.Notification
		if err := rows.Scan(notificationFields(&notification)...); err != nil {
			return nil, fmt.Errorf("scan notification: %w", err)
		}
		notifications = append(notifications, notification)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate notifications: %w", err)
	}
	return notifications, nil
}

func (repository *Postgres) CancelNotification(ctx context.Context, transaction pgx.Tx, command app.CancelNotification) (app.Notification, error) {
	var notification app.Notification
	err := transaction.QueryRow(ctx, `
		UPDATE notification.notifications
		SET lifecycle_state = 'cancelled', completed_at = clock_timestamp(), version = version + 1
		WHERE id = $1 AND tenant_id = $2 AND version = $3
		  AND lifecycle_state = 'pending'
		RETURNING id::text, tenant_id::text, recipient_id::text, category, template_code,
			content_object_key, content_checksum, encryption_key_reference, lifecycle_state,
			scheduled_at, created_at, completed_at, retention_until, legal_hold,
			COALESCE(retention_subject_id::text, ''), version
	`, command.ID, command.TenantID, command.ExpectedVersion).Scan(notificationFields(&notification)...)
	if errors.Is(err, pgx.ErrNoRows) {
		return app.Notification{}, apperrors.New(apperrors.CodeConflict, "notification is not pending or has changed")
	}
	if err != nil {
		return app.Notification{}, mapWriteError(err, "notification could not be cancelled")
	}
	payload, err := json.Marshal(struct {
		NotificationID string `json:"notification_id"`
		TenantID       string `json:"tenant_id"`
		Reason         string `json:"reason"`
	}{NotificationID: notification.ID, TenantID: notification.TenantID, Reason: command.Reason})
	if err != nil {
		return app.Notification{}, fmt.Errorf("encode notification cancellation event: %w", err)
	}
	if err := repository.enqueue(ctx, transaction, command.EventID, notification.ID, notification.TenantID, "notification.cancelled.v1", payload); err != nil {
		return app.Notification{}, err
	}
	return notification, nil
}

func (repository *Postgres) DeliverDueInApp(ctx context.Context, limit int) (int, error) {
	if repository == nil || repository.pool == nil {
		return 0, fmt.Errorf("notification database repository is not initialized")
	}
	var delivered int
	if err := repository.pool.QueryRow(ctx, `SELECT notification.deliver_due_in_app($1)`, limit).Scan(&delivered); err != nil {
		return 0, fmt.Errorf("deliver due in-app notifications: %w", err)
	}
	return delivered, nil
}

func (repository *Postgres) enqueue(ctx context.Context, transaction pgx.Tx, eventID, aggregateID, tenantID, eventType string, payload json.RawMessage) error {
	if err := repository.outbox.Enqueue(ctx, transaction, database.OutboxEvent{
		EventID: eventID, AggregateType: "notification", AggregateID: aggregateID,
		TenantID: tenantID, EventType: eventType, SchemaVersion: 1,
		Payload: payload, OccurredAt: time.Now().UTC(),
	}); err != nil {
		return fmt.Errorf("enqueue notification domain event: %w", err)
	}
	return nil
}

func notificationFields(notification *app.Notification) []any {
	return []any{
		&notification.ID, &notification.TenantID, &notification.RecipientID, &notification.Category,
		&notification.TemplateCode, &notification.ContentObjectKey, &notification.ContentChecksum,
		&notification.EncryptionKeyRef, &notification.LifecycleState, &notification.ScheduledAt,
		&notification.CreatedAt, &notification.CompletedAt, &notification.RetentionUntil,
		&notification.LegalHold, &notification.RetentionSubjectID, &notification.Version,
	}
}

func (repository *Postgres) SoftDeleteNotification(ctx context.Context, transaction pgx.Tx, command app.DeleteNotification) error {
	result, err := transaction.Exec(ctx, `
		UPDATE notification.notifications
		SET deleted_at = clock_timestamp(), deleted_by = $3::uuid, deletion_reason = $4
		WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
	`, command.ID, command.TenantID, command.ActorID, command.Reason)
	if err != nil {
		return fmt.Errorf("soft delete notification: %w", err)
	}
	if result.RowsAffected() == 0 {
		return apperrors.New(apperrors.CodeNotFound, "notification not found or already deleted")
	}
	return nil
}

func (repository *Postgres) HardDeleteNotification(ctx context.Context, transaction pgx.Tx, command app.DeleteNotification) error {
	var success bool
	err := transaction.QueryRow(ctx, `
		SELECT app.hard_delete($1, $2::uuid, $3::uuid, $4)
	`, "notification.notifications", command.ID, command.ActorID, command.Reason).Scan(&success)
	if err != nil {
		return fmt.Errorf("hard delete notification: %w", err)
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
		case "23505", "P0001", "55000":
			return apperrors.New(apperrors.CodeConflict, message)
		case "23503", "23514", "22P02", "22023":
			return apperrors.New(apperrors.CodeInvalidArgument, message)
		case "42501", "28000":
			return apperrors.New(apperrors.CodeForbidden, "authorization is no longer current")
		}
	}
	return fmt.Errorf("notification persistence: %w", err)
}
