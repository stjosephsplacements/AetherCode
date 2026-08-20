package domain

import (
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// ErrNotFound is returned when a student is not found in the repository.
var ErrNotFound = errors.New("student not found")

// StudentStatus represents the enrollment state of a student.
type StudentStatus string

const (
	StatusActive    StudentStatus = "active"
	StatusInactive  StudentStatus = "inactive"
	StatusSuspended StudentStatus = "suspended"
)

// Student represents a learner enrolled in a tenant's educational program.
// Domain entity with soft delete support per ADR-0013.
type Student struct {
	ID               uuid.UUID
	PrincipalID      uuid.UUID
	TenantID         uuid.UUID
	EnrollmentNumber string
	Status           StudentStatus
	AdmittedAt       *time.Time
	Version          int
	CreatedAt        time.Time
	UpdatedAt        time.Time

	// Soft delete fields per ADR-0013
	DeletedAt      *time.Time `gorm:"index"`
	DeletedBy      *uuid.UUID
	DeletionReason *string
}

// SoftDelete marks the student as deleted without physical removal.
// Only SuperAdmin can hard delete via database security-definer function.
func (s *Student) SoftDelete(actor uuid.UUID, reason string) error {
	if reason == "" {
		return fmt.Errorf("deletion reason required for audit trail")
	}

	if s.DeletedAt != nil {
		return fmt.Errorf("student already deleted at %v", s.DeletedAt)
	}

	now := time.Now()
	s.DeletedAt = &now
	s.DeletedBy = &actor
	s.DeletionReason = &reason
	s.UpdatedAt = now

	return nil
}

// IsDeleted checks if the student is soft-deleted.
func (s *Student) IsDeleted() bool {
	return s.DeletedAt != nil
}
