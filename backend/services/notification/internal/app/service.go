// Package app contains the Notification service's tenant-bound workflows.
// It persists only encrypted payload references; the in-app provider delivers
// durable metadata and never decrypts or logs notification content.
package app

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"

	centralauthz "github.com/aethercode/aethercode/libs/pkg/authz"
	"github.com/aethercode/aethercode/libs/pkg/database"
	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	uuidPattern      = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
	checksumPattern  = regexp.MustCompile(`^[0-9a-f]{64}$`)
	templatePattern  = regexp.MustCompile(`^[a-z][a-z0-9._-]{0,159}$`)
	objectKeyPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._/=-]*$`)
)

// Preference controls an explicitly configured in-app delivery channel. The
// email schema remains reserved, but no email preference can be enabled until
// an encrypted-address resolver and provider are deployed.
type Preference struct {
	ID          string    `json:"id"`
	TenantID    string    `json:"tenant_id"`
	RecipientID string    `json:"recipient_id"`
	Channel     string    `json:"channel"`
	Enabled     bool      `json:"enabled"`
	UpdatedAt   time.Time `json:"updated_at"`
	Version     int64     `json:"version"`
}

// Notification contains safe metadata and encrypted-object references. Its
// content is never stored or returned as plaintext by this service.
type Notification struct {
	ID                 string     `json:"id"`
	TenantID           string     `json:"tenant_id"`
	RecipientID        string     `json:"recipient_id"`
	Category           string     `json:"category"`
	TemplateCode       string     `json:"template_code"`
	ContentObjectKey   string     `json:"content_object_key"`
	ContentChecksum    string     `json:"content_checksum"`
	EncryptionKeyRef   string     `json:"encryption_key_reference"`
	LifecycleState     string     `json:"lifecycle_state"`
	ScheduledAt        time.Time  `json:"scheduled_at"`
	CreatedAt          time.Time  `json:"created_at"`
	CompletedAt        *time.Time `json:"completed_at,omitempty"`
	RetentionUntil     time.Time  `json:"retention_until"`
	LegalHold          bool       `json:"legal_hold"`
	RetentionSubjectID string     `json:"retention_subject_id,omitempty"`
	Version            int64      `json:"version"`
}

type UpsertOwnPreference struct {
	ID              string
	TenantID        string
	Channel         string
	Enabled         bool
	ExpectedVersion int64
	IdempotencyKey  string
	RequestHash     string
}

type ScheduleNotification struct {
	ID                 string
	EventID            string
	TenantID           string
	RecipientID        string
	Category           string
	TemplateCode       string
	ContentObjectKey   string
	ContentChecksum    string
	EncryptionKeyRef   string
	ScheduledAt        time.Time
	RetentionSubjectID string
	IdempotencyKey     string
	RequestHash        string
}

type CancelNotification struct {
	ID              string
	EventID         string
	TenantID        string
	ExpectedVersion int64
	Reason          string
	IdempotencyKey  string
	RequestHash     string
}

// DeleteNotification is the command for soft/hard delete operations.
type DeleteNotification struct {
	ID       string
	TenantID string
	ActorID  string
	Reason   string
}

// Store is implemented by the least-privileged PostgreSQL adapter. It accepts
// a transaction already carrying the short-lived central authorization
// capability, keeping all state and outbox work atomic.
type Store interface {
	UpsertOwnPreference(context.Context, pgx.Tx, UpsertOwnPreference) (Preference, error)
	GetRecipientPreference(ctx context.Context, tx pgx.Tx, recipientID, channel string) (*Preference, error)
	ListOwnPreferences(context.Context, pgx.Tx, string) ([]Preference, error)
	ScheduleNotification(context.Context, pgx.Tx, ScheduleNotification) (Notification, error)
	ListOwnNotifications(context.Context, pgx.Tx, string, int) ([]Notification, error)
	CancelNotification(context.Context, pgx.Tx, CancelNotification) (Notification, error)
	DeliverDueInApp(context.Context, int) (int, error)
	SoftDeleteNotification(context.Context, pgx.Tx, DeleteNotification) error
	HardDeleteNotification(context.Context, pgx.Tx, DeleteNotification) error
	Ping(context.Context) error
}

type Service struct {
	pool        *pgxpool.Pool
	store       Store
	idempotency *database.IdempotencyStore
	now         func() time.Time
}

func NewService(pool *pgxpool.Pool, store Store) (*Service, error) {
	if pool == nil || store == nil {
		return nil, fmt.Errorf("notification database pool and store are required")
	}
	idempotency, err := database.NewIdempotencyStore("app.idempotency_keys")
	if err != nil {
		return nil, err
	}
	return &Service{pool: pool, store: store, idempotency: idempotency, now: time.Now}, nil
}

func (service *Service) UpsertOwnPreference(ctx context.Context, capability centralauthz.Capability, command UpsertOwnPreference) (Preference, error) {
	if !validUUID(command.ID) || !validUUID(command.TenantID) || command.ExpectedVersion < 0 ||
		(command.Channel != "in_app" && command.Channel != "email" && command.Channel != "sms") {
		return Preference{}, invalid("notification preference fields are invalid")
	}
	if err := validateIdempotency(command.IdempotencyKey, command.RequestHash); err != nil {
		return Preference{}, err
	}
	var result Preference
	err := database.WithTenantTx(ctx, service.pool, capability, func(transaction pgx.Tx) error {
		claim, err := service.idempotency.Claim(
			ctx, transaction, command.TenantID, "notification.upsert_own_preference", command.IdempotencyKey,
			command.RequestHash, service.now().UTC().Add(24*time.Hour),
		)
		if err != nil {
			return err
		}
		if !claim.Acquired {
			return decodeReplay(claim, &result)
		}
		result, err = service.store.UpsertOwnPreference(ctx, transaction, command)
		if err != nil {
			return err
		}
		response, err := json.Marshal(result)
		if err != nil {
			return fmt.Errorf("encode notification preference response: %w", err)
		}
		return service.idempotency.Complete(
			ctx, transaction, command.TenantID, "notification.upsert_own_preference", command.IdempotencyKey,
			200, response,
		)
	})
	return result, err
}

func (service *Service) ListOwnPreferences(ctx context.Context, capability centralauthz.Capability, tenantID string) ([]Preference, error) {
	if !validUUID(tenantID) {
		return nil, invalid("tenant ID is invalid")
	}
	var result []Preference
	err := database.WithTenantTx(ctx, service.pool, capability, func(transaction pgx.Tx) error {
		var err error
		result, err = service.store.ListOwnPreferences(ctx, transaction, tenantID)
		return err
	})
	return result, err
}

func (service *Service) ScheduleNotification(ctx context.Context, capability centralauthz.Capability, command ScheduleNotification) (Notification, error) {
	normalizeSchedule(&command)
	if err := validateSchedule(command, service.now().UTC()); err != nil {
		return Notification{}, err
	}
	var result Notification
	err := database.WithTenantTx(ctx, service.pool, capability, func(transaction pgx.Tx) error {
		// Check recipient delivery preference before scheduling. If the
		// recipient has explicitly opted out of the in_app channel, skip
		// creation and return an empty notification without error.
		pref, err := service.store.GetRecipientPreference(ctx, transaction, command.RecipientID, "in_app")
		if err != nil {
			return fmt.Errorf("check recipient preference: %w", err)
		}
		if pref != nil && !pref.Enabled {
			return nil
		}
		claim, err := service.idempotency.Claim(
			ctx, transaction, command.TenantID, "notification.schedule", command.IdempotencyKey,
			command.RequestHash, service.now().UTC().Add(24*time.Hour),
		)
		if err != nil {
			return err
		}
		if !claim.Acquired {
			return decodeReplay(claim, &result)
		}
		result, err = service.store.ScheduleNotification(ctx, transaction, command)
		if err != nil {
			return err
		}
		response, err := json.Marshal(result)
		if err != nil {
			return fmt.Errorf("encode scheduled notification response: %w", err)
		}
		return service.idempotency.Complete(
			ctx, transaction, command.TenantID, "notification.schedule", command.IdempotencyKey,
			201, response,
		)
	})
	return result, err
}

func (service *Service) ListOwnNotifications(ctx context.Context, capability centralauthz.Capability, tenantID string, limit int) ([]Notification, error) {
	if !validUUID(tenantID) || limit < 1 || limit > 100 {
		return nil, invalid("tenant ID or notification limit is invalid")
	}
	var result []Notification
	err := database.WithTenantTx(ctx, service.pool, capability, func(transaction pgx.Tx) error {
		var err error
		result, err = service.store.ListOwnNotifications(ctx, transaction, tenantID, limit)
		return err
	})
	return result, err
}

func (service *Service) CancelNotification(ctx context.Context, capability centralauthz.Capability, command CancelNotification) (Notification, error) {
	if (!validUUID(command.ID) || !validUUID(command.EventID) || !validUUID(command.TenantID)) ||
		command.ExpectedVersion < 1 || !validLength(command.Reason, 1, 500) {
		return Notification{}, invalid("notification cancellation fields are invalid")
	}
	if err := validateIdempotency(command.IdempotencyKey, command.RequestHash); err != nil {
		return Notification{}, err
	}
	var result Notification
	err := database.WithTenantTx(ctx, service.pool, capability, func(transaction pgx.Tx) error {
		claim, err := service.idempotency.Claim(
			ctx, transaction, command.TenantID, "notification.cancel", command.IdempotencyKey,
			command.RequestHash, service.now().UTC().Add(24*time.Hour),
		)
		if err != nil {
			return err
		}
		if !claim.Acquired {
			return decodeReplay(claim, &result)
		}
		result, err = service.store.CancelNotification(ctx, transaction, command)
		if err != nil {
			return err
		}
		response, err := json.Marshal(result)
		if err != nil {
			return fmt.Errorf("encode cancelled notification response: %w", err)
		}
		return service.idempotency.Complete(
			ctx, transaction, command.TenantID, "notification.cancel", command.IdempotencyKey,
			200, response,
		)
	})
	return result, err
}

// DeliverDueInApp is called only by the internal runner. The database function
// has no attacker-controlled identifiers and processes a bounded due batch.
func (service *Service) DeliverDueInApp(ctx context.Context, limit int) (int, error) {
	if service == nil || service.store == nil || limit < 1 || limit > 1000 {
		return 0, fmt.Errorf("notification in-app delivery runner is not initialized")
	}
	return service.store.DeliverDueInApp(ctx, limit)
}

// DeleteNotificationByID soft-deletes a notification with audit trail.
func (service *Service) DeleteNotificationByID(ctx context.Context, capability centralauthz.Capability, command DeleteNotification) error {
	command.ID = strings.ToLower(strings.TrimSpace(command.ID))
	command.TenantID = strings.ToLower(strings.TrimSpace(command.TenantID))
	command.ActorID = strings.ToLower(strings.TrimSpace(command.ActorID))
	command.Reason = strings.TrimSpace(command.Reason)
	if !validUUID(command.ID) || !validUUID(command.TenantID) || !validUUID(command.ActorID) || command.Reason == "" {
		return invalid("notification ID, tenant ID, actor ID, and deletion reason are required")
	}
	return database.WithTenantTx(ctx, service.pool, capability, func(transaction pgx.Tx) error {
		return service.store.SoftDeleteNotification(ctx, transaction, command)
	})
}

// HardDeleteNotificationByID permanently removes a notification (SuperAdmin only).
func (service *Service) HardDeleteNotificationByID(ctx context.Context, capability centralauthz.Capability, command DeleteNotification) error {
	command.ID = strings.ToLower(strings.TrimSpace(command.ID))
	command.TenantID = strings.ToLower(strings.TrimSpace(command.TenantID))
	command.ActorID = strings.ToLower(strings.TrimSpace(command.ActorID))
	command.Reason = strings.TrimSpace(command.Reason)
	if !validUUID(command.ID) || !validUUID(command.TenantID) || !validUUID(command.ActorID) || command.Reason == "" {
		return invalid("notification ID, tenant ID, actor ID, and deletion reason are required")
	}
	return database.WithTenantTx(ctx, service.pool, capability, func(transaction pgx.Tx) error {
		return service.store.HardDeleteNotification(ctx, transaction, command)
	})
}

func validateSchedule(command ScheduleNotification, now time.Time) error {
	if !validUUID(command.ID) || !validUUID(command.EventID) || !validUUID(command.TenantID) || !validUUID(command.RecipientID) {
		return invalid("notification IDs are invalid")
	}
	if command.Category != "exam_reminder" && command.Category != "exam_result" && command.Category != "system" {
		return invalid("notification category is invalid")
	}
	if (!templatePattern.MatchString(command.TemplateCode) || !objectKeyPattern.MatchString(command.ContentObjectKey)) ||
		!validLength(command.ContentObjectKey, 1, 1024) ||
		strings.Contains(command.ContentObjectKey, "..") || !checksumPattern.MatchString(command.ContentChecksum) ||
		!validLength(command.EncryptionKeyRef, 1, 255) {
		return invalid("encrypted notification content reference is invalid")
	}
	if command.ScheduledAt.IsZero() || command.ScheduledAt.Before(now.Add(-time.Minute)) || command.ScheduledAt.After(now.Add(366*24*time.Hour)) {
		return invalid("notification schedule must be within the permitted window")
	}
	if strings.TrimSpace(command.RetentionSubjectID) != "" && !validUUID(command.RetentionSubjectID) {
		return invalid("notification retention subject ID is invalid")
	}
	return validateIdempotency(command.IdempotencyKey, command.RequestHash)
}

func normalizeSchedule(command *ScheduleNotification) {
	if command == nil {
		return
	}
	command.Category = strings.TrimSpace(command.Category)
	command.TemplateCode = strings.TrimSpace(command.TemplateCode)
	command.ContentObjectKey = strings.TrimSpace(command.ContentObjectKey)
	command.ContentChecksum = strings.ToLower(strings.TrimSpace(command.ContentChecksum))
	command.EncryptionKeyRef = strings.TrimSpace(command.EncryptionKeyRef)
	command.RetentionSubjectID = strings.ToLower(strings.TrimSpace(command.RetentionSubjectID))
}

func validateIdempotency(key, requestHash string) error {
	if !validLength(key, 1, 255) || !checksumPattern.MatchString(strings.ToLower(strings.TrimSpace(requestHash))) {
		return invalid("Idempotency-Key and request hash are required")
	}
	return nil
}

func decodeReplay[T any](claim database.IdempotencyRecord, destination *T) error {
	if claim.State != database.IdempotencyCompleted || claim.ResponseStatus < 200 || !json.Valid(claim.ResponseBody) {
		return apperrors.New(apperrors.CodeConflict, "idempotency key is still in progress or did not complete")
	}
	if err := json.Unmarshal(claim.ResponseBody, destination); err != nil {
		return fmt.Errorf("decode idempotent notification response: %w", err)
	}
	return nil
}

func validUUID(value string) bool {
	return uuidPattern.MatchString(strings.ToLower(strings.TrimSpace(value)))
}

func validLength(value string, minimum, maximum int) bool {
	length := len(strings.TrimSpace(value))
	return length >= minimum && length <= maximum
}

func invalid(message string) error {
	return apperrors.New(apperrors.CodeInvalidArgument, message)
}
