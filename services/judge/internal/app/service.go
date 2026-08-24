// Package app contains Judge wrapper use cases and input invariants.
package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
)

var (
	ErrIdempotencyConflict = errors.New("idempotency key was previously used for a different execution")
	ErrLanguageUnavailable = errors.New("requested language is unavailable")
	ErrCompletionNotLeased = errors.New("completion is not currently leased to this consumer")
	ErrAdmissionNotLeased  = errors.New("admission is not currently leased to this publisher")
	ErrFanOutUnavailable   = errors.New("test-case fan-out storage or KMS is not configured on this instance")

	uuidV7Pattern   = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)
	sha256Pattern   = regexp.MustCompile(`^[0-9a-f]{64}$`)
	languagePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{0,127}$`)
)

// ValidationError identifies caller-supplied data that violates the stable
// Judge API contract.
type ValidationError struct {
	Field  string
	Reason string
}

func (errorValue *ValidationError) Error() string {
	return fmt.Sprintf("%s %s", errorValue.Field, errorValue.Reason)
}

// Limits are enforced by the wrapper before any engine work is admitted.
type Limits struct {
	CPUTimeMS  uint32
	WallTimeMS uint32
	Memory     uint64
	Processes  uint32
}

// SubmitExecution is the encrypted, engine-agnostic request accepted by the
// wrapper. TenantFairnessKey and SubmissionCorrelationID are opaque values;
// they are deliberately not platform foreign keys.
type SubmitExecution struct {
	IdempotencyKey          string
	TenantFairnessKey       string
	SubmissionCorrelationID string
	EvaluationBundleRef     string
	EvaluationBundleSHA256  string
	// EvaluationBundleKeyRef is the KMS key reference the evaluation bundle
	// was encrypted with. It is optional today because the SubmitExecution
	// wire contract (libs/proto/proto/aethercode/judge/v1/judge.proto) has no
	// field to carry it yet; a job admitted without one still passes
	// admission, but fan-out (see Postgres.Submit) fails with a real KMS
	// error rather than silently mis-decrypting the bundle.
	EvaluationBundleKeyRef string
	SourceCiphertextRef    string
	SourceCiphertextSHA256 string
	RequestCiphertextRef   string
	LanguageKey            string
	Limits                 Limits
	ExpiresAt              time.Time
}

// Execution is the durable acceptance result.
type Execution struct {
	ID     string
	Status string
}

// Completion is a lease-delivered terminal result. Result data remains in
// encrypted object storage; this structure has no score field.
type Completion struct {
	EventID                 string
	JobID                   string
	SubmissionCorrelationID string
	ResultRef               string
	ResultSHA256            string
	ResultEncryptionKeyRef  string
	Verdict                 string
	ExecutionTimeMS         *uint32
	MemoryKiB               *uint32
	DeliveryID              string
	LeaseID                 string
	CompletedAt             time.Time
}

// PullCompletedExecutions describes one consumer's bounded outbox lease.
type PullCompletedExecutions struct {
	ConsumerID   string
	Limit        uint32
	LeaseSeconds uint32
}

// AcknowledgeCompletion proves that the platform-side adapter durably
// persisted a leased completion.
type AcknowledgeCompletion struct {
	ConsumerID string
	EventID    string
	DeliveryID string
	LeaseID    string
}

// DeleteExecutionJob is the command for soft/hard delete operations.
type DeleteExecutionJob struct {
	ID      string
	ActorID string
	Reason  string
}

// Store is the persistence port for the wrapper control plane.
type Store interface {
	Submit(context.Context, SubmitExecution) (Execution, error)
	Pull(context.Context, PullCompletedExecutions) ([]Completion, error)
	Acknowledge(context.Context, AcknowledgeCompletion) error
	SoftDeleteExecutionJob(context.Context, DeleteExecutionJob) error
	HardDeleteExecutionJob(context.Context, DeleteExecutionJob) error
	Ping(context.Context) error
}

// Service coordinates durable wrapper operations.
type Service struct {
	store Store
	now   func() time.Time
}

// NewService creates a Judge application service.
func NewService(store Store) *Service {
	return &Service{store: store, now: time.Now}
}

// Submit validates then durably accepts one execution request.
func (service *Service) Submit(contextValue context.Context, request SubmitExecution) (Execution, error) {
	if err := request.Validate(service.now()); err != nil {
		return Execution{}, err
	}
	return service.store.Submit(contextValue, request)
}

// Pull validates lease limits then returns terminal completions atomically
// leased to one platform adapter.
func (service *Service) Pull(contextValue context.Context, request PullCompletedExecutions) ([]Completion, error) {
	if strings.TrimSpace(request.ConsumerID) == "" || len(request.ConsumerID) > 255 {
		return nil, &ValidationError{Field: "consumer_id", Reason: "must contain 1 to 255 characters"}
	}
	if request.Limit == 0 || request.Limit > 100 {
		return nil, &ValidationError{Field: "limit", Reason: "must be between 1 and 100"}
	}
	if request.LeaseSeconds < 5 || request.LeaseSeconds > 300 {
		return nil, &ValidationError{Field: "lease_seconds", Reason: "must be between 5 and 300"}
	}
	completions, err := service.store.Pull(contextValue, request)
	if err != nil {
		return nil, err
	}
	for _, completion := range completions {
		if err := completion.Validate(); err != nil {
			return nil, fmt.Errorf("validate persisted completion: %w", err)
		}
	}
	return completions, nil
}

// Acknowledge verifies the consumer's durable outbox acknowledgement.
func (service *Service) Acknowledge(contextValue context.Context, request AcknowledgeCompletion) error {
	if strings.TrimSpace(request.ConsumerID) == "" || len(request.ConsumerID) > 255 {
		return &ValidationError{Field: "consumer_id", Reason: "must contain 1 to 255 characters"}
	}
	for field, value := range map[string]string{
		"event_id": request.EventID, "delivery_id": request.DeliveryID, "lease_id": request.LeaseID,
	} {
		if !isUUIDv7(value) {
			return &ValidationError{Field: field, Reason: "must be a UUIDv7"}
		}
	}
	return service.store.Acknowledge(contextValue, request)
}

// Validate rejects a request before it consumes a PostgreSQL transaction or a
// RabbitMQ slot.
func (request SubmitExecution) Validate(now time.Time) error {
	if strings.TrimSpace(request.IdempotencyKey) == "" || len(request.IdempotencyKey) > 255 {
		return &ValidationError{Field: "idempotency_key", Reason: "must contain 1 to 255 characters"}
	}
	if strings.TrimSpace(request.TenantFairnessKey) == "" || len(request.TenantFairnessKey) > 255 {
		return &ValidationError{Field: "tenant_fairness_key", Reason: "must contain 1 to 255 characters"}
	}
	if !isUUIDv7(request.SubmissionCorrelationID) {
		return &ValidationError{Field: "submission_correlation_id", Reason: "must be a UUIDv7"}
	}
	for field, value := range map[string]string{
		"evaluation_bundle_ref":  request.EvaluationBundleRef,
		"source_ciphertext_ref":  request.SourceCiphertextRef,
		"request_ciphertext_ref": request.RequestCiphertextRef,
	} {
		if strings.TrimSpace(value) == "" || len(value) > 2048 {
			return &ValidationError{Field: field, Reason: "must contain 1 to 2048 characters"}
		}
	}
	for field, value := range map[string]string{
		"evaluation_bundle_sha256": request.EvaluationBundleSHA256,
		"source_ciphertext_sha256": request.SourceCiphertextSHA256,
	} {
		if !sha256Pattern.MatchString(value) {
			return &ValidationError{Field: field, Reason: "must be a lowercase SHA-256 checksum"}
		}
	}
	if !languagePattern.MatchString(request.LanguageKey) {
		return &ValidationError{Field: "language_key", Reason: "must be a supported lowercase language key"}
	}
	if request.Limits.CPUTimeMS == 0 || request.Limits.CPUTimeMS > 60000 {
		return &ValidationError{Field: "limits.cpu_time_ms", Reason: "must be between 1 and 60000"}
	}
	if request.Limits.WallTimeMS == 0 || request.Limits.WallTimeMS > 120000 || request.Limits.WallTimeMS < request.Limits.CPUTimeMS {
		return &ValidationError{Field: "limits.wall_time_ms", Reason: "must be between CPU time and 120000"}
	}
	if request.Limits.Memory < 1048576 || request.Limits.Memory > 2147483648 {
		return &ValidationError{Field: "limits.memory_bytes", Reason: "must be between 1048576 and 2147483648"}
	}
	if request.Limits.Processes == 0 || request.Limits.Processes > 256 {
		return &ValidationError{Field: "limits.process_limit", Reason: "must be between 1 and 256"}
	}
	if request.ExpiresAt.IsZero() || !request.ExpiresAt.After(now) || request.ExpiresAt.After(now.Add(24*time.Hour)) {
		return &ValidationError{Field: "expires_at", Reason: "must be within the next 24 hours"}
	}
	return nil
}

// Fingerprint canonically binds a caller idempotency key to request content.
func (request SubmitExecution) Fingerprint() (string, error) {
	payload, err := json.Marshal(struct {
		TenantFairnessKey       string `json:"tenant_fairness_key"`
		SubmissionCorrelationID string `json:"submission_correlation_id"`
		EvaluationBundleRef     string `json:"evaluation_bundle_ref"`
		EvaluationBundleSHA256  string `json:"evaluation_bundle_sha256"`
		EvaluationBundleKeyRef  string `json:"evaluation_bundle_key_ref"`
		SourceCiphertextRef     string `json:"source_ciphertext_ref"`
		SourceCiphertextSHA256  string `json:"source_ciphertext_sha256"`
		RequestCiphertextRef    string `json:"request_ciphertext_ref"`
		LanguageKey             string `json:"language_key"`
		Limits                  Limits `json:"limits"`
		ExpiresAt               string `json:"expires_at"`
	}{
		TenantFairnessKey:       request.TenantFairnessKey,
		SubmissionCorrelationID: request.SubmissionCorrelationID,
		EvaluationBundleRef:     request.EvaluationBundleRef,
		EvaluationBundleSHA256:  request.EvaluationBundleSHA256,
		EvaluationBundleKeyRef:  request.EvaluationBundleKeyRef,
		SourceCiphertextRef:     request.SourceCiphertextRef,
		SourceCiphertextSHA256:  request.SourceCiphertextSHA256,
		RequestCiphertextRef:    request.RequestCiphertextRef,
		LanguageKey:             request.LanguageKey,
		Limits:                  request.Limits,
		ExpiresAt:               request.ExpiresAt.UTC().Format(time.RFC3339Nano),
	})
	if err != nil {
		return "", fmt.Errorf("encode execution fingerprint: %w", err)
	}
	digest := sha256.Sum256(payload)
	return hex.EncodeToString(digest[:]), nil
}

// Validate proves that a terminal wrapper completion can cross the private
// mTLS boundary without carrying execution contents. Result references are an
// all-or-none encrypted object tuple; the wrapper never returns source, tests,
// plaintext output, or a score.
func (completion Completion) Validate() error {
	for field, value := range map[string]string{
		"event_id":                  completion.EventID,
		"job_id":                    completion.JobID,
		"submission_correlation_id": completion.SubmissionCorrelationID,
		"delivery_id":               completion.DeliveryID,
		"lease_id":                  completion.LeaseID,
	} {
		if !isUUIDv7(value) {
			return &ValidationError{Field: field, Reason: "must be a UUIDv7"}
		}
	}
	if completion.CompletedAt.IsZero() {
		return &ValidationError{Field: "completed_at", Reason: "is required"}
	}
	if !isCompletionVerdict(completion.Verdict) {
		return &ValidationError{Field: "verdict", Reason: "is unsupported"}
	}
	if (completion.ExecutionTimeMS != nil && uint64(*completion.ExecutionTimeMS) > 2147483647) ||
		(completion.MemoryKiB != nil && uint64(*completion.MemoryKiB) > 2147483647) {
		return &ValidationError{Field: "metrics", Reason: "must fit Submission's signed integer range"}
	}

	resultFields := []string{
		strings.TrimSpace(completion.ResultRef),
		strings.TrimSpace(completion.ResultSHA256),
		strings.TrimSpace(completion.ResultEncryptionKeyRef),
	}
	present := resultFields[0] != ""
	for _, value := range resultFields[1:] {
		if (value != "") != present {
			return &ValidationError{Field: "encrypted_result", Reason: "reference, checksum, and key reference must be all-or-none"}
		}
	}
	if !present {
		return nil
	}
	if len(resultFields[0]) > 2048 || len(resultFields[2]) > 1024 || !sha256Pattern.MatchString(resultFields[1]) {
		return &ValidationError{Field: "encrypted_result", Reason: "is invalid"}
	}
	return nil
}

// DeleteExecutionJob soft-deletes a job with audit trail.
func (service *Service) DeleteExecutionJob(contextValue context.Context, command DeleteExecutionJob) error {
	if !isUUIDv7(command.ID) {
		return &ValidationError{Field: "id", Reason: "must be a UUIDv7"}
	}
	if !isUUIDv7(command.ActorID) {
		return &ValidationError{Field: "actor_id", Reason: "must be a UUIDv7"}
	}
	if strings.TrimSpace(command.Reason) == "" {
		return &ValidationError{Field: "reason", Reason: "deletion reason is required"}
	}
	return service.store.SoftDeleteExecutionJob(contextValue, command)
}

// HardDeleteExecutionJob permanently removes a job (SuperAdmin only).
func (service *Service) HardDeleteExecutionJob(contextValue context.Context, command DeleteExecutionJob) error {
	if !isUUIDv7(command.ID) {
		return &ValidationError{Field: "id", Reason: "must be a UUIDv7"}
	}
	if !isUUIDv7(command.ActorID) {
		return &ValidationError{Field: "actor_id", Reason: "must be a UUIDv7"}
	}
	if strings.TrimSpace(command.Reason) == "" {
		return &ValidationError{Field: "reason", Reason: "deletion reason is required"}
	}
	return service.store.HardDeleteExecutionJob(contextValue, command)
}

func isCompletionVerdict(value string) bool {
	switch value {
	case "accepted", "wrong_answer", "time_limit_exceeded", "memory_limit_exceeded",
		"runtime_error", "compile_error", "internal_error", "cancelled":
		return true
	default:
		return false
	}
}

func isUUIDv7(value string) bool {
	return uuidV7Pattern.MatchString(strings.ToLower(strings.TrimSpace(value)))
}
