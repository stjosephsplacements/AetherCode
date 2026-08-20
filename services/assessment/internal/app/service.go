// Package app contains Assessment's RLS-scoped authoring and assignment
// workflows. Every method accepts one fresh central authorization capability
// and opens exactly one protected local transaction.
package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/big"
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
	uuidPattern      = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
	checksumPattern  = regexp.MustCompile(`^[0-9a-f]{64}$`)
	objectKeyPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._/=@+-]*$`)
	scorePattern     = regexp.MustCompile(`^(?:0\.[0-9]{1,4}|[1-9][0-9]{0,7}(?:\.[0-9]{1,4})?)$`)
)

const (
	httpStatusOK      = 200
	httpStatusCreated = 201
)

// Store is implemented by the Assessment PostgreSQL adapter. It never starts
// an unscoped application transaction; the Service supplies the signed RLS
// transaction to every call.
type Store interface {
	ClaimIdempotency(context.Context, pgx.Tx, IdempotencyClaim) (json.RawMessage, bool, error)
	CompleteIdempotency(context.Context, pgx.Tx, IdempotencyClaim, int, json.RawMessage) error
	CreateProctorPolicy(context.Context, pgx.Tx, CreateProctorPolicy) (ProctorPolicy, error)
	CreateProctorPolicyVersion(context.Context, pgx.Tx, CreateProctorPolicyVersion) (ProctorPolicyVersion, error)
	PublishProctorPolicyVersion(context.Context, pgx.Tx, PublishProctorPolicyVersion) (ProctorPolicyVersion, error)
	CreateExam(context.Context, pgx.Tx, CreateExam) (Exam, error)
	CreateExamVersion(context.Context, pgx.Tx, CreateExamVersion) (ExamVersion, error)
	AddExamSection(context.Context, pgx.Tx, AddExamSection) (ExamSection, error)
	AddExamItem(context.Context, pgx.Tx, AddExamItem) (ExamItem, error)
	PublishExamVersion(context.Context, pgx.Tx, PublishExamVersion) (ExamVersion, error)
	CreateAssignmentRule(context.Context, pgx.Tx, CreateAssignmentRule) (AssignmentRule, error)
	MaterializeDirectCandidateAssignment(context.Context, pgx.Tx, MaterializeDirectCandidateAssignment) (CandidateAssignment, error)
	RevokeCandidateAssignment(context.Context, pgx.Tx, RevokeCandidateAssignment) (CandidateAssignment, error)
	GetExamVersion(context.Context, pgx.Tx, GetExamVersion) (ExamVersion, error)
	GetCandidateAssignment(context.Context, pgx.Tx, GetCandidateAssignment) (CandidateAssignment, error)
	GetExam(context.Context, pgx.Tx, string, string) (Exam, error)
	GetExamIncludeDeleted(context.Context, pgx.Tx, string, string) (Exam, error)
	SoftDeleteExam(context.Context, pgx.Tx, DeleteExam) error
	HardDeleteExam(context.Context, pgx.Tx, DeleteExam) error
	ListCandidateAssignments(context.Context, pgx.Tx, ListCandidateAssignments) ([]CandidateAssignment, error)
	ListExams(context.Context, pgx.Tx, ListExams) ([]Exam, error)
	ListExamVersions(context.Context, pgx.Tx, ListExamVersions) ([]ExamVersion, error)
	Ping(context.Context) error
}

// Page is one keyset page. NextCursor is empty on the final page.
type Page[T any] struct {
	Items      []T    `json:"items"`
	NextCursor string `json:"next_cursor,omitempty"`
}

// ListCandidateAssignments is candidate-scoped; the database binds rows to the
// signed context actor.
type ListCandidateAssignments struct {
	TenantID       string
	Limit          int
	CursorSort     string
	CursorID       string
	LifecycleState string
}

// ListExams is staff-scoped and relies on tenant RLS.
type ListExams struct {
	TenantID       string
	Limit          int
	CursorSort     string
	CursorID       string
	LifecycleState string
}

// ListExamVersions is staff-scoped and relies on tenant RLS.
type ListExamVersions struct {
	TenantID   string
	ExamID     string
	Limit      int
	CursorSort string
	CursorID   string
	Status     string
}

type ProctorPolicy struct {
	ID             string    `json:"id"`
	TenantID       string    `json:"tenant_id"`
	Name           string    `json:"name"`
	LifecycleState string    `json:"lifecycle_state"`
	Version        int64     `json:"version"`
	CreatedAt      time.Time `json:"created_at"`
}

type ProctorPolicyVersion struct {
	ID              string          `json:"id"`
	TenantID        string          `json:"tenant_id"`
	ProctorPolicyID string          `json:"proctor_policy_id"`
	VersionNumber   int             `json:"version_number"`
	Policy          json.RawMessage `json:"policy"`
	PolicyChecksum  string          `json:"policy_checksum"`
	Status          string          `json:"status"`
	PublishedAt     *time.Time      `json:"published_at,omitempty"`
	CreatedAt       time.Time       `json:"created_at"`
}

type Exam struct {
	ID             string     `json:"id"`
	TenantID       string     `json:"tenant_id"`
	ExternalRef    string     `json:"external_reference,omitempty"`
	LifecycleState string     `json:"lifecycle_state"`
	Version        int64      `json:"version"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
	DeletedAt      *time.Time `json:"deleted_at,omitempty"`
	DeletedBy      *string    `json:"deleted_by,omitempty"`
	DeletionReason *string    `json:"deletion_reason,omitempty"`
}

// IsDeleted checks if the exam has been soft-deleted.
func (e *Exam) IsDeleted() bool { return e.DeletedAt != nil }

// DeleteExam is the command for soft/hard delete operations on exams.
type DeleteExam struct {
	ID       string
	TenantID string
	ActorID  string
	Reason   string
}

type ExamVersion struct {
	ID                     string     `json:"id"`
	TenantID               string     `json:"tenant_id"`
	ExamID                 string     `json:"exam_id"`
	VersionNumber          int        `json:"version_number"`
	ContentVersion         int64      `json:"content_version"`
	AttemptLimit           int        `json:"attempt_limit"`
	Title                  string     `json:"title"`
	InstructionsMarkdown   string     `json:"instructions_markdown"`
	OpensAt                time.Time  `json:"opens_at"`
	ClosesAt               time.Time  `json:"closes_at"`
	DurationSeconds        int        `json:"duration_seconds"`
	ProctorPolicyVersionID string     `json:"proctor_policy_version_id"`
	Status                 string     `json:"status"`
	PublishedAt            *time.Time `json:"published_at,omitempty"`
	CreatedAt              time.Time  `json:"created_at"`
}

type ExamSection struct {
	ID                   string    `json:"id"`
	TenantID             string    `json:"tenant_id"`
	ExamVersionID        string    `json:"exam_version_id"`
	Position             int       `json:"position"`
	Title                string    `json:"title"`
	InstructionsMarkdown string    `json:"instructions_markdown"`
	TimeLimitSeconds     *int      `json:"time_limit_seconds,omitempty"`
	CreatedAt            time.Time `json:"created_at"`
}

type ExamItem struct {
	ID                       string    `json:"id"`
	TenantID                 string    `json:"tenant_id"`
	ExamVersionID            string    `json:"exam_version_id"`
	SectionID                string    `json:"section_id"`
	Position                 int       `json:"position"`
	QuestionID               string    `json:"question_id"`
	QuestionVersionID        string    `json:"question_version_id"`
	MaximumScore             string    `json:"maximum_score"`
	EvaluationBundleChecksum string    `json:"evaluation_bundle_checksum"`
	CreatedAt                time.Time `json:"created_at"`
}

type AssignmentRule struct {
	ID             string          `json:"id"`
	TenantID       string          `json:"tenant_id"`
	ExamVersionID  string          `json:"exam_version_id"`
	TargetType     string          `json:"target_type"`
	TargetID       string          `json:"target_id"`
	AvailableFrom  time.Time       `json:"available_from"`
	AvailableUntil time.Time       `json:"available_until"`
	Accommodations json.RawMessage `json:"accommodations"`
	DisabledAt     *time.Time      `json:"disabled_at,omitempty"`
	Version        int64           `json:"version"`
	CreatedAt      time.Time       `json:"created_at"`
}

type CandidateAssignment struct {
	ID               string     `json:"id"`
	TenantID         string     `json:"tenant_id"`
	AssignmentRuleID string     `json:"assignment_rule_id"`
	ExamVersionID    string     `json:"exam_version_id"`
	CandidateID      string     `json:"candidate_id"`
	AvailableFrom    time.Time  `json:"available_from"`
	AvailableUntil   time.Time  `json:"available_until"`
	LifecycleState   string     `json:"lifecycle_state"`
	AssignedAt       time.Time  `json:"assigned_at"`
	RevokedAt        *time.Time `json:"revoked_at,omitempty"`
	CompletedAt      *time.Time `json:"completed_at,omitempty"`
	Version          int64      `json:"version"`
}

type CreateProctorPolicy struct {
	WriteCommand
	ID       string
	TenantID string
	Name     string
}

type CreateProctorPolicyVersion struct {
	WriteCommand
	ID                    string
	TenantID              string
	ProctorPolicyID       string
	ExpectedPolicyVersion int64
	Policy                json.RawMessage
	PolicyChecksum        string
}

type PublishProctorPolicyVersion struct {
	WriteCommand
	TenantID               string
	ProctorPolicyVersionID string
}

type CreateExam struct {
	WriteCommand
	ID                string
	TenantID          string
	ExternalReference string
}

type CreateExamVersion struct {
	WriteCommand
	ID                     string
	TenantID               string
	ExamID                 string
	ExpectedExamVersion    int64
	Title                  string
	InstructionsMarkdown   string
	OpensAt                time.Time
	ClosesAt               time.Time
	DurationSeconds        int
	ProctorPolicyVersionID string
}

type AddExamSection struct {
	WriteCommand
	ID                     string
	TenantID               string
	ExamVersionID          string
	ExpectedContentVersion int64
	Position               int
	Title                  string
	InstructionsMarkdown   string
	TimeLimitSeconds       *int
}

type AddExamItem struct {
	WriteCommand
	ID                        string
	TenantID                  string
	ExamVersionID             string
	SectionID                 string
	ExpectedContentVersion    int64
	Position                  int
	QuestionID                string
	QuestionVersionID         string
	MaximumScore              string
	EvaluationBundleObjectKey string
	EvaluationBundleChecksum  string
}

type PublishExamVersion struct {
	WriteCommand
	TenantID               string
	ExamVersionID          string
	ExpectedContentVersion int64
}

type CreateAssignmentRule struct {
	WriteCommand
	ID             string
	TenantID       string
	ExamVersionID  string
	TargetType     string
	TargetID       string
	AvailableFrom  time.Time
	AvailableUntil time.Time
	Accommodations json.RawMessage
}

type MaterializeDirectCandidateAssignment struct {
	WriteCommand
	ID               string
	TenantID         string
	AssignmentRuleID string
	CandidateID      string
}

// RevokeCandidateAssignment advances the assignment lifecycle and version. The
// durable snapshot event emitted by the database procedure is the only way
// downstream projections learn the new lifecycle state and cancel attempts
// they own.
type RevokeCandidateAssignment struct {
	WriteCommand
	TenantID              string
	CandidateAssignmentID string
	ExpectedVersion       int64
}

type GetExamVersion struct {
	TenantID      string
	ExamVersionID string
}

// WriteCommand carries the request's immutable retry key. The response cache
// is tenant- and actor-scoped, so a retry never replays another actor's result.
type WriteCommand struct {
	IdempotencyKey string
}

type IdempotencyClaim struct {
	TenantID    string
	Operation   string
	Key         string
	RequestHash string
}

type GetCandidateAssignment struct {
	TenantID              string
	CandidateAssignmentID string
}

// Service owns validation and the secure local transaction boundary.
type Service struct {
	pool  *pgxpool.Pool
	store Store
}

func NewService(pool *pgxpool.Pool, store Store) (*Service, error) {
	if pool == nil || store == nil {
		return nil, fmt.Errorf("assessment database pool and store are required")
	}
	return &Service{pool: pool, store: store}, nil
}

func (service *Service) CreateProctorPolicy(ctx context.Context, capability centralauthz.Capability, command CreateProctorPolicy) (ProctorPolicy, error) {
	command.ID, command.TenantID, command.Name = normalizeID(command.ID), normalizeID(command.TenantID), strings.TrimSpace(command.Name)
	if !validID(command.ID) || !validID(command.TenantID) || !validText(command.Name, 160) {
		return ProctorPolicy{}, invalid("proctor policy fields are invalid")
	}
	return runWrite(service, ctx, capability, command.TenantID, "assessment.proctor_policy.create", command.IdempotencyKey,
		struct {
			Name string `json:"name"`
		}{Name: command.Name}, httpStatusCreated,
		func(transaction pgx.Tx) (ProctorPolicy, error) {
			return service.store.CreateProctorPolicy(ctx, transaction, command)
		},
	)
}

func (service *Service) CreateProctorPolicyVersion(ctx context.Context, capability centralauthz.Capability, command CreateProctorPolicyVersion) (ProctorPolicyVersion, error) {
	command.ID, command.TenantID, command.ProctorPolicyID = normalizeID(command.ID), normalizeID(command.TenantID), normalizeID(command.ProctorPolicyID)
	policy, checksum, err := canonicalJSONObject(command.Policy, 64<<10)
	if err != nil || !validID(command.ID) || !validID(command.TenantID) || !validID(command.ProctorPolicyID) || command.ExpectedPolicyVersion <= 0 {
		return ProctorPolicyVersion{}, invalid("proctor policy version fields are invalid")
	}
	command.Policy, command.PolicyChecksum = policy, checksum
	return runWrite(service, ctx, capability, command.TenantID, "assessment.proctor_policy_version.create", command.IdempotencyKey,
		struct {
			ProctorPolicyID       string          `json:"proctor_policy_id"`
			ExpectedPolicyVersion int64           `json:"expected_policy_version"`
			Policy                json.RawMessage `json:"policy"`
			PolicyChecksum        string          `json:"policy_checksum"`
		}{command.ProctorPolicyID, command.ExpectedPolicyVersion, command.Policy, command.PolicyChecksum}, httpStatusCreated,
		func(transaction pgx.Tx) (ProctorPolicyVersion, error) {
			return service.store.CreateProctorPolicyVersion(ctx, transaction, command)
		},
	)
}

func (service *Service) PublishProctorPolicyVersion(ctx context.Context, capability centralauthz.Capability, command PublishProctorPolicyVersion) (ProctorPolicyVersion, error) {
	command.TenantID, command.ProctorPolicyVersionID = normalizeID(command.TenantID), normalizeID(command.ProctorPolicyVersionID)
	if !validID(command.TenantID) || !validID(command.ProctorPolicyVersionID) {
		return ProctorPolicyVersion{}, invalid("proctor policy version IDs are invalid")
	}
	return runWrite(service, ctx, capability, command.TenantID, "assessment.proctor_policy_version.publish", command.IdempotencyKey,
		struct {
			ProctorPolicyVersionID string `json:"proctor_policy_version_id"`
		}{command.ProctorPolicyVersionID}, httpStatusOK,
		func(transaction pgx.Tx) (ProctorPolicyVersion, error) {
			return service.store.PublishProctorPolicyVersion(ctx, transaction, command)
		},
	)
}

func (service *Service) CreateExam(ctx context.Context, capability centralauthz.Capability, command CreateExam) (Exam, error) {
	command.ID, command.TenantID = normalizeID(command.ID), normalizeID(command.TenantID)
	command.ExternalReference = strings.TrimSpace(command.ExternalReference)
	if !validID(command.ID) || !validID(command.TenantID) || (command.ExternalReference != "" && !validText(command.ExternalReference, 160)) {
		return Exam{}, invalid("exam fields are invalid")
	}
	return runWrite(service, ctx, capability, command.TenantID, "assessment.exam.create", command.IdempotencyKey,
		struct {
			ExternalReference string `json:"external_reference"`
		}{command.ExternalReference}, httpStatusCreated,
		func(transaction pgx.Tx) (Exam, error) {
			return service.store.CreateExam(ctx, transaction, command)
		},
	)
}

func (service *Service) CreateExamVersion(ctx context.Context, capability centralauthz.Capability, command CreateExamVersion) (ExamVersion, error) {
	command.ID, command.TenantID, command.ExamID, command.ProctorPolicyVersionID = normalizeID(command.ID), normalizeID(command.TenantID), normalizeID(command.ExamID), normalizeID(command.ProctorPolicyVersionID)
	command.Title, command.InstructionsMarkdown = strings.TrimSpace(command.Title), strings.TrimSpace(command.InstructionsMarkdown)
	command.OpensAt, command.ClosesAt = command.OpensAt.UTC(), command.ClosesAt.UTC()
	if !validID(command.ID) || !validID(command.TenantID) || !validID(command.ExamID) || !validID(command.ProctorPolicyVersionID) || command.ExpectedExamVersion <= 0 || !validText(command.Title, 300) || !validText(command.InstructionsMarkdown, 100_000) || !validWindow(command.OpensAt, command.ClosesAt) || command.DurationSeconds < 60 || command.DurationSeconds > 43_200 || int64(command.DurationSeconds) > int64(command.ClosesAt.Sub(command.OpensAt).Seconds()) {
		return ExamVersion{}, invalid("exam version fields are invalid")
	}
	if command.OpensAt.Before(time.Now().Add(-time.Minute)) {
		return ExamVersion{}, invalid("exam opens_at must not be in the past")
	}
	return runWrite(service, ctx, capability, command.TenantID, "assessment.exam_version.create", command.IdempotencyKey,
		struct {
			ExamID                 string    `json:"exam_id"`
			ExpectedExamVersion    int64     `json:"expected_exam_version"`
			Title                  string    `json:"title"`
			InstructionsMarkdown   string    `json:"instructions_markdown"`
			OpensAt                time.Time `json:"opens_at"`
			ClosesAt               time.Time `json:"closes_at"`
			DurationSeconds        int       `json:"duration_seconds"`
			ProctorPolicyVersionID string    `json:"proctor_policy_version_id"`
		}{command.ExamID, command.ExpectedExamVersion, command.Title, command.InstructionsMarkdown,
			command.OpensAt, command.ClosesAt, command.DurationSeconds, command.ProctorPolicyVersionID}, httpStatusCreated,
		func(transaction pgx.Tx) (ExamVersion, error) {
			return service.store.CreateExamVersion(ctx, transaction, command)
		},
	)
}

func (service *Service) AddExamSection(ctx context.Context, capability centralauthz.Capability, command AddExamSection) (ExamSection, error) {
	command.ID, command.TenantID, command.ExamVersionID = normalizeID(command.ID), normalizeID(command.TenantID), normalizeID(command.ExamVersionID)
	command.Title, command.InstructionsMarkdown = strings.TrimSpace(command.Title), strings.TrimSpace(command.InstructionsMarkdown)
	if !validID(command.ID) || !validID(command.TenantID) || !validID(command.ExamVersionID) || command.ExpectedContentVersion <= 0 || command.Position <= 0 || !validText(command.Title, 300) || len([]rune(command.InstructionsMarkdown)) > 100_000 || (command.TimeLimitSeconds != nil && (*command.TimeLimitSeconds < 60 || *command.TimeLimitSeconds > 43_200)) {
		return ExamSection{}, invalid("exam section fields are invalid")
	}
	return runWrite(service, ctx, capability, command.TenantID, "assessment.exam_section.create", command.IdempotencyKey,
		struct {
			ExamVersionID          string `json:"exam_version_id"`
			ExpectedContentVersion int64  `json:"expected_content_version"`
			Position               int    `json:"position"`
			Title                  string `json:"title"`
			InstructionsMarkdown   string `json:"instructions_markdown"`
			TimeLimitSeconds       *int   `json:"time_limit_seconds"`
		}{command.ExamVersionID, command.ExpectedContentVersion, command.Position, command.Title,
			command.InstructionsMarkdown, command.TimeLimitSeconds}, httpStatusCreated,
		func(transaction pgx.Tx) (ExamSection, error) {
			return service.store.AddExamSection(ctx, transaction, command)
		},
	)
}

func (service *Service) AddExamItem(ctx context.Context, capability centralauthz.Capability, command AddExamItem) (ExamItem, error) {
	command.ID, command.TenantID, command.ExamVersionID, command.SectionID = normalizeID(command.ID), normalizeID(command.TenantID), normalizeID(command.ExamVersionID), normalizeID(command.SectionID)
	command.QuestionID, command.QuestionVersionID = normalizeID(command.QuestionID), normalizeID(command.QuestionVersionID)
	command.MaximumScore = strings.TrimSpace(command.MaximumScore)
	command.EvaluationBundleObjectKey = strings.TrimSpace(command.EvaluationBundleObjectKey)
	command.EvaluationBundleChecksum = strings.ToLower(strings.TrimSpace(command.EvaluationBundleChecksum))
	if !validID(command.ID) || !validID(command.TenantID) || !validID(command.ExamVersionID) || !validID(command.SectionID) || !validID(command.QuestionID) || !validID(command.QuestionVersionID) || command.ExpectedContentVersion <= 0 || command.Position <= 0 || !validScore(command.MaximumScore) || !validObjectKey(command.EvaluationBundleObjectKey) || !checksumPattern.MatchString(command.EvaluationBundleChecksum) {
		return ExamItem{}, invalid("exam item fields are invalid")
	}
	return runWrite(service, ctx, capability, command.TenantID, "assessment.exam_item.create", command.IdempotencyKey,
		struct {
			ExamVersionID             string `json:"exam_version_id"`
			SectionID                 string `json:"section_id"`
			ExpectedContentVersion    int64  `json:"expected_content_version"`
			Position                  int    `json:"position"`
			QuestionID                string `json:"question_id"`
			QuestionVersionID         string `json:"question_version_id"`
			MaximumScore              string `json:"maximum_score"`
			EvaluationBundleObjectKey string `json:"evaluation_bundle_object_key"`
			EvaluationBundleChecksum  string `json:"evaluation_bundle_checksum"`
		}{command.ExamVersionID, command.SectionID, command.ExpectedContentVersion, command.Position,
			command.QuestionID, command.QuestionVersionID, command.MaximumScore, command.EvaluationBundleObjectKey, command.EvaluationBundleChecksum}, httpStatusCreated,
		func(transaction pgx.Tx) (ExamItem, error) {
			return service.store.AddExamItem(ctx, transaction, command)
		},
	)
}

func (service *Service) PublishExamVersion(ctx context.Context, capability centralauthz.Capability, command PublishExamVersion) (ExamVersion, error) {
	command.TenantID, command.ExamVersionID = normalizeID(command.TenantID), normalizeID(command.ExamVersionID)
	if !validID(command.TenantID) || !validID(command.ExamVersionID) || command.ExpectedContentVersion <= 0 {
		return ExamVersion{}, invalid("exam publication fields are invalid")
	}
	return runWrite(service, ctx, capability, command.TenantID, "assessment.exam_version.publish", command.IdempotencyKey,
		struct {
			ExamVersionID          string `json:"exam_version_id"`
			ExpectedContentVersion int64  `json:"expected_content_version"`
		}{command.ExamVersionID, command.ExpectedContentVersion}, httpStatusOK,
		func(transaction pgx.Tx) (ExamVersion, error) {
			return service.store.PublishExamVersion(ctx, transaction, command)
		},
	)
}

func (service *Service) CreateAssignmentRule(ctx context.Context, capability centralauthz.Capability, command CreateAssignmentRule) (AssignmentRule, error) {
	command.ID, command.TenantID, command.ExamVersionID, command.TargetID = normalizeID(command.ID), normalizeID(command.TenantID), normalizeID(command.ExamVersionID), normalizeID(command.TargetID)
	command.TargetType = strings.ToLower(strings.TrimSpace(command.TargetType))
	command.AvailableFrom, command.AvailableUntil = command.AvailableFrom.UTC(), command.AvailableUntil.UTC()
	accommodations, _, err := canonicalJSONObject(command.Accommodations, 64<<10)
	if err != nil || !validID(command.ID) || !validID(command.TenantID) || !validID(command.ExamVersionID) || !validID(command.TargetID) || !validTargetType(command.TargetType) || !validWindow(command.AvailableFrom, command.AvailableUntil) {
		return AssignmentRule{}, invalid("assignment rule fields are invalid")
	}
	// Placement department rules are cross-tenant; the target must be a valid UUID (structural check only).
	// Ownership is enforced by RLS and the authz context tenant scope at query time.
	if command.TargetType == "placement_department" && !validID(command.TargetID) {
		return AssignmentRule{}, invalid("placement_department target_id must be a valid UUID")
	}
	command.Accommodations = accommodations
	return runWrite(service, ctx, capability, command.TenantID, "assessment.assignment_rule.create", command.IdempotencyKey,
		struct {
			ExamVersionID  string          `json:"exam_version_id"`
			TargetType     string          `json:"target_type"`
			TargetID       string          `json:"target_id"`
			AvailableFrom  time.Time       `json:"available_from"`
			AvailableUntil time.Time       `json:"available_until"`
			Accommodations json.RawMessage `json:"accommodations"`
		}{command.ExamVersionID, command.TargetType, command.TargetID, command.AvailableFrom,
			command.AvailableUntil, command.Accommodations}, httpStatusCreated,
		func(transaction pgx.Tx) (AssignmentRule, error) {
			return service.store.CreateAssignmentRule(ctx, transaction, command)
		},
	)
}

func (service *Service) MaterializeDirectCandidateAssignment(ctx context.Context, capability centralauthz.Capability, command MaterializeDirectCandidateAssignment) (CandidateAssignment, error) {
	command.ID, command.TenantID, command.AssignmentRuleID, command.CandidateID = normalizeID(command.ID), normalizeID(command.TenantID), normalizeID(command.AssignmentRuleID), normalizeID(command.CandidateID)
	if !validID(command.ID) || !validID(command.TenantID) || !validID(command.AssignmentRuleID) || !validID(command.CandidateID) {
		return CandidateAssignment{}, invalid("candidate assignment fields are invalid")
	}
	return runWrite(service, ctx, capability, command.TenantID, "assessment.candidate_assignment.materialize", command.IdempotencyKey,
		struct {
			AssignmentRuleID string `json:"assignment_rule_id"`
			CandidateID      string `json:"candidate_id"`
		}{command.AssignmentRuleID, command.CandidateID}, httpStatusCreated,
		func(transaction pgx.Tx) (CandidateAssignment, error) {
			return service.store.MaterializeDirectCandidateAssignment(ctx, transaction, command)
		},
	)
}

func (service *Service) RevokeCandidateAssignment(ctx context.Context, capability centralauthz.Capability, command RevokeCandidateAssignment) (CandidateAssignment, error) {
	command.TenantID, command.CandidateAssignmentID = normalizeID(command.TenantID), normalizeID(command.CandidateAssignmentID)
	if !validID(command.TenantID) || !validID(command.CandidateAssignmentID) || command.ExpectedVersion <= 0 {
		return CandidateAssignment{}, invalid("candidate assignment revocation fields are invalid")
	}
	return runWrite(service, ctx, capability, command.TenantID, "assessment.candidate_assignment.revoke", command.IdempotencyKey,
		struct {
			CandidateAssignmentID string `json:"candidate_assignment_id"`
			ExpectedVersion       int64  `json:"expected_version"`
		}{command.CandidateAssignmentID, command.ExpectedVersion}, httpStatusOK,
		func(transaction pgx.Tx) (CandidateAssignment, error) {
			return service.store.RevokeCandidateAssignment(ctx, transaction, command)
		},
	)
}

func (service *Service) GetExamVersion(ctx context.Context, capability centralauthz.Capability, command GetExamVersion) (ExamVersion, error) {
	command.TenantID, command.ExamVersionID = normalizeID(command.TenantID), normalizeID(command.ExamVersionID)
	if !validID(command.TenantID) || !validID(command.ExamVersionID) {
		return ExamVersion{}, invalid("exam version IDs are invalid")
	}
	var result ExamVersion
	err := service.withTenantTx(ctx, capability, command.TenantID, func(transaction pgx.Tx) error {
		var err error
		result, err = service.store.GetExamVersion(ctx, transaction, command)
		return err
	})
	return result, err
}

func (service *Service) GetCandidateAssignment(ctx context.Context, capability centralauthz.Capability, command GetCandidateAssignment) (CandidateAssignment, error) {
	command.TenantID, command.CandidateAssignmentID = normalizeID(command.TenantID), normalizeID(command.CandidateAssignmentID)
	if !validID(command.TenantID) || !validID(command.CandidateAssignmentID) {
		return CandidateAssignment{}, invalid("candidate assignment IDs are invalid")
	}
	var result CandidateAssignment
	err := service.withTenantTx(ctx, capability, command.TenantID, func(transaction pgx.Tx) error {
		var err error
		result, err = service.store.GetCandidateAssignment(ctx, transaction, command)
		return err
	})
	return result, err
}

func (service *Service) withTenantTx(ctx context.Context, capability centralauthz.Capability, tenantID string, fn func(pgx.Tx) error) error {
	if strings.ToLower(strings.TrimSpace(capability.TenantID)) != tenantID {
		return apperrors.New(apperrors.CodeForbidden, "authorization denied")
	}
	return database.WithTenantTx(ctx, service.pool, capability, fn)
}

func runWrite[T any](
	service *Service,
	ctx context.Context,
	capability centralauthz.Capability,
	tenantID, operation, key string,
	fingerprint any,
	status int,
	work func(pgx.Tx) (T, error),
) (T, error) {
	var result T
	key = strings.TrimSpace(key)
	if !validIdempotencyKey(key) {
		return result, invalid("Idempotency-Key is required and must contain 1 to 255 printable characters")
	}
	serialized, err := json.Marshal(fingerprint)
	if err != nil {
		return result, fmt.Errorf("encode idempotency fingerprint: %w", err)
	}
	digest := sha256.Sum256(serialized)
	claim := IdempotencyClaim{
		TenantID:  tenantID,
		Operation: operation + ":" + normalizeID(capability.ActorID),
		Key:       key, RequestHash: hex.EncodeToString(digest[:]),
	}
	err = service.withTenantTx(ctx, capability, tenantID, func(transaction pgx.Tx) error {
		cached, completed, claimErr := service.store.ClaimIdempotency(ctx, transaction, claim)
		if claimErr != nil {
			return claimErr
		}
		if completed {
			if err := json.Unmarshal(cached, &result); err != nil {
				return fmt.Errorf("decode idempotent response: %w", err)
			}
			return nil
		}
		result, err = work(transaction)
		if err != nil {
			return err
		}
		response, err := json.Marshal(result)
		if err != nil {
			return fmt.Errorf("encode idempotent response: %w", err)
		}
		return service.store.CompleteIdempotency(ctx, transaction, claim, status, response)
	})
	return result, err
}

func validID(value string) bool { return uuidPattern.MatchString(value) }

func normalizeID(value string) string { return strings.ToLower(strings.TrimSpace(value)) }

func validText(value string, maximum int) bool {
	length := len([]rune(strings.TrimSpace(value)))
	return length > 0 && length <= maximum
}

func validWindow(from, until time.Time) bool {
	return !from.IsZero() && !until.IsZero() && from.Before(until)
}

func validScore(value string) bool {
	if !scorePattern.MatchString(value) {
		return false
	}
	parsed, ok := new(big.Rat).SetString(value)
	return ok && parsed.Sign() > 0
}

func validTargetType(value string) bool {
	switch value {
	case "department", "batch", "placement_department", "student":
		return true
	default:
		return false
	}
}

func validObjectKey(value string) bool {
	return len(value) <= 1024 && objectKeyPattern.MatchString(value) && !strings.Contains(value, "..")
}

func validIdempotencyKey(value string) bool {
	if len(value) == 0 || len(value) > 255 {
		return false
	}
	for _, character := range value {
		if character < '!' || character > '~' {
			return false
		}
	}
	return true
}

func canonicalJSONObject(value json.RawMessage, maximumBytes int) (json.RawMessage, string, error) {
	if len(value) == 0 || len(value) > maximumBytes {
		return nil, "", fmt.Errorf("JSON object is missing or too large")
	}
	var object map[string]any
	if err := json.Unmarshal(value, &object); err != nil || object == nil {
		return nil, "", fmt.Errorf("JSON value must be an object")
	}
	canonical, err := json.Marshal(object)
	if err != nil || len(canonical) > maximumBytes {
		return nil, "", fmt.Errorf("JSON object cannot be canonicalized")
	}
	digest := sha256.Sum256(canonical)
	return canonical, hex.EncodeToString(digest[:]), nil
}

// DeleteExam soft-deletes an exam with audit trail.
func (service *Service) DeleteExam(ctx context.Context, capability centralauthz.Capability, command DeleteExam) error {
	command.ID, command.TenantID = normalizeID(command.ID), normalizeID(command.TenantID)
	command.ActorID = normalizeID(command.ActorID)
	command.Reason = strings.TrimSpace(command.Reason)
	if !validID(command.ID) || !validID(command.TenantID) || !validID(command.ActorID) || command.Reason == "" {
		return invalid("exam ID, tenant ID, actor ID, and deletion reason are required")
	}
	return service.withTenantTx(ctx, capability, command.TenantID, func(transaction pgx.Tx) error {
		exam, err := service.store.GetExam(ctx, transaction, command.ID, command.TenantID)
		if err != nil {
			return err
		}
		if exam.IsDeleted() {
			return apperrors.New(apperrors.CodeConflict, "exam already deleted")
		}
		return service.store.SoftDeleteExam(ctx, transaction, command)
	})
}

// HardDeleteExam permanently removes an exam (SuperAdmin only).
// Authorization is enforced by the Casbin AuthorizeHTTP call at the handler layer.
func (service *Service) HardDeleteExam(ctx context.Context, capability centralauthz.Capability, command DeleteExam) error {
	command.ID, command.TenantID = normalizeID(command.ID), normalizeID(command.TenantID)
	command.ActorID = normalizeID(command.ActorID)
	command.Reason = strings.TrimSpace(command.Reason)
	if !validID(command.ID) || !validID(command.TenantID) || !validID(command.ActorID) || command.Reason == "" {
		return invalid("exam ID, tenant ID, actor ID, and deletion reason are required")
	}
	return service.withTenantTx(ctx, capability, command.TenantID, func(transaction pgx.Tx) error {
		if _, err := service.store.GetExamIncludeDeleted(ctx, transaction, command.ID, command.TenantID); err != nil {
			return err
		}
		return service.store.HardDeleteExam(ctx, transaction, command)
	})
}

// ListCandidateAssignments returns a keyset page of the calling candidate's
// assignments. Database RLS binds rows to the signed actor.
func (service *Service) ListCandidateAssignments(ctx context.Context, capability centralauthz.Capability, command ListCandidateAssignments) (Page[CandidateAssignment], error) {
	var page Page[CandidateAssignment]
	err := service.withTenantTx(ctx, capability, command.TenantID, func(transaction pgx.Tx) error {
		probe := command
		probe.Limit = command.Limit + 1
		assignments, err := service.store.ListCandidateAssignments(ctx, transaction, probe)
		if err != nil {
			return err
		}
		page = Page[CandidateAssignment]{Items: []CandidateAssignment{}}
		if len(assignments) > command.Limit {
			assignments = assignments[:command.Limit]
			last := assignments[len(assignments)-1]
			page.NextCursor = pagination.Encode(pagination.EncodeTime(last.AvailableFrom), last.ID)
		}
		page.Items = append(page.Items, assignments...)
		return nil
	})
	if err != nil {
		return Page[CandidateAssignment]{}, err
	}
	return page, nil
}

// ListExams returns a keyset page of exams for the tenant.
func (service *Service) ListExams(ctx context.Context, capability centralauthz.Capability, command ListExams) (Page[Exam], error) {
	var page Page[Exam]
	err := service.withTenantTx(ctx, capability, command.TenantID, func(transaction pgx.Tx) error {
		probe := command
		probe.Limit = command.Limit + 1
		exams, err := service.store.ListExams(ctx, transaction, probe)
		if err != nil {
			return err
		}
		page = Page[Exam]{Items: []Exam{}}
		if len(exams) > command.Limit {
			exams = exams[:command.Limit]
			last := exams[len(exams)-1]
			page.NextCursor = pagination.Encode(pagination.EncodeTime(last.CreatedAt), last.ID)
		}
		page.Items = append(page.Items, exams...)
		return nil
	})
	if err != nil {
		return Page[Exam]{}, err
	}
	return page, nil
}

// ListExamVersions returns a keyset page of versions for the given exam.
func (service *Service) ListExamVersions(ctx context.Context, capability centralauthz.Capability, command ListExamVersions) (Page[ExamVersion], error) {
	var page Page[ExamVersion]
	err := service.withTenantTx(ctx, capability, command.TenantID, func(transaction pgx.Tx) error {
		probe := command
		probe.Limit = command.Limit + 1
		versions, err := service.store.ListExamVersions(ctx, transaction, probe)
		if err != nil {
			return err
		}
		page = Page[ExamVersion]{Items: []ExamVersion{}}
		if len(versions) > command.Limit {
			versions = versions[:command.Limit]
			last := versions[len(versions)-1]
			page.NextCursor = pagination.Encode(pagination.FormatInt(int64(last.VersionNumber)), last.ID)
		}
		page.Items = append(page.Items, versions...)
		return nil
	})
	if err != nil {
		return Page[ExamVersion]{}, err
	}
	return page, nil
}

func invalid(message string) error { return apperrors.New(apperrors.CodeInvalidArgument, message) }
