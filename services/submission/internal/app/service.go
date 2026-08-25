// Package app contains Submission's transaction-scoped candidate workflows.
package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"regexp"
	"strings"
	"time"

	centralauthz "github.com/aethercode/aethercode/libs/pkg/authz"
	"github.com/aethercode/aethercode/libs/pkg/database"
	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
	"github.com/aethercode/aethercode/libs/pkg/pagination"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	uuidPattern       = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
	sha256Pattern     = regexp.MustCompile(`^[0-9a-f]{64}$`)
	languageIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._+:-]{0,79}$`)
)

// Page is one keyset page. NextCursor is empty on the final page.
type Page[T any] struct {
	Items      []T    `json:"items"`
	NextCursor string `json:"next_cursor,omitempty"`
}

// ListAttempts is a candidate-scoped attempt query. CandidateID is deliberately
// absent: the database binds rows to the signed context actor.
type ListAttempts struct {
	TenantID       string
	Limit          int
	CursorSort     string
	CursorID       string
	ExamVersionID  string
	LifecycleState string
}

// ListAnswerRevisions is a candidate-scoped answer-metadata query scoped to one
// attempt the caller must own.
type ListAnswerRevisions struct {
	TenantID   string
	AttemptID  string
	Limit      int
	CursorSort string
	CursorID   string
	ExamItemID string
}

// Store is implemented by the Submission PostgreSQL adapter. Every call runs
// within the request's fresh, signed authorization transaction.
type Store interface {
	StartAttempt(context.Context, pgx.Tx, StartAttempt) (Attempt, error)
	GetAttempt(context.Context, pgx.Tx, GetAttempt) (Attempt, error)
	GetAttemptIncludeDeleted(context.Context, pgx.Tx, GetAttempt) (Attempt, error)
	AppendAnswerRevision(context.Context, pgx.Tx, AppendAnswerRevision) (AnswerRevision, error)
	PrepareSubmission(context.Context, pgx.Tx, PrepareSubmission) ([]EvaluationPreparation, error)
	SubmitAttempt(context.Context, pgx.Tx, SubmitAttempt) (Attempt, error)
	CountEvaluationRequests(context.Context, pgx.Tx, GetAttempt) (int, error)
	SoftDeleteAttempt(context.Context, pgx.Tx, DeleteAttempt) error
	HardDeleteAttempt(context.Context, pgx.Tx, DeleteAttempt) error
	ListAttempts(context.Context, pgx.Tx, ListAttempts) ([]Attempt, error)
	ListAnswerRevisions(context.Context, pgx.Tx, ListAnswerRevisions) ([]AnswerRevision, error)
	GetAttemptUnitSummary(context.Context, pgx.Tx, GetAttempt) ([]AttemptUnitSummary, error)
	ListAttemptUnitResults(context.Context, pgx.Tx, GetAttempt) ([]AttemptUnitResults, error)
	Ping(context.Context) error
}

// AttemptUnitSummary is the candidate-safe outcome of one evaluated exam item.
// It carries counts only. Which unit number failed, and how long it ran, would
// describe a hidden test to the candidate who is still being graded on it.
type AttemptUnitSummary struct {
	ExamItemID          string `json:"exam_item_id"`
	EvaluationRequestID string `json:"evaluation_request_id"`
	PassedUnits         int    `json:"passed_units"`
	TotalUnits          int    `json:"total_units"`
}

// AttemptUnitResults is the reviewer view of one evaluated exam item. It is
// reachable only with a capability signed for submission.judge_receipts, which
// no candidate-scoped role can obtain.
type AttemptUnitResults struct {
	JudgeReceiptID      string        `json:"judge_receipt_id"`
	EvaluationRequestID string        `json:"evaluation_request_id"`
	ExamItemID          string        `json:"exam_item_id"`
	Verdict             string        `json:"verdict"`
	PassedUnits         int           `json:"passed_units"`
	TotalUnits          int           `json:"total_units"`
	Units               []AttemptUnit `json:"units"`
}

// AttemptUnit is one executed test case. Judge reports the normalized verdict
// and timing only; no captured output crosses the wrapper boundary.
type AttemptUnit struct {
	UnitNumber      int    `json:"unit_number"`
	Verdict         string `json:"verdict"`
	ExecutionTimeMS *int   `json:"execution_time_ms"`
	MemoryKiB       *int   `json:"memory_kib"`
}

// Attempt is the public, candidate-safe representation of one exam attempt.
type Attempt struct {
	ID                    string     `json:"id"`
	TenantID              string     `json:"tenant_id"`
	ExamID                string     `json:"exam_id"`
	ExamVersionID         string     `json:"exam_version_id"`
	CandidateID           string     `json:"candidate_id"`
	CandidateAssignmentID string     `json:"candidate_assignment_id"`
	AttemptNumber         int16      `json:"attempt_number"`
	LifecycleState        string     `json:"lifecycle_state"`
	AvailableFrom         time.Time  `json:"available_from"`
	SubmissionDeadline    time.Time  `json:"submission_deadline"`
	StartedAt             *time.Time `json:"started_at,omitempty"`
	SubmittedAt           *time.Time `json:"submitted_at,omitempty"`
	CompletedAt           *time.Time `json:"completed_at,omitempty"`
	LegalHold             bool       `json:"legal_hold"`
	Version               int64      `json:"version"`
	CreatedAt             time.Time  `json:"created_at"`
}

// AnswerRevision is append-only evidence of one candidate answer save.
type AnswerRevision struct {
	ID                     string    `json:"id"`
	TenantID               string    `json:"tenant_id"`
	AttemptID              string    `json:"attempt_id"`
	ExamItemID             string    `json:"exam_item_id"`
	RevisionNumber         int       `json:"revision_number"`
	LanguageID             string    `json:"language_id"`
	SourceObjectKey        string    `json:"source_object_key"`
	SourceChecksum         string    `json:"source_checksum"`
	EncryptionKeyReference string    `json:"encryption_key_reference"`
	CreatedAt              time.Time `json:"created_at"`
	CreatedBy              string    `json:"created_by"`
	AttemptVersion         int64     `json:"attempt_version"`
}

// EvaluationPreparation is read from the immutable assignment snapshot inside
// the submission transaction. It is not accepted from an HTTP client.
type EvaluationPreparation struct {
	AnswerRevisionID          string
	ExamItemID                string
	EvaluationBundleObjectKey string
	EvaluationBundleChecksum  string
	MaximumScore              string
}

// EvaluationRequest is the immutable work record handed to the platform-side
// Judge adapter through the durable outbox; it contains no platform foreign key
// in the Judge database.
type EvaluationRequest struct {
	ID                        string
	OutboxEventID             string
	AnswerRevisionID          string
	ExamItemID                string
	EvaluationBundleObjectKey string
	EvaluationBundleChecksum  string
	MaximumScore              string
	CallerIdempotencyKey      string
}

type StartAttempt struct {
	ID string
	// EventID is the append-only candidate audit event. OutboxEventID is
	// independently generated so the broker's de-duplication identity can
	// never collide with retained attempt evidence.
	EventID               string
	OutboxEventID         string
	TenantID              string
	CandidateAssignmentID string
	IdempotencyKey        string
	RequestChecksum       string
}

type GetAttempt struct {
	TenantID  string
	AttemptID string
}

type AppendAnswerRevision struct {
	ID                     string
	EventID                string
	TenantID               string
	AttemptID              string
	ExamItemID             string
	LanguageID             string
	SourceObjectKey        string
	SourceChecksum         string
	EncryptionKeyReference string
	ExpectedAttemptVersion int64
}

type PrepareSubmission struct {
	TenantID               string
	AttemptID              string
	ExpectedAttemptVersion int64
}

type SubmitAttempt struct {
	SubmittedEventID       string
	SubmittedOutboxEventID string
	GradingEventID         string
	TenantID               string
	AttemptID              string
	ExpectedAttemptVersion int64
	IdempotencyKey         string
	RequestChecksum        string
	EvaluationRequests     []EvaluationRequest
}

type DeleteAttempt struct {
	ID       string
	TenantID string
	ActorID  string
	Reason   string
}

// SubmitResult keeps the API response compact while exposing the durable amount
// of grading work accepted with the attempt.
type SubmitResult struct {
	Attempt                Attempt `json:"attempt"`
	EvaluationRequestCount int     `json:"evaluation_request_count"`
}

// Service owns validation, ID generation, and the one-transaction boundary for
// all candidate-facing Submission operations.
type Service struct {
	pool  *pgxpool.Pool
	store Store
}

func NewService(pool *pgxpool.Pool, store Store) (*Service, error) {
	if pool == nil || store == nil {
		return nil, fmt.Errorf("submission database pool and store are required")
	}
	return &Service{pool: pool, store: store}, nil
}

func (service *Service) StartAttempt(contextValue context.Context, capability centralauthz.Capability, command StartAttempt) (Attempt, error) {
	command.TenantID = normalizeUUID(command.TenantID)
	command.CandidateAssignmentID = normalizeUUID(command.CandidateAssignmentID)
	command.ID = normalizeUUID(command.ID)
	command.IdempotencyKey = strings.TrimSpace(command.IdempotencyKey)
	if !isUUID(command.TenantID) || !isUUID(command.CandidateAssignmentID) || !isUUID(command.ID) || !validIdempotencyKey(command.IdempotencyKey) {
		return Attempt{}, apperrors.New(apperrors.CodeInvalidArgument, "attempt start fields are invalid")
	}
	eventID, outboxEventID, err := newAttemptStartEventIDs()
	if err != nil {
		return Attempt{}, err
	}
	command.EventID = eventID
	command.OutboxEventID = outboxEventID
	command.RequestChecksum = checksum("attempt.start.v1", command.TenantID, command.CandidateAssignmentID)

	var attempt Attempt
	err = database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		var storeErr error
		attempt, storeErr = service.store.StartAttempt(contextValue, transaction, command)
		return storeErr
	})
	return attempt, err
}

func (service *Service) GetAttempt(contextValue context.Context, capability centralauthz.Capability, command GetAttempt) (Attempt, error) {
	command.TenantID = normalizeUUID(command.TenantID)
	command.AttemptID = normalizeUUID(command.AttemptID)
	if !isUUID(command.TenantID) || !isUUID(command.AttemptID) {
		return Attempt{}, apperrors.New(apperrors.CodeInvalidArgument, "tenant and attempt IDs must be UUIDs")
	}
	var attempt Attempt
	err := database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		var storeErr error
		attempt, storeErr = service.store.GetAttempt(contextValue, transaction, command)
		return storeErr
	})
	return attempt, err
}

// GetAttemptUnitSummary returns the redacted hidden-test counts for an attempt
// the calling candidate owns. Both collections below are bounded by the exam
// items in one attempt, so neither issues a cursor.
func (service *Service) GetAttemptUnitSummary(contextValue context.Context, capability centralauthz.Capability, command GetAttempt) (Page[AttemptUnitSummary], error) {
	command.TenantID = normalizeUUID(command.TenantID)
	command.AttemptID = normalizeUUID(command.AttemptID)
	if !isUUID(command.TenantID) || !isUUID(command.AttemptID) {
		return Page[AttemptUnitSummary]{}, apperrors.New(apperrors.CodeInvalidArgument, "tenant and attempt IDs must be UUIDs")
	}
	var summaries []AttemptUnitSummary
	err := database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		var storeErr error
		summaries, storeErr = service.store.GetAttemptUnitSummary(contextValue, transaction, command)
		return storeErr
	})
	if err != nil {
		return Page[AttemptUnitSummary]{}, err
	}
	return Page[AttemptUnitSummary]{Items: append([]AttemptUnitSummary{}, summaries...)}, nil
}

// ListAttemptUnitResults returns the full per-unit breakdown. The signed
// capability decides who may call it: the database routine requires one issued
// for submission.judge_receipts.
func (service *Service) ListAttemptUnitResults(contextValue context.Context, capability centralauthz.Capability, command GetAttempt) (Page[AttemptUnitResults], error) {
	command.TenantID = normalizeUUID(command.TenantID)
	command.AttemptID = normalizeUUID(command.AttemptID)
	if !isUUID(command.TenantID) || !isUUID(command.AttemptID) {
		return Page[AttemptUnitResults]{}, apperrors.New(apperrors.CodeInvalidArgument, "tenant and attempt IDs must be UUIDs")
	}
	var results []AttemptUnitResults
	err := database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		var storeErr error
		results, storeErr = service.store.ListAttemptUnitResults(contextValue, transaction, command)
		return storeErr
	})
	if err != nil {
		return Page[AttemptUnitResults]{}, err
	}
	return Page[AttemptUnitResults]{Items: append([]AttemptUnitResults{}, results...)}, nil
}

func (service *Service) AppendAnswerRevision(contextValue context.Context, capability centralauthz.Capability, command AppendAnswerRevision) (AnswerRevision, error) {
	command.TenantID = normalizeUUID(command.TenantID)
	command.AttemptID = normalizeUUID(command.AttemptID)
	command.ExamItemID = normalizeUUID(command.ExamItemID)
	command.ID = normalizeUUID(command.ID)
	command.LanguageID = strings.TrimSpace(command.LanguageID)
	command.SourceObjectKey = strings.TrimSpace(command.SourceObjectKey)
	command.SourceChecksum = strings.ToLower(strings.TrimSpace(command.SourceChecksum))
	command.EncryptionKeyReference = strings.TrimSpace(command.EncryptionKeyReference)
	if !isUUID(command.TenantID) || !isUUID(command.AttemptID) || !isUUID(command.ExamItemID) || !isUUID(command.ID) ||
		!languageIDPattern.MatchString(command.LanguageID) || !validText(command.SourceObjectKey, 2048) ||
		!sha256Pattern.MatchString(command.SourceChecksum) || !validText(command.EncryptionKeyReference, 1024) ||
		command.ExpectedAttemptVersion <= 0 {
		return AnswerRevision{}, apperrors.New(apperrors.CodeInvalidArgument, "answer revision fields are invalid")
	}
	eventID, err := database.NewUUIDv7()
	if err != nil {
		return AnswerRevision{}, err
	}
	command.EventID = eventID

	var revision AnswerRevision
	err = database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		var storeErr error
		revision, storeErr = service.store.AppendAnswerRevision(contextValue, transaction, command)
		return storeErr
	})
	return revision, err
}

func (service *Service) SubmitAttempt(contextValue context.Context, capability centralauthz.Capability, command SubmitAttempt) (SubmitResult, error) {
	command.TenantID = normalizeUUID(command.TenantID)
	command.AttemptID = normalizeUUID(command.AttemptID)
	command.IdempotencyKey = strings.TrimSpace(command.IdempotencyKey)
	if !isUUID(command.TenantID) || !isUUID(command.AttemptID) || command.ExpectedAttemptVersion <= 0 || !validIdempotencyKey(command.IdempotencyKey) {
		return SubmitResult{}, apperrors.New(apperrors.CodeInvalidArgument, "attempt submission fields are invalid")
	}
	submittedEventID, err := database.NewUUIDv7()
	if err != nil {
		return SubmitResult{}, err
	}
	submittedOutboxEventID, err := database.NewUUIDv7()
	if err != nil {
		return SubmitResult{}, err
	}
	gradingEventID, err := database.NewUUIDv7()
	if err != nil {
		return SubmitResult{}, err
	}
	command.SubmittedEventID = submittedEventID
	command.SubmittedOutboxEventID = submittedOutboxEventID
	command.GradingEventID = gradingEventID
	command.RequestChecksum = checksum("attempt.submit.v1", command.TenantID, command.AttemptID, fmt.Sprint(command.ExpectedAttemptVersion))

	var result SubmitResult
	err = database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		currentAttempt, currentErr := service.store.GetAttempt(contextValue, transaction, GetAttempt{
			TenantID: command.TenantID, AttemptID: command.AttemptID,
		})
		if currentErr != nil {
			return currentErr
		}
		if currentAttempt.LifecycleState == "submitted" {
			// Idempotent replay: already submitted, return current state.
			requestCount, countErr := service.store.CountEvaluationRequests(contextValue, transaction, GetAttempt{
				TenantID: command.TenantID, AttemptID: command.AttemptID,
			})
			if countErr != nil {
				return countErr
			}
			result = SubmitResult{Attempt: currentAttempt, EvaluationRequestCount: requestCount}
			return nil
		}
		if currentAttempt.LifecycleState != "active" {
			return apperrors.New(apperrors.CodeFailedPrecondition, "attempt cannot be submitted in state: "+currentAttempt.LifecycleState)
		}
		prepared, prepareErr := service.store.PrepareSubmission(contextValue, transaction, PrepareSubmission{
			TenantID: command.TenantID, AttemptID: command.AttemptID, ExpectedAttemptVersion: command.ExpectedAttemptVersion,
		})
		if prepareErr != nil {
			return prepareErr
		}
		if len(prepared) == 0 {
			return apperrors.New(apperrors.CodeConflict, "attempt has no evaluable answer revisions")
		}
		requests := make([]EvaluationRequest, 0, len(prepared))
		for _, item := range prepared {
			requestID, idErr := database.NewUUIDv7()
			if idErr != nil {
				return idErr
			}
			outboxEventID, idErr := database.NewUUIDv7()
			if idErr != nil {
				return idErr
			}
			requests = append(requests, EvaluationRequest{
				ID: requestID, OutboxEventID: outboxEventID,
				AnswerRevisionID: item.AnswerRevisionID, ExamItemID: item.ExamItemID,
				EvaluationBundleObjectKey: item.EvaluationBundleObjectKey,
				EvaluationBundleChecksum:  item.EvaluationBundleChecksum,
				MaximumScore:              item.MaximumScore,
				CallerIdempotencyKey:      "submission:" + item.AnswerRevisionID,
			})
		}
		command.EvaluationRequests = requests
		attempt, submitErr := service.store.SubmitAttempt(contextValue, transaction, command)
		if submitErr != nil {
			return submitErr
		}
		result = SubmitResult{Attempt: attempt, EvaluationRequestCount: len(requests)}
		return nil
	})
	return result, err
}

func checksum(parts ...string) string {
	hash := sha256.New()
	for _, part := range parts {
		_, _ = hash.Write([]byte(part))
		_, _ = hash.Write([]byte{0})
	}
	return hex.EncodeToString(hash.Sum(nil))
}

// newAttemptStartEventIDs deliberately keeps append-only audit evidence and
// the broker de-duplication identity separate. Both IDs are generated by the
// application as UUIDv7 values before the transaction begins.
func newAttemptStartEventIDs() (string, string, error) {
	auditEventID, err := database.NewUUIDv7()
	if err != nil {
		return "", "", err
	}
	for {
		outboxEventID, outboxErr := database.NewUUIDv7()
		if outboxErr != nil {
			return "", "", outboxErr
		}
		if outboxEventID != auditEventID {
			return auditEventID, outboxEventID, nil
		}
	}
}

func normalizeUUID(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func isUUID(value string) bool {
	return uuidPattern.MatchString(normalizeUUID(value))
}

func validIdempotencyKey(value string) bool {
	return validText(value, 255)
}

func validText(value string, maximum int) bool {
	length := len([]rune(strings.TrimSpace(value)))
	return length > 0 && length <= maximum
}

func (service *Service) ListAttempts(contextValue context.Context, capability centralauthz.Capability, command ListAttempts) (Page[Attempt], error) {
	var page Page[Attempt]
	err := database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		// Fetch one extra row to learn whether a further page exists without a
		// second count query.
		probe := command
		probe.Limit = command.Limit + 1
		attempts, err := service.store.ListAttempts(contextValue, transaction, probe)
		if err != nil {
			return err
		}
		page = buildAttemptPage(attempts, command.Limit)
		return nil
	})
	if err != nil {
		return Page[Attempt]{}, err
	}
	return page, nil
}

func buildAttemptPage(attempts []Attempt, limit int) Page[Attempt] {
	page := Page[Attempt]{Items: []Attempt{}}
	if len(attempts) > limit {
		attempts = attempts[:limit]
		last := attempts[len(attempts)-1]
		page.NextCursor = pagination.Encode(pagination.EncodeTime(last.CreatedAt), last.ID)
	}
	page.Items = append(page.Items, attempts...)
	return page
}

func (service *Service) ListAnswerRevisions(contextValue context.Context, capability centralauthz.Capability, command ListAnswerRevisions) (Page[AnswerRevision], error) {
	var page Page[AnswerRevision]
	err := database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		probe := command
		probe.Limit = command.Limit + 1
		revisions, err := service.store.ListAnswerRevisions(contextValue, transaction, probe)
		if err != nil {
			return err
		}
		page = buildAnswerRevisionPage(revisions, command.Limit)
		return nil
	})
	if err != nil {
		return Page[AnswerRevision]{}, err
	}
	return page, nil
}

func buildAnswerRevisionPage(revisions []AnswerRevision, limit int) Page[AnswerRevision] {
	page := Page[AnswerRevision]{Items: []AnswerRevision{}}
	if len(revisions) > limit {
		revisions = revisions[:limit]
		last := revisions[len(revisions)-1]
		page.NextCursor = pagination.Encode(pagination.EncodeTime(last.CreatedAt), last.ID)
	}
	page.Items = append(page.Items, revisions...)
	return page
}

// DeleteAttempt performs soft delete (default for all authorized roles).
// Authorization is enforced at the HTTP layer and via RLS.
func (service *Service) DeleteAttempt(contextValue context.Context, capability centralauthz.Capability, command DeleteAttempt) error {
	command.Reason = strings.TrimSpace(command.Reason)
	command.TenantID = normalizeUUID(command.TenantID)
	command.ID = normalizeUUID(command.ID)
	command.ActorID = normalizeUUID(command.ActorID)

	if !isUUID(command.TenantID) || !isUUID(command.ID) || !isUUID(command.ActorID) || command.Reason == "" {
		return apperrors.New(apperrors.CodeInvalidArgument, "attempt ID, tenant ID, actor ID, and deletion reason are required")
	}

	return database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		// Verify attempt exists
		_, err := service.store.GetAttempt(contextValue, transaction, GetAttempt{
			TenantID:  command.TenantID,
			AttemptID: command.ID,
		})
		if err != nil {
			return fmt.Errorf("get attempt: %w", err)
		}

		// Perform soft delete
		if err := service.store.SoftDeleteAttempt(contextValue, transaction, command); err != nil {
			return fmt.Errorf("soft delete attempt: %w", err)
		}

		return nil
	})
}

// HardDeleteAttempt permanently removes attempt (SuperAdmin only).
// Authorization is enforced at both HTTP layer and domain layer.
func (service *Service) HardDeleteAttempt(contextValue context.Context, capability centralauthz.Capability, command DeleteAttempt) error {
	command.Reason = strings.TrimSpace(command.Reason)
	command.TenantID = normalizeUUID(command.TenantID)
	command.ID = normalizeUUID(command.ID)
	command.ActorID = normalizeUUID(command.ActorID)

	if !isUUID(command.TenantID) || !isUUID(command.ID) || !isUUID(command.ActorID) || command.Reason == "" {
		return apperrors.New(apperrors.CodeInvalidArgument, "attempt ID, tenant ID, actor ID, and deletion reason are required")
	}

	return database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		// Verify attempt exists (including soft-deleted)
		attempt, err := service.store.GetAttemptIncludeDeleted(contextValue, transaction, GetAttempt{
			TenantID:  command.TenantID,
			AttemptID: command.ID,
		})
		if err != nil {
			return fmt.Errorf("get attempt: %w", err)
		}

		// Check legal hold - ADR-0007 mandates hold checks before deletion
		if attempt.LegalHold {
			return apperrors.New(apperrors.CodeFailedPrecondition, "cannot hard delete: attempt is under active legal hold")
		}

		// Perform hard delete
		if err := service.store.HardDeleteAttempt(contextValue, transaction, command); err != nil {
			return fmt.Errorf("hard delete attempt: %w", err)
		}

		return nil
	})
}
