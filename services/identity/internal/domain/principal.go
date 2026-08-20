package domain

import (
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// ErrPrincipalNotFound is returned when a principal is not found in the repository.
var ErrPrincipalNotFound = errors.New("principal not found")

// PrincipalStatus represents the state of a principal's authentication capability.
type PrincipalStatus string

const (
	StatusPendingVerification PrincipalStatus = "pending_verification"
	StatusActive              PrincipalStatus = "active"
	StatusDisabled            PrincipalStatus = "disabled"
	StatusLocked              PrincipalStatus = "locked"
)

// Principal represents an authentication entity with soft delete support per ADR-0013.
// This domain entity models the identity.principals table with soft delete fields.
type Principal struct {
	ID                  uuid.UUID
	Email               string
	DisplayName         string
	Status              PrincipalStatus
	EmailVerifiedAt     *time.Time
	LastAuthenticatedAt *time.Time
	Version             int
	CreatedAt           time.Time
	UpdatedAt           time.Time

	// Soft delete fields per ADR-0013
	DeletedAt      *time.Time `gorm:"index"`
	DeletedBy      *uuid.UUID
	DeletionReason *string
}

// ErrInvalidTransition is returned when a principal status transition is not permitted.
var ErrInvalidTransition = errors.New("invalid status transition")

// Verify transitions a principal from pending_verification to active.
func (p *Principal) Verify() error {
	if p.Status != StatusPendingVerification {
		return fmt.Errorf("%w: cannot verify principal in %q state", ErrInvalidTransition, p.Status)
	}
	now := time.Now()
	p.Status = StatusActive
	p.EmailVerifiedAt = &now
	p.UpdatedAt = now
	p.Version++
	return nil
}

// Disable transitions a principal from active to disabled.
func (p *Principal) Disable(reason string) error {
	if p.Status != StatusActive {
		return fmt.Errorf("%w: cannot disable principal in %q state", ErrInvalidTransition, p.Status)
	}
	if reason == "" {
		return fmt.Errorf("disable reason is required")
	}
	p.Status = StatusDisabled
	p.UpdatedAt = time.Now()
	p.Version++
	return nil
}

// Lock transitions a principal from active to locked.
func (p *Principal) Lock(reason string) error {
	if p.Status != StatusActive {
		return fmt.Errorf("%w: cannot lock principal in %q state", ErrInvalidTransition, p.Status)
	}
	if reason == "" {
		return fmt.Errorf("lock reason is required")
	}
	p.Status = StatusLocked
	p.UpdatedAt = time.Now()
	p.Version++
	return nil
}

// Unlock transitions a principal from locked to active.
func (p *Principal) Unlock() error {
	if p.Status != StatusLocked {
		return fmt.Errorf("%w: cannot unlock principal in %q state", ErrInvalidTransition, p.Status)
	}
	p.Status = StatusActive
	p.UpdatedAt = time.Now()
	p.Version++
	return nil
}

// Reactivate transitions a principal from disabled to active.
func (p *Principal) Reactivate() error {
	if p.Status != StatusDisabled {
		return fmt.Errorf("%w: cannot reactivate principal in %q state", ErrInvalidTransition, p.Status)
	}
	p.Status = StatusActive
	p.UpdatedAt = time.Now()
	p.Version++
	return nil
}

// SoftDelete marks the principal as deleted without physical removal.
// Only SuperAdmin can hard delete via database security-definer function.
func (p *Principal) SoftDelete(actor uuid.UUID, reason string) error {
	if reason == "" {
		return fmt.Errorf("deletion reason required for audit trail")
	}

	if p.DeletedAt != nil {
		return fmt.Errorf("principal already deleted at %v", p.DeletedAt)
	}

	now := time.Now()
	p.DeletedAt = &now
	p.DeletedBy = &actor
	p.DeletionReason = &reason
	p.UpdatedAt = now

	return nil
}

// IsDeleted checks if the principal is soft-deleted.
func (p *Principal) IsDeleted() bool {
	return p.DeletedAt != nil
}
