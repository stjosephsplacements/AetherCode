// Package app contains the SEB security workflows. It accepts only encrypted
// configuration references and one-way hashes; plaintext SEB material is never
// persisted or emitted in an event.
package app

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"regexp"
	"strings"
	"time"

	centralauthz "github.com/aethercode/aethercode/libs/pkg/authz"
	"github.com/aethercode/aethercode/libs/pkg/database"
	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
	"github.com/aethercode/aethercode/libs/pkg/kms"
	"github.com/aethercode/aethercode/libs/pkg/pagination"
	"github.com/aethercode/aethercode/libs/pkg/storage"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	uuidPattern      = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
	checksumPattern  = regexp.MustCompile(`^[0-9a-f]{64}$`)
	objectKeyPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._/=-]*$`)
)

// Configuration is safe metadata for an encrypted SEB configuration object.
// Key hashes intentionally do not leave the service after creation.
type Configuration struct {
	ID                   string    `json:"id"`
	TenantID             string    `json:"tenant_id"`
	ExamID               string    `json:"exam_id"`
	ExamVersionID        string    `json:"exam_version_id"`
	ConfigurationVersion int       `json:"configuration_version"`
	ConfigObjectKey      string    `json:"config_object_key"`
	ConfigChecksum       string    `json:"config_checksum"`
	EncryptionKeyRef     string    `json:"encryption_key_reference"`
	LifecycleState       string    `json:"lifecycle_state"`
	CreatedBy            string    `json:"created_by"`
	CreatedAt            time.Time `json:"created_at"`
}

// Session is an attempt-bound SEB session. The quit token hash is never
// exposed; the raw quit token is returned exactly once during issuance.
type Session struct {
	ID              string     `json:"id"`
	TenantID        string     `json:"tenant_id"`
	ConfigurationID string     `json:"configuration_id"`
	AttemptID       string     `json:"attempt_id"`
	CandidateID     string     `json:"candidate_id"`
	LifecycleState  string     `json:"lifecycle_state"`
	IssuedAt        time.Time  `json:"issued_at"`
	ActivatedAt     *time.Time `json:"activated_at,omitempty"`
	ClosedAt        *time.Time `json:"closed_at,omitempty"`
	ExpiresAt       time.Time  `json:"expires_at"`
	ClosedReason    string     `json:"closed_reason,omitempty"`
	Version         int64      `json:"version"`
}

// IssuedSession carries the single-use raw quit token only in the synchronous
// response to a successful issuance request. Callers must deliver it through
// their protected exam-session channel and must not log it.
type IssuedSession struct {
	Session   Session `json:"session"`
	QuitToken string  `json:"quit_token"`
}

// ValidationResult is the internal persistence result. The HTTP adapter emits
// only its disposition/header/time fields, never these session identifiers,
// configuration material, or the expected hash.
type ValidationResult struct {
	SessionID        string    `json:"session_id"`
	ConfigurationID  string    `json:"configuration_id"`
	AttemptID        string    `json:"attempt_id"`
	HeaderKind       string    `json:"header_kind"`
	ValidationResult string    `json:"validation_result"`
	OccurredAt       time.Time `json:"occurred_at"`
}

type CreateConfiguration struct {
	ID                   string
	TenantID             string
	ExamID               string
	ExamVersionID        string
	ConfigurationVersion int
	ConfigObjectKey      string
	ConfigChecksum       string
	EncryptionKeyRef     string
	ConfigKeyHash        string
	BrowserExamKeyHash   string
	CreatedBy            string
	EventID              string
	IdempotencyKey       string
	RequestHash          string
}

type RotateConfiguration struct {
	PreviousConfigurationID string
	ReplacementID           string
	RotationID              string
	EventID                 string
	TenantID                string
	ExamID                  string
	ExamVersionID           string
	ConfigurationVersion    int
	ConfigObjectKey         string
	ConfigChecksum          string
	EncryptionKeyRef        string
	ConfigKeyHash           string
	BrowserExamKeyHash      string
	Reason                  string
	RotatedBy               string
	IdempotencyKey          string
	RequestHash             string
}

type RevokeConfiguration struct {
	ID             string
	TenantID       string
	Reason         string
	RevokedBy      string
	EventID        string
	IdempotencyKey string
	RequestHash    string
}

type IssueSession struct {
	ID              string
	EventID         string
	TenantID        string
	ConfigurationID string
	AttemptID       string
	CandidateID     string
	ExpiresAt       time.Time
	QuitTokenHash   string
	IdempotencyKey  string
	RequestHash     string
}

type CloseSession struct {
	ID              string
	TenantID        string
	ExpectedVersion int64
	Reason          string
	EventID         string
	IdempotencyKey  string
	RequestHash     string
}

type ValidateSessionHeader struct {
	ValidationEventID      string
	TenantID               string
	SessionID              string
	HeaderKind             string
	HeaderPresent          bool
	PresentedHeaderHash    string
	RequestFingerprintHash string
}

// Page is one keyset page. NextCursor is empty on the final page.
type Page[T any] struct {
	Items      []T    `json:"items"`
	NextCursor string `json:"next_cursor,omitempty"`
}

// ListSessions is candidate-scoped; the database binds rows to the signed actor.
type ListSessions struct {
	TenantID       string
	Limit          int
	CursorSort     string
	CursorID       string
	LifecycleState string
}

// ListConfigurations is staff-scoped and relies on tenant RLS.
type ListConfigurations struct {
	TenantID       string
	Limit          int
	CursorSort     string
	CursorID       string
	LifecycleState string
}

// DeleteConfiguration is the command for soft/hard delete operations.
type DeleteConfiguration struct {
	ID       string
	TenantID string
	ActorID  string
	Reason   string
}

// Store supplies SEB persistence. The adapter uses security-definer database
// procedures for multi-table state transitions so one signed RLS context is
// never widened into broad table access.
type Store interface {
	CreateConfiguration(context.Context, pgx.Tx, CreateConfiguration) (Configuration, error)
	GetConfiguration(context.Context, pgx.Tx, string, string) (Configuration, error)
	RotateConfiguration(context.Context, pgx.Tx, RotateConfiguration) (Configuration, error)
	RevokeConfiguration(context.Context, pgx.Tx, RevokeConfiguration) (Configuration, error)
	IssueSession(context.Context, pgx.Tx, IssueSession) (Session, error)
	GetSession(context.Context, pgx.Tx, string, string) (Session, error)
	CloseSession(context.Context, pgx.Tx, CloseSession) (Session, error)
	ValidateSessionHeader(context.Context, pgx.Tx, ValidateSessionHeader) (ValidationResult, error)
	ListSessions(context.Context, pgx.Tx, ListSessions) ([]Session, error)
	ListConfigurations(context.Context, pgx.Tx, ListConfigurations) ([]Configuration, error)
	SoftDeleteConfiguration(context.Context, pgx.Tx, DeleteConfiguration) error
	HardDeleteConfiguration(context.Context, pgx.Tx, DeleteConfiguration) error
	Ping(context.Context) error
}

type Service struct {
	pool        *pgxpool.Pool
	store       Store
	idempotency *database.IdempotencyStore
	now         func() time.Time
	storage     storage.Object
	kms         kms.KeyManager
}

// GetConfigurationPayload identifies a SEB configuration whose payload to
// decrypt and return.
type GetConfigurationPayload struct {
	TenantID        string
	ConfigurationID string
}

// NewService creates a new SEB service. storage and kms may both be nil;
// the payload endpoint returns 503 Unavailable until they are wired.
func NewService(pool *pgxpool.Pool, store Store, storage storage.Object, kms kms.KeyManager) (*Service, error) {
	if pool == nil || store == nil {
		return nil, fmt.Errorf("SEB database pool and store are required")
	}
	idempotency, err := database.NewIdempotencyStore("app.idempotency_keys")
	if err != nil {
		return nil, err
	}
	return &Service{pool: pool, store: store, idempotency: idempotency, now: time.Now, storage: storage, kms: kms}, nil
}

func (service *Service) CreateConfiguration(ctx context.Context, capability centralauthz.Capability, command CreateConfiguration) (Configuration, error) {
	if err := validateConfiguration(command.ID, command.TenantID, command.ExamID, command.ExamVersionID, command.ConfigurationVersion, command.ConfigObjectKey, command.ConfigChecksum, command.EncryptionKeyRef, command.ConfigKeyHash, command.BrowserExamKeyHash, command.CreatedBy); err != nil {
		return Configuration{}, err
	}
	if !isUUID(command.EventID) {
		return Configuration{}, invalid("event ID is invalid")
	}
	if err := validateIdempotency(command.IdempotencyKey, command.RequestHash); err != nil {
		return Configuration{}, err
	}
	var result Configuration
	err := database.WithTenantTx(ctx, service.pool, capability, func(transaction pgx.Tx) error {
		operation, err := scopedIdempotencyOperation(capability, command.TenantID, "seb.configuration.create", "")
		if err != nil {
			return err
		}
		claim, err := service.claimIdempotency(ctx, transaction, capability, command.TenantID, operation, command.IdempotencyKey, command.RequestHash)
		if err != nil {
			return err
		}
		if !claim.Acquired {
			return decodeReplay(claim, 201, &result)
		}
		result, err = service.store.CreateConfiguration(ctx, transaction, command)
		if err != nil {
			return err
		}
		return service.completeIdempotency(ctx, transaction, capability, command.TenantID, operation, command.IdempotencyKey, 201, result)
	})
	return result, err
}

func (service *Service) GetConfiguration(ctx context.Context, capability centralauthz.Capability, tenantID, configurationID string) (Configuration, error) {
	if !isUUID(tenantID) || !isUUID(configurationID) {
		return Configuration{}, invalid("tenant or configuration ID is invalid")
	}
	var result Configuration
	err := database.WithTenantTx(ctx, service.pool, capability, func(transaction pgx.Tx) error {
		var err error
		result, err = service.store.GetConfiguration(ctx, transaction, tenantID, configurationID)
		return err
	})
	return result, err
}

func (service *Service) RotateConfiguration(ctx context.Context, capability centralauthz.Capability, command RotateConfiguration) (Configuration, error) {
	if err := validateConfiguration(command.ReplacementID, command.TenantID, command.ExamID, command.ExamVersionID, command.ConfigurationVersion, command.ConfigObjectKey, command.ConfigChecksum, command.EncryptionKeyRef, command.ConfigKeyHash, command.BrowserExamKeyHash, command.RotatedBy); err != nil {
		return Configuration{}, err
	}
	if !isUUID(command.PreviousConfigurationID) || !isUUID(command.RotationID) || !isUUID(command.EventID) || !validLength(command.Reason, 1, 500) {
		return Configuration{}, invalid("rotation fields are invalid")
	}
	if err := validateIdempotency(command.IdempotencyKey, command.RequestHash); err != nil {
		return Configuration{}, err
	}
	var result Configuration
	err := database.WithTenantTx(ctx, service.pool, capability, func(transaction pgx.Tx) error {
		operation, err := scopedIdempotencyOperation(capability, command.TenantID, "seb.configuration.rotate", command.PreviousConfigurationID)
		if err != nil {
			return err
		}
		claim, err := service.claimIdempotency(ctx, transaction, capability, command.TenantID, operation, command.IdempotencyKey, command.RequestHash)
		if err != nil {
			return err
		}
		if !claim.Acquired {
			return decodeReplay(claim, 201, &result)
		}
		result, err = service.store.RotateConfiguration(ctx, transaction, command)
		if err != nil {
			return err
		}
		return service.completeIdempotency(ctx, transaction, capability, command.TenantID, operation, command.IdempotencyKey, 201, result)
	})
	return result, err
}

func (service *Service) RevokeConfiguration(ctx context.Context, capability centralauthz.Capability, command RevokeConfiguration) (Configuration, error) {
	if !isUUID(command.ID) || !isUUID(command.TenantID) || !isUUID(command.RevokedBy) || !isUUID(command.EventID) || !validLength(command.Reason, 1, 500) {
		return Configuration{}, invalid("configuration revocation fields are invalid")
	}
	if err := validateIdempotency(command.IdempotencyKey, command.RequestHash); err != nil {
		return Configuration{}, err
	}
	var result Configuration
	err := database.WithTenantTx(ctx, service.pool, capability, func(transaction pgx.Tx) error {
		operation, err := scopedIdempotencyOperation(capability, command.TenantID, "seb.configuration.revoke", command.ID)
		if err != nil {
			return err
		}
		claim, err := service.claimIdempotency(ctx, transaction, capability, command.TenantID, operation, command.IdempotencyKey, command.RequestHash)
		if err != nil {
			return err
		}
		if !claim.Acquired {
			return decodeReplay(claim, 200, &result)
		}
		result, err = service.store.RevokeConfiguration(ctx, transaction, command)
		if err != nil {
			return err
		}
		return service.completeIdempotency(ctx, transaction, capability, command.TenantID, operation, command.IdempotencyKey, 200, result)
	})
	return result, err
}

func (service *Service) IssueSession(ctx context.Context, capability centralauthz.Capability, command IssueSession) (IssuedSession, error) {
	if !isUUID(command.ID) || !isUUID(command.EventID) || !isUUID(command.TenantID) || !isUUID(command.ConfigurationID) || !isUUID(command.AttemptID) || !isUUID(command.CandidateID) {
		return IssuedSession{}, invalid("session IDs are invalid")
	}
	now := service.now().UTC()
	if command.ExpiresAt.IsZero() || !command.ExpiresAt.After(now) || command.ExpiresAt.After(now.Add(24*time.Hour)) {
		return IssuedSession{}, invalid("session expiry must be within the next 24 hours")
	}
	if err := validateIdempotency(command.IdempotencyKey, command.RequestHash); err != nil {
		return IssuedSession{}, err
	}
	var result Session
	var quitToken string
	err := database.WithTenantTx(ctx, service.pool, capability, func(transaction pgx.Tx) error {
		operation, err := scopedIdempotencyOperation(capability, command.TenantID, "seb.session.issue", "")
		if err != nil {
			return err
		}
		claim, err := service.claimIdempotency(ctx, transaction, capability, command.TenantID, operation, command.IdempotencyKey, command.RequestHash)
		if err != nil {
			return err
		}
		if !claim.Acquired {
			return rejectIssuedSessionReplay(claim)
		}
		var tokenHash string
		quitToken, tokenHash, err = newQuitToken()
		if err != nil {
			return err
		}
		command.QuitTokenHash = tokenHash
		var issueErr error
		result, issueErr = service.store.IssueSession(ctx, transaction, command)
		if issueErr != nil {
			return issueErr
		}
		// The one-time raw quit token is intentionally excluded from the durable
		// idempotency response. A successful retry cannot recover or re-emit it.
		return service.completeIdempotency(ctx, transaction, capability, command.TenantID, operation, command.IdempotencyKey, 201, issuedSessionReplay{Session: result})
	})
	if err != nil {
		return IssuedSession{}, err
	}
	return IssuedSession{Session: result, QuitToken: quitToken}, nil
}

func (service *Service) GetSession(ctx context.Context, capability centralauthz.Capability, tenantID, sessionID string) (Session, error) {
	if !isUUID(tenantID) || !isUUID(sessionID) {
		return Session{}, invalid("tenant or session ID is invalid")
	}
	var result Session
	err := database.WithTenantTx(ctx, service.pool, capability, func(transaction pgx.Tx) error {
		var err error
		result, err = service.store.GetSession(ctx, transaction, tenantID, sessionID)
		return err
	})
	return result, err
}

func (service *Service) CloseSession(ctx context.Context, capability centralauthz.Capability, command CloseSession) (Session, error) {
	if !isUUID(command.ID) || !isUUID(command.TenantID) || !isUUID(command.EventID) || command.ExpectedVersion < 1 || !validLength(command.Reason, 1, 500) {
		return Session{}, invalid("session close fields are invalid")
	}
	if err := validateIdempotency(command.IdempotencyKey, command.RequestHash); err != nil {
		return Session{}, err
	}
	var result Session
	err := database.WithTenantTx(ctx, service.pool, capability, func(transaction pgx.Tx) error {
		operation, err := scopedIdempotencyOperation(capability, command.TenantID, "seb.session.close", command.ID)
		if err != nil {
			return err
		}
		claim, err := service.claimIdempotency(ctx, transaction, capability, command.TenantID, operation, command.IdempotencyKey, command.RequestHash)
		if err != nil {
			return err
		}
		if !claim.Acquired {
			return decodeReplay(claim, 200, &result)
		}
		result, err = service.store.CloseSession(ctx, transaction, command)
		if err != nil {
			return err
		}
		return service.completeIdempotency(ctx, transaction, capability, command.TenantID, operation, command.IdempotencyKey, 200, result)
	})
	return result, err
}

func (service *Service) ValidateSessionHeader(ctx context.Context, capability centralauthz.Capability, command ValidateSessionHeader) (ValidationResult, error) {
	if !isUUID(command.ValidationEventID) || !isUUID(command.TenantID) || !isUUID(command.SessionID) || !validHeaderKind(command.HeaderKind) || !isChecksum(command.RequestFingerprintHash) {
		return ValidationResult{}, invalid("SEB validation fields are invalid")
	}
	if command.HeaderPresent {
		if strings.TrimSpace(command.PresentedHeaderHash) == "" {
			return ValidationResult{}, invalid("present header requires a hash")
		}
		command.PresentedHeaderHash = strings.ToLower(strings.TrimSpace(command.PresentedHeaderHash))
		if !isChecksum(command.PresentedHeaderHash) {
			return ValidationResult{}, invalid("presented header hash is invalid")
		}
	} else if strings.TrimSpace(command.PresentedHeaderHash) != "" {
		return ValidationResult{}, invalid("absent header cannot include a hash")
	}
	var result ValidationResult
	err := database.WithTenantTx(ctx, service.pool, capability, func(transaction pgx.Tx) error {
		var err error
		result, err = service.store.ValidateSessionHeader(ctx, transaction, command)
		return err
	})
	return result, err
}

// HashHeaderValue keeps the raw header outside persistence and SQL parameters.
func HashHeaderValue(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func newQuitToken() (string, string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", "", fmt.Errorf("generate SEB quit token: %w", err)
	}
	token := base64.RawURLEncoding.EncodeToString(raw)
	return token, HashHeaderValue(token), nil
}

// issuedSessionReplay is the only durable result for a successful session
// issuance. It deliberately omits the raw quit token, which is returned once
// over the initial no-store response and is never recoverable from the API.
type issuedSessionReplay struct {
	Session Session `json:"session"`
}

func (service *Service) claimIdempotency(
	ctx context.Context,
	transaction pgx.Tx,
	capability centralauthz.Capability,
	commandTenantID, operation, key, requestHash string,
) (database.IdempotencyRecord, error) {
	if service == nil || service.idempotency == nil {
		return database.IdempotencyRecord{}, fmt.Errorf("SEB idempotency store is not initialized")
	}
	if !strings.EqualFold(strings.TrimSpace(capability.TenantID), strings.TrimSpace(commandTenantID)) {
		return database.IdempotencyRecord{}, apperrors.New(apperrors.CodeForbidden, "authorization tenant scope does not match request")
	}
	return service.idempotency.Claim(
		ctx, transaction, capability.TenantID, operation, key, requestHash,
		service.now().UTC().Add(24*time.Hour),
	)
}

func (service *Service) completeIdempotency(
	ctx context.Context,
	transaction pgx.Tx,
	capability centralauthz.Capability,
	commandTenantID, operation, key string,
	status int,
	response any,
) error {
	if service == nil || service.idempotency == nil {
		return fmt.Errorf("SEB idempotency store is not initialized")
	}
	if !strings.EqualFold(strings.TrimSpace(capability.TenantID), strings.TrimSpace(commandTenantID)) {
		return apperrors.New(apperrors.CodeForbidden, "authorization tenant scope does not match request")
	}
	encoded, err := marshalSafeIdempotencyResponse(response)
	if err != nil {
		return err
	}
	return service.idempotency.Complete(ctx, transaction, capability.TenantID, operation, key, status, encoded)
}

func scopedIdempotencyOperation(capability centralauthz.Capability, tenantID, operation, resourceID string) (string, error) {
	actorID := strings.ToLower(strings.TrimSpace(capability.ActorID))
	if !isUUID(actorID) {
		return "", apperrors.New(apperrors.CodeForbidden, "authorization actor is invalid")
	}
	if !strings.EqualFold(strings.TrimSpace(capability.TenantID), strings.TrimSpace(tenantID)) {
		return "", apperrors.New(apperrors.CodeForbidden, "authorization tenant scope does not match request")
	}
	operation = strings.TrimSpace(operation) + ":" + actorID
	if resourceID != "" {
		resourceID = strings.ToLower(strings.TrimSpace(resourceID))
		if !isUUID(resourceID) {
			return "", invalid("idempotency resource ID is invalid")
		}
		operation += ":" + resourceID
	}
	if len(operation) > 160 {
		return "", fmt.Errorf("SEB idempotency operation exceeds storage limit")
	}
	return operation, nil
}

func validateIdempotency(key, requestHash string) error {
	if len(key) == 0 || len(key) > 255 {
		return invalid("Idempotency-Key is required and must contain 1 to 255 printable characters")
	}
	for _, character := range key {
		if character < '!' || character > '~' {
			return invalid("Idempotency-Key is required and must contain 1 to 255 printable characters")
		}
	}
	if !isChecksum(strings.ToLower(strings.TrimSpace(requestHash))) {
		return invalid("idempotency request hash is invalid")
	}
	return nil
}

func decodeReplay[T any](claim database.IdempotencyRecord, expectedStatus int, destination *T) error {
	if claim.State != database.IdempotencyCompleted || claim.ResponseStatus != expectedStatus || !json.Valid(claim.ResponseBody) {
		return apperrors.New(apperrors.CodeConflict, "idempotency key is still in progress or did not complete")
	}
	if err := json.Unmarshal(claim.ResponseBody, destination); err != nil {
		return fmt.Errorf("decode idempotent SEB response: %w", err)
	}
	return nil
}

// DeleteConfiguration soft-deletes a SEB configuration with audit trail.
func (service *Service) DeleteConfiguration(ctx context.Context, capability centralauthz.Capability, command DeleteConfiguration) error {
	command.ID, command.TenantID = strings.ToLower(strings.TrimSpace(command.ID)), strings.ToLower(strings.TrimSpace(command.TenantID))
	command.ActorID = strings.ToLower(strings.TrimSpace(command.ActorID))
	command.Reason = strings.TrimSpace(command.Reason)
	if !isUUID(command.ID) || !isUUID(command.TenantID) || !isUUID(command.ActorID) || command.Reason == "" {
		return invalid("configuration ID, tenant ID, actor ID, and deletion reason are required")
	}
	return database.WithTenantTx(ctx, service.pool, capability, func(transaction pgx.Tx) error {
		return service.store.SoftDeleteConfiguration(ctx, transaction, command)
	})
}

func (service *Service) ListSessions(contextValue context.Context, capability centralauthz.Capability, command ListSessions) (Page[Session], error) {
	var page Page[Session]
	err := database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		probe := command
		probe.Limit = command.Limit + 1
		sessions, err := service.store.ListSessions(contextValue, transaction, probe)
		if err != nil {
			return err
		}
		page = Page[Session]{Items: []Session{}}
		if len(sessions) > command.Limit {
			sessions = sessions[:command.Limit]
			last := sessions[len(sessions)-1]
			page.NextCursor = pagination.Encode(pagination.EncodeTime(last.IssuedAt), last.ID)
		}
		page.Items = append(page.Items, sessions...)
		return nil
	})
	if err != nil {
		return Page[Session]{}, err
	}
	return page, nil
}

func (service *Service) ListConfigurations(contextValue context.Context, capability centralauthz.Capability, command ListConfigurations) (Page[Configuration], error) {
	if command.CursorSort != "" {
		if _, err := time.Parse(time.RFC3339Nano, command.CursorSort); err != nil {
			return Page[Configuration]{}, apperrors.New(apperrors.CodeInvalidArgument, "cursor contains an invalid timestamp")
		}
	}
	var page Page[Configuration]
	err := database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		probe := command
		probe.Limit = command.Limit + 1
		configurations, err := service.store.ListConfigurations(contextValue, transaction, probe)
		if err != nil {
			return err
		}
		page = Page[Configuration]{Items: []Configuration{}}
		if len(configurations) > command.Limit {
			configurations = configurations[:command.Limit]
			last := configurations[len(configurations)-1]
			page.NextCursor = pagination.Encode(pagination.EncodeTime(last.CreatedAt), last.ID)
		}
		page.Items = append(page.Items, configurations...)
		return nil
	})
	if err != nil {
		return Page[Configuration]{}, err
	}
	return page, nil
}

// HardDeleteConfiguration permanently removes a configuration (SuperAdmin only).
// Authorization is enforced by the Casbin AuthorizeHTTP call at the handler layer.
func (service *Service) HardDeleteConfiguration(ctx context.Context, capability centralauthz.Capability, command DeleteConfiguration) error {
	command.ID, command.TenantID = strings.ToLower(strings.TrimSpace(command.ID)), strings.ToLower(strings.TrimSpace(command.TenantID))
	command.ActorID = strings.ToLower(strings.TrimSpace(command.ActorID))
	command.Reason = strings.TrimSpace(command.Reason)
	if !isUUID(command.ID) || !isUUID(command.TenantID) || !isUUID(command.ActorID) || command.Reason == "" {
		return invalid("configuration ID, tenant ID, actor ID, and deletion reason are required")
	}
	return database.WithTenantTx(ctx, service.pool, capability, func(transaction pgx.Tx) error {
		return service.store.HardDeleteConfiguration(ctx, transaction, command)
	})
}

func rejectIssuedSessionReplay(claim database.IdempotencyRecord) error {
	if jsonContainsKey(claim.ResponseBody, "quit_token") {
		return fmt.Errorf("stored idempotent SEB session response contains a quit token")
	}
	var replay issuedSessionReplay
	if err := decodeReplay(claim, 201, &replay); err != nil {
		return err
	}
	// Decode the safe body to detect malformed/corrupt records before we return
	// the uniform conflict. Do not expose the session or any secret via replay.
	if !isUUID(replay.Session.ID) {
		return fmt.Errorf("stored idempotent SEB session response is invalid")
	}
	return apperrors.New(apperrors.CodeConflict, "session issuance already completed; the one-time quit token cannot be replayed")
}

func marshalSafeIdempotencyResponse(response any) (json.RawMessage, error) {
	encoded, err := json.Marshal(response)
	if err != nil {
		return nil, fmt.Errorf("encode idempotent SEB response: %w", err)
	}
	if jsonContainsKey(encoded, "quit_token") {
		return nil, fmt.Errorf("refusing to persist a SEB quit token in an idempotency response")
	}
	return encoded, nil
}

func jsonContainsKey(raw json.RawMessage, wanted string) bool {
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return false
	}
	return jsonValueContainsKey(value, wanted)
}

func jsonValueContainsKey(value any, wanted string) bool {
	switch typed := value.(type) {
	case map[string]any:
		for key, nested := range typed {
			if key == wanted || jsonValueContainsKey(nested, wanted) {
				return true
			}
		}
	case []any:
		for _, nested := range typed {
			if jsonValueContainsKey(nested, wanted) {
				return true
			}
		}
	}
	return false
}

func validateConfiguration(id, tenantID, examID, examVersionID string, version int, objectKey, checksum, keyRef, configKeyHash, browserKeyHash, actorID string) error {
	if !isUUID(id) || !isUUID(tenantID) || !isUUID(examID) || !isUUID(examVersionID) || !isUUID(actorID) || version < 1 || !validLength(objectKey, 1, 1024) || !objectKeyPattern.MatchString(strings.TrimSpace(objectKey)) || !validLength(keyRef, 1, 1024) || !isChecksum(checksum) || !isChecksum(configKeyHash) || (strings.TrimSpace(browserKeyHash) != "" && !isChecksum(browserKeyHash)) {
		return invalid("configuration fields are invalid")
	}
	return nil
}

// GetConfigurationPayload fetches, decrypts, and returns the raw SEB
// configuration object for the identified tenant configuration.
// Returns CodeUnavailable when storage or KMS is not configured.
func (service *Service) GetConfigurationPayload(ctx context.Context, capability centralauthz.Capability, cmd GetConfigurationPayload) ([]byte, error) {
	if service.storage == nil || service.kms == nil {
		return nil, apperrors.New(apperrors.CodeUnavailable, "content storage is not configured on this instance")
	}
	if !isUUID(cmd.TenantID) || !isUUID(cmd.ConfigurationID) {
		return nil, invalid("tenant or configuration ID is invalid")
	}

	var objectKey, encKeyRef string
	err := database.WithTenantTx(ctx, service.pool, capability, func(tx pgx.Tx) error {
		cfg, err := service.store.GetConfiguration(ctx, tx, cmd.TenantID, cmd.ConfigurationID)
		if err != nil {
			return err
		}
		objectKey = cfg.ConfigObjectKey
		encKeyRef = cfg.EncryptionKeyRef
		return nil
	})
	if err != nil {
		return nil, err
	}

	reader, err := service.storage.Get(ctx, objectKey)
	if err != nil {
		return nil, fmt.Errorf("storage get configuration: %w", err)
	}
	defer func() { _ = reader.Close() }()

	ciphertext, err := io.ReadAll(reader)
	if err != nil {
		return nil, fmt.Errorf("read configuration: %w", err)
	}

	plaintext, err := service.kms.Decrypt(ctx, ciphertext, encKeyRef)
	if err != nil {
		return nil, fmt.Errorf("decrypt configuration: %w", err)
	}
	return plaintext, nil
}

func validHeaderKind(value string) bool {
	return value == "config_key" || value == "browser_exam_key"
}

func isUUID(value string) bool {
	return uuidPattern.MatchString(strings.ToLower(strings.TrimSpace(value)))
}
func isChecksum(value string) bool {
	return checksumPattern.MatchString(strings.ToLower(strings.TrimSpace(value)))
}
func validLength(value string, minimum, maximum int) bool {
	length := len(strings.TrimSpace(value))
	return length >= minimum && length <= maximum
}
func invalid(message string) error { return apperrors.New(apperrors.CodeInvalidArgument, message) }
