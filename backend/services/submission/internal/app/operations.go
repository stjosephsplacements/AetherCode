package app

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	centralauthz "github.com/stjosephsplacements/AetherCode/libs/pkg/authz"
	"github.com/stjosephsplacements/AetherCode/libs/pkg/database"
	apperrors "github.com/stjosephsplacements/AetherCode/libs/pkg/errors"
)

// Exam-day operations (ADR-0027). Staff routes authorize on score_summaries
// (monitor, release) and attempt_events (extra time, announcements), which no
// candidate self scope can obtain; the candidate routes bind the attempt to the
// signed actor in the database.

// ExamVersionCommand names one exam version of a tenant.
type ExamVersionCommand struct {
	TenantID      string
	ExamVersionID string
}

// ReleaseResults shows or hides an exam version's scores to its candidates.
type ReleaseResults struct {
	ExamVersionCommand
	Released bool
}

// ExtendDeadlines adds Minutes to one in-progress attempt, or to every
// in-progress attempt of the exam version when AttemptID is empty.
type ExtendDeadlines struct {
	ExamVersionCommand
	AttemptID string
	Minutes   int
}

// PostAnnouncement shows a message to every candidate of the exam version.
type PostAnnouncement struct {
	ExamVersionCommand
	ID   string
	Body string
}

// Exam-day JSON is built by the database functions and passed through as is:
// the frontend reads it, and each shape is documented in the OpenAPI spec.

func (command *ExamVersionCommand) validate() error {
	command.TenantID = normalizeUUID(command.TenantID)
	command.ExamVersionID = normalizeUUID(command.ExamVersionID)
	if !isUUID(command.TenantID) || !isUUID(command.ExamVersionID) {
		return apperrors.New(apperrors.CodeInvalidArgument, "tenant and exam version IDs must be UUIDs")
	}
	return nil
}

func (service *Service) inTenant(contextValue context.Context, capability centralauthz.Capability, run func(pgx.Tx) error) error {
	return database.WithTenantTx(contextValue, service.pool, capability, run)
}

func (service *Service) GetExamMonitor(contextValue context.Context, capability centralauthz.Capability, command ExamVersionCommand) (json.RawMessage, error) {
	if err := command.validate(); err != nil {
		return nil, err
	}
	var monitor json.RawMessage
	err := service.inTenant(contextValue, capability, func(transaction pgx.Tx) error {
		var storeErr error
		monitor, storeErr = service.store.GetExamMonitor(contextValue, transaction, command)
		return storeErr
	})
	return monitor, err
}

func (service *Service) ReleaseResults(contextValue context.Context, capability centralauthz.Capability, command ReleaseResults) (json.RawMessage, error) {
	if err := command.validate(); err != nil {
		return nil, err
	}
	var released json.RawMessage
	err := service.inTenant(contextValue, capability, func(transaction pgx.Tx) error {
		var storeErr error
		released, storeErr = service.store.ReleaseResults(contextValue, transaction, command)
		return storeErr
	})
	return released, err
}

func (service *Service) ExtendDeadlines(contextValue context.Context, capability centralauthz.Capability, command ExtendDeadlines) (int, error) {
	if err := command.validate(); err != nil {
		return 0, err
	}
	if command.AttemptID != "" {
		command.AttemptID = normalizeUUID(command.AttemptID)
		if !isUUID(command.AttemptID) {
			return 0, apperrors.New(apperrors.CodeInvalidArgument, "attempt_id must be a UUID")
		}
	}
	if command.Minutes < 1 || command.Minutes > 240 {
		return 0, apperrors.New(apperrors.CodeInvalidArgument, "extra time must be between 1 and 240 minutes")
	}
	var extended int
	err := service.inTenant(contextValue, capability, func(transaction pgx.Tx) error {
		var storeErr error
		extended, storeErr = service.store.ExtendDeadlines(contextValue, transaction, command)
		return storeErr
	})
	return extended, err
}

func (service *Service) PostAnnouncement(contextValue context.Context, capability centralauthz.Capability, command PostAnnouncement) (json.RawMessage, error) {
	if err := command.validate(); err != nil {
		return nil, err
	}
	command.Body = strings.TrimSpace(command.Body)
	if length := utf8.RuneCountInString(command.Body); length < 1 || length > 2000 {
		return nil, apperrors.New(apperrors.CodeInvalidArgument, "an announcement needs 1 to 2000 characters")
	}
	var err error
	if command.ID, err = database.NewUUIDv7(); err != nil {
		return nil, err
	}
	var announcement json.RawMessage
	err = service.inTenant(contextValue, capability, func(transaction pgx.Tx) error {
		var storeErr error
		announcement, storeErr = service.store.PostAnnouncement(contextValue, transaction, command)
		return storeErr
	})
	return announcement, err
}

// GetAttemptLiveState is what an open exam screen polls: the deadline, which
// staff may have extended, the attempt state and the exam's announcements.
func (service *Service) GetAttemptLiveState(contextValue context.Context, capability centralauthz.Capability, command GetAttempt) (json.RawMessage, error) {
	return service.candidateJSON(contextValue, capability, command, service.store.GetAttemptLiveState)
}

// GetAttemptResult is the candidate's score once staff release it.
func (service *Service) GetAttemptResult(contextValue context.Context, capability centralauthz.Capability, command GetAttempt) (json.RawMessage, error) {
	return service.candidateJSON(contextValue, capability, command, service.store.GetAttemptResult)
}

func (service *Service) candidateJSON(
	contextValue context.Context,
	capability centralauthz.Capability,
	command GetAttempt,
	read func(context.Context, pgx.Tx, GetAttempt) (json.RawMessage, error),
) (json.RawMessage, error) {
	command.TenantID = normalizeUUID(command.TenantID)
	command.AttemptID = normalizeUUID(command.AttemptID)
	if !isUUID(command.TenantID) || !isUUID(command.AttemptID) {
		return nil, apperrors.New(apperrors.CodeInvalidArgument, "tenant and attempt IDs must be UUIDs")
	}
	var response json.RawMessage
	err := service.inTenant(contextValue, capability, func(transaction pgx.Tx) error {
		var storeErr error
		response, storeErr = read(contextValue, transaction, command)
		return storeErr
	})
	return response, err
}

// SetIntegrity turns the exam's fullscreen requirement and paste guard on or
// off (ADR-0037).
type SetIntegrity struct {
	ExamVersionCommand
	RequireFullscreen  bool
	BlockExternalPaste bool
	WebcamRequired     bool
}

func (service *Service) SetIntegrity(contextValue context.Context, capability centralauthz.Capability, command SetIntegrity) error {
	if err := command.validate(); err != nil {
		return err
	}
	return service.inTenant(contextValue, capability, func(transaction pgx.Tx) error {
		return service.store.SetIntegrity(contextValue, transaction, command)
	})
}

// RecordIntegrityEvent stores what the exam screen saw: the candidate left the
// window, left fullscreen, or pasted text from outside (ADR-0037).
func (service *Service) RecordIntegrityEvent(contextValue context.Context, capability centralauthz.Capability, command GetAttempt, kind string) error {
	command.TenantID, command.AttemptID = normalizeUUID(command.TenantID), normalizeUUID(command.AttemptID)
	if !isUUID(command.TenantID) || !isUUID(command.AttemptID) || (kind != "blur" && kind != "paste" && kind != "fullscreen_exit") {
		return apperrors.New(apperrors.CodeInvalidArgument, "an integrity event is blur, paste or fullscreen_exit")
	}
	return service.inTenant(contextValue, capability, func(transaction pgx.Tx) error {
		return service.store.RecordIntegrityEvent(contextValue, transaction, command, kind)
	})
}

// RegradeItem evaluates an item's answers again on its current tests, after
// Assessment repinned it to a corrected question version (ADR-0039).
func (service *Service) RegradeItem(contextValue context.Context, capability centralauthz.Capability, command ExamVersionCommand, examItemID string) (json.RawMessage, error) {
	if err := command.validate(); err != nil {
		return nil, err
	}
	examItemID = normalizeUUID(examItemID)
	if !isUUID(examItemID) {
		return nil, apperrors.New(apperrors.CodeInvalidArgument, "exam item ID must be a UUID")
	}
	var result json.RawMessage
	err := service.inTenant(contextValue, capability, func(transaction pgx.Tx) error {
		var storeErr error
		result, storeErr = service.store.RegradeItem(contextValue, transaction, command, examItemID)
		return storeErr
	})
	return result, err
}

// StoreSnapshot saves a webcam snapshot object key after the caller has put it
// in MinIO. Access is gated by submission.write on attempts (the candidate's
// own scope). Returns the new snapshot ID.
type StoreSnapshot struct {
	TenantID   string
	AttemptID  string
	CapturedAt time.Time
	StorageKey string
	SizeBytes  int
}

// ListSnapshots retrieves snapshot metadata for staff (gated by
// submission.read on snapshots — VIEW_STUDENT_PII).
type ListSnapshots struct {
	TenantID  string
	AttemptID string
	Limit     int
}

// SnapshotRow is the raw repo result before presigning.
type SnapshotRow struct {
	ID         string
	CapturedAt time.Time
	StorageKey string
}

// Snapshot is the API-safe view of one webcam snapshot with a presigned URL.
type Snapshot struct {
	ID         string    `json:"id"`
	CapturedAt time.Time `json:"captured_at"`
	URL        string    `json:"url"`
}

const maxSnapshotBytes = 512 << 10 // 512 KiB

// UploadSnapshot stores a JPEG image in MinIO and records its metadata.
// data must be ≤512 KiB; capturedAt is the browser-reported capture time.
func (service *Service) UploadSnapshot(contextValue context.Context, capability centralauthz.Capability, tenantID, attemptID string, capturedAt time.Time, data []byte) (string, error) {
	tenantID, attemptID = normalizeUUID(tenantID), normalizeUUID(attemptID)
	if !isUUID(tenantID) || !isUUID(attemptID) {
		return "", apperrors.New(apperrors.CodeInvalidArgument, "tenant ID and attempt ID are required")
	}
	if len(data) == 0 || len(data) > maxSnapshotBytes {
		return "", apperrors.New(apperrors.CodeInvalidArgument, fmt.Sprintf("snapshot must be between 1 and %d bytes", maxSnapshotBytes))
	}
	if capturedAt.IsZero() {
		capturedAt = time.Now().UTC()
	}
	if service.storage == nil {
		return "", apperrors.New(apperrors.CodeUnavailable, "snapshot storage is not configured")
	}
	snapshotID, err := database.NewUUIDv7()
	if err != nil {
		return "", fmt.Errorf("generate snapshot ID: %w", err)
	}
	key := fmt.Sprintf("tenants/%s/attempts/%s/snapshots/%s.jpg", tenantID, attemptID, snapshotID)
	if err := service.storage.Put(contextValue, key, bytes.NewReader(data), int64(len(data)), "image/jpeg"); err != nil {
		return "", fmt.Errorf("put snapshot in storage: %w", err)
	}
	var id string
	txErr := service.inTenant(contextValue, capability, func(transaction pgx.Tx) error {
		var storeErr error
		id, storeErr = service.store.StoreSnapshot(contextValue, transaction, StoreSnapshot{
			TenantID: tenantID, AttemptID: attemptID, CapturedAt: capturedAt,
			StorageKey: key, SizeBytes: len(data),
		})
		return storeErr
	})
	if txErr != nil {
		_ = service.storage.Delete(context.WithoutCancel(contextValue), key)
		return "", txErr
	}
	// Best-effort: publish to proctor service for GPU inference.
	if service.snapshotPublisher != nil && id != "" {
		payload := fmt.Sprintf(
			`{"snapshot_id":%q,"attempt_id":%q,"tenant_id":%q,"storage_key":%q,"captured_at":%q}`,
			id, attemptID, tenantID, key, capturedAt.Format(time.RFC3339Nano),
		)
		_ = service.snapshotPublisher.PublishSnapshot(context.WithoutCancel(contextValue), "proctor.analyze", []byte(payload))
	}
	return id, nil
}

func (service *Service) ListSnapshots(contextValue context.Context, capability centralauthz.Capability, command ListSnapshots) ([]Snapshot, error) {
	command.TenantID, command.AttemptID = normalizeUUID(command.TenantID), normalizeUUID(command.AttemptID)
	if !isUUID(command.TenantID) || !isUUID(command.AttemptID) {
		return nil, apperrors.New(apperrors.CodeInvalidArgument, "tenant ID and attempt ID are required")
	}
	if command.Limit <= 0 || command.Limit > 200 {
		command.Limit = 50
	}
	if service.storage == nil {
		return nil, apperrors.New(apperrors.CodeUnavailable, "snapshot storage is not configured")
	}
	var rows []SnapshotRow
	err := service.inTenant(contextValue, capability, func(transaction pgx.Tx) error {
		var storeErr error
		rows, storeErr = service.store.ListSnapshotKeys(contextValue, transaction, command)
		return storeErr
	})
	if err != nil {
		return nil, err
	}
	snapshots := make([]Snapshot, 0, len(rows))
	for _, row := range rows {
		url, presignErr := service.storage.PresignGet(contextValue, row.StorageKey, 15*time.Minute)
		if presignErr != nil {
			return nil, fmt.Errorf("presign snapshot %s: %w", row.ID, presignErr)
		}
		snapshots = append(snapshots, Snapshot{ID: row.ID, CapturedAt: row.CapturedAt, URL: url})
	}
	return snapshots, nil
}

// GetGradingQueue is the college's grading queue for staff (ADR-0043).
func (service *Service) GetGradingQueue(contextValue context.Context, capability centralauthz.Capability, tenantID string) (json.RawMessage, error) {
	tenantID = normalizeUUID(tenantID)
	if !isUUID(tenantID) {
		return nil, apperrors.New(apperrors.CodeInvalidArgument, "tenant ID must be a UUID")
	}
	var queue json.RawMessage
	err := service.inTenant(contextValue, capability, func(transaction pgx.Tx) error {
		var storeErr error
		queue, storeErr = service.store.GetGradingQueue(contextValue, transaction, tenantID)
		return storeErr
	})
	return queue, err
}
