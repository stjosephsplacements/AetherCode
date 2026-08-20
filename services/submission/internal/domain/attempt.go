package domain

import (
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// ErrNotFound is returned when an attempt is not found in the repository.
var ErrNotFound = errors.New("attempt not found")

// AttemptLifecycleState represents the state of an exam attempt.
type AttemptLifecycleState string

const (
	LifecycleCreated   AttemptLifecycleState = "created"
	LifecycleActive    AttemptLifecycleState = "active"
	LifecycleSubmitted AttemptLifecycleState = "submitted"
	LifecycleGrading   AttemptLifecycleState = "grading"
	LifecycleGraded    AttemptLifecycleState = "graded"
	LifecycleExpired   AttemptLifecycleState = "expired"
	LifecycleCancelled AttemptLifecycleState = "cancelled"
)

// Attempt represents a candidate's exam attempt.
// Domain entity with soft delete support per ADR-0013.
type Attempt struct {
	ID                    uuid.UUID
	TenantID              uuid.UUID
	ExamID                uuid.UUID
	ExamVersionID         uuid.UUID
	CandidateID           uuid.UUID
	CandidateAssignmentID uuid.UUID
	AttemptNumber         int16
	LifecycleState        AttemptLifecycleState
	AvailableFrom         time.Time
	SubmissionDeadline    time.Time
	StartedAt             *time.Time
	SubmittedAt           *time.Time
	CompletedAt           *time.Time
	Version               int64
	CreatedAt             time.Time
	UpdatedAt             time.Time

	// Soft delete fields per ADR-0013
	DeletedAt      *time.Time `gorm:"index"`
	DeletedBy      *uuid.UUID
	DeletionReason *string
}

// SoftDelete marks the attempt as deleted without physical removal.
// Only SuperAdmin can hard delete via database security-definer function.
func (a *Attempt) SoftDelete(actor uuid.UUID, reason string) error {
	if reason == "" {
		return fmt.Errorf("deletion reason required for audit trail")
	}

	if a.DeletedAt != nil {
		return fmt.Errorf("attempt already deleted at %v", a.DeletedAt)
	}

	now := time.Now()
	a.DeletedAt = &now
	a.DeletedBy = &actor
	a.DeletionReason = &reason
	a.UpdatedAt = now

	return nil
}

// IsDeleted checks if the attempt is soft-deleted.
func (a *Attempt) IsDeleted() bool {
	return a.DeletedAt != nil
}

// CanSubmit returns true only when the attempt is in a submittable state.
func (a *Attempt) CanSubmit() bool {
	return a.LifecycleState == LifecycleActive
}

// IsTerminal returns true when the attempt has reached a final state.
func (a *Attempt) IsTerminal() bool {
	switch a.LifecycleState {
	case LifecycleGraded, LifecycleExpired, LifecycleCancelled:
		return true
	}
	return false
}
