package domain

import (
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// ErrNotFound is returned when a question is not found in the repository.
var ErrNotFound = errors.New("question not found")

// QuestionStatus represents the lifecycle state of a question.
type QuestionStatus string

const (
	StatusDraft     QuestionStatus = "draft"
	StatusPublished QuestionStatus = "published"
	StatusArchived  QuestionStatus = "archived"
)

// Question represents a coding problem in the global question bank.
// Domain entity with soft delete support per ADR-0013.
type Question struct {
	ID             uuid.UUID
	Slug           string
	LifecycleState QuestionStatus
	CreatedAt      time.Time
	ArchivedAt     *time.Time
	UpdatedAt      time.Time
	Version        int64

	// Soft delete fields per ADR-0013
	DeletedAt      *time.Time `gorm:"index"`
	DeletedBy      *uuid.UUID
	DeletionReason *string
}

// SoftDelete marks the question as deleted without physical removal.
// Only SuperAdmin can hard delete via database security-definer function.
func (q *Question) SoftDelete(actor uuid.UUID, reason string) error {
	if reason == "" {
		return fmt.Errorf("deletion reason required for audit trail")
	}

	if q.DeletedAt != nil {
		return fmt.Errorf("question already deleted at %v", q.DeletedAt)
	}

	now := time.Now()
	q.DeletedAt = &now
	q.DeletedBy = &actor
	q.DeletionReason = &reason
	q.UpdatedAt = now

	return nil
}

// IsDeleted checks if the question is soft-deleted.
func (q *Question) IsDeleted() bool {
	return q.DeletedAt != nil
}

// ErrPublishedImmutable is returned when attempting to modify a published question version.
var ErrPublishedImmutable = errors.New("published versions are immutable")

// QuestionVersion represents an immutable version of a question.
// Domain entity with soft delete support per ADR-0013 (for version retraction).
//
// Invariant: once Status is "published", no fields may be modified.
// This is enforced at the domain level by IsPublished() guards and at
// the database level by an immutability trigger.
type QuestionVersion struct {
	ID                  uuid.UUID
	QuestionID          uuid.UUID
	VersionNumber       int
	Title               string
	PromptMarkdown      string
	Difficulty          string
	SupportedLanguages  []string
	TimeLimitMS         int
	MemoryLimitKiB      int
	Status              string
	PublishedAt         *time.Time
	CreatedAt           time.Time
	UpdatedAt           time.Time
	Version             int64
	SampleTestCaseCount int
	HiddenTestCaseCount int
	AssetCount          int

	// Soft delete fields per ADR-0013
	DeletedAt      *time.Time `gorm:"index"`
	DeletedBy      *uuid.UUID
	DeletionReason *string
}

// IsPublished returns true if this version has been published and is therefore immutable.
func (qv *QuestionVersion) IsPublished() bool {
	return qv.Status == string(StatusPublished)
}

// Publish transitions a draft version to published, setting PublishedAt.
func (qv *QuestionVersion) Publish() error {
	if qv.IsPublished() {
		return fmt.Errorf("%w: version is already published", ErrPublishedImmutable)
	}
	if qv.Status != string(StatusDraft) {
		return fmt.Errorf("cannot publish a version in %q state", qv.Status)
	}
	now := time.Now()
	qv.Status = string(StatusPublished)
	qv.PublishedAt = &now
	qv.UpdatedAt = now
	qv.Version++
	return nil
}

// UpdateDraft modifies a draft question version. Returns an error if the version is published.
func (qv *QuestionVersion) UpdateDraft(title, promptMarkdown, difficulty string, supportedLanguages []string, timeLimitMS, memoryLimitKiB int) error {
	if qv.IsPublished() {
		return ErrPublishedImmutable
	}
	if title != "" {
		qv.Title = title
	}
	if promptMarkdown != "" {
		qv.PromptMarkdown = promptMarkdown
	}
	if difficulty != "" {
		qv.Difficulty = difficulty
	}
	if supportedLanguages != nil {
		qv.SupportedLanguages = supportedLanguages
	}
	if timeLimitMS > 0 {
		qv.TimeLimitMS = timeLimitMS
	}
	if memoryLimitKiB > 0 {
		qv.MemoryLimitKiB = memoryLimitKiB
	}
	qv.UpdatedAt = time.Now()
	qv.Version++
	return nil
}

// SoftDelete marks the question version as deleted (retracted).
// This is for version retraction scenarios.
func (qv *QuestionVersion) SoftDelete(actor uuid.UUID, reason string) error {
	if reason == "" {
		return fmt.Errorf("deletion reason required for audit trail")
	}

	if qv.DeletedAt != nil {
		return fmt.Errorf("question version already deleted at %v", qv.DeletedAt)
	}

	now := time.Now()
	qv.DeletedAt = &now
	qv.DeletedBy = &actor
	qv.DeletionReason = &reason
	qv.UpdatedAt = now

	return nil
}

// IsDeleted checks if the question version is soft-deleted.
func (qv *QuestionVersion) IsDeleted() bool {
	return qv.DeletedAt != nil
}
