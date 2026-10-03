package domain

import (
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// ErrNotFound is returned when a tenant entity is not found in the repository.
var ErrNotFound = errors.New("entity not found")

// TenantStatus represents the operational state of a tenant.
type TenantStatus string

const (
	StatusActive    TenantStatus = "active"
	StatusSuspended TenantStatus = "suspended"
	StatusArchived  TenantStatus = "archived"
)

// Tenant represents a college institution in the multi-tenant system.
// Domain entity with soft delete support per ADR-0013.
type Tenant struct {
	ID          uuid.UUID
	Slug        string
	LegalName   string
	DisplayName string
	Status      TenantStatus
	Version     int
	CreatedAt   time.Time
	UpdatedAt   time.Time

	// Soft delete fields per ADR-0013
	DeletedAt      *time.Time `gorm:"index"`
	DeletedBy      *uuid.UUID
	DeletionReason *string
}

// SoftDelete marks the tenant as deleted without physical removal.
// Only SuperAdmin can hard delete via database security-definer function.
func (t *Tenant) SoftDelete(actor uuid.UUID, reason string) error {
	if reason == "" {
		return fmt.Errorf("deletion reason required for audit trail")
	}

	if t.DeletedAt != nil {
		return fmt.Errorf("tenant already deleted at %v", t.DeletedAt)
	}

	now := time.Now()
	t.DeletedAt = &now
	t.DeletedBy = &actor
	t.DeletionReason = &reason
	t.UpdatedAt = now

	return nil
}

// IsDeleted checks if the tenant is soft-deleted.
func (t *Tenant) IsDeleted() bool {
	return t.DeletedAt != nil
}

// ErrInvalidTransition is returned when a tenant status transition is not permitted.
var ErrInvalidTransition = errors.New("invalid status transition")

// Suspend transitions a tenant from active to suspended.
func (t *Tenant) Suspend(actor string, reason string) error {
	if t.Status != StatusActive {
		return fmt.Errorf("%w: cannot suspend tenant in %q state", ErrInvalidTransition, t.Status)
	}
	if reason == "" {
		return fmt.Errorf("suspension reason is required")
	}
	t.Status = StatusSuspended
	t.UpdatedAt = time.Now()
	t.Version++
	return nil
}

// Reactivate transitions a tenant from suspended to active.
func (t *Tenant) Reactivate(actor string) error {
	if t.Status != StatusSuspended {
		return fmt.Errorf("%w: cannot reactivate tenant in %q state", ErrInvalidTransition, t.Status)
	}
	t.Status = StatusActive
	t.UpdatedAt = time.Now()
	t.Version++
	return nil
}

// Archive transitions a tenant from active or suspended to archived.
func (t *Tenant) Archive(actor string, reason string) error {
	if t.Status != StatusActive && t.Status != StatusSuspended {
		return fmt.Errorf("%w: cannot archive tenant in %q state", ErrInvalidTransition, t.Status)
	}
	if reason == "" {
		return fmt.Errorf("archive reason is required")
	}
	t.Status = StatusArchived
	t.UpdatedAt = time.Now()
	t.Version++
	return nil
}

// Department represents a college or placement department.
// Domain entity with soft delete support per ADR-0013.
type Department struct {
	ID                      uuid.UUID
	TenantID                *uuid.UUID
	PlacementOrganizationID *uuid.UUID
	DepartmentType          string
	Code                    string
	Name                    string
	Status                  string
	Version                 int
	CreatedAt               time.Time
	UpdatedAt               time.Time

	// Soft delete fields per ADR-0013
	DeletedAt      *time.Time `gorm:"index"`
	DeletedBy      *uuid.UUID
	DeletionReason *string
}

// SoftDelete marks the department as deleted without physical removal.
func (d *Department) SoftDelete(actor uuid.UUID, reason string) error {
	if reason == "" {
		return fmt.Errorf("deletion reason required for audit trail")
	}

	if d.DeletedAt != nil {
		return fmt.Errorf("department already deleted at %v", d.DeletedAt)
	}

	now := time.Now()
	d.DeletedAt = &now
	d.DeletedBy = &actor
	d.DeletionReason = &reason
	d.UpdatedAt = now

	return nil
}

// IsDeleted checks if the department is soft-deleted.
func (d *Department) IsDeleted() bool {
	return d.DeletedAt != nil
}

// Batch represents an academic batch within a department.
// Domain entity with soft delete support per ADR-0013.
type Batch struct {
	ID           uuid.UUID
	TenantID     uuid.UUID
	DepartmentID uuid.UUID
	Code         string
	Name         string
	AcademicYear string
	Status       string
	Version      int
	CreatedAt    time.Time
	UpdatedAt    time.Time

	// Soft delete fields per ADR-0013
	DeletedAt      *time.Time `gorm:"index"`
	DeletedBy      *uuid.UUID
	DeletionReason *string
}

// SoftDelete marks the batch as deleted without physical removal.
func (b *Batch) SoftDelete(actor uuid.UUID, reason string) error {
	if reason == "" {
		return fmt.Errorf("deletion reason required for audit trail")
	}

	if b.DeletedAt != nil {
		return fmt.Errorf("batch already deleted at %v", b.DeletedAt)
	}

	now := time.Now()
	b.DeletedAt = &now
	b.DeletedBy = &actor
	b.DeletionReason = &reason
	b.UpdatedAt = now

	return nil
}

// IsDeleted checks if the batch is soft-deleted.
func (b *Batch) IsDeleted() bool {
	return b.DeletedAt != nil
}

// PlacementOrganization represents a placement organization.
// Domain entity with soft delete support per ADR-0013.
type PlacementOrganization struct {
	ID        uuid.UUID
	Code      string
	LegalName string
	Status    string
	Version   int
	CreatedAt time.Time
	UpdatedAt time.Time

	// Soft delete fields per ADR-0013
	DeletedAt      *time.Time `gorm:"index"`
	DeletedBy      *uuid.UUID
	DeletionReason *string
}

// SoftDelete marks the placement organization as deleted without physical removal.
func (p *PlacementOrganization) SoftDelete(actor uuid.UUID, reason string) error {
	if reason == "" {
		return fmt.Errorf("deletion reason required for audit trail")
	}

	if p.DeletedAt != nil {
		return fmt.Errorf("placement organization already deleted at %v", p.DeletedAt)
	}

	now := time.Now()
	p.DeletedAt = &now
	p.DeletedBy = &actor
	p.DeletionReason = &reason
	p.UpdatedAt = now

	return nil
}

// IsDeleted checks if the placement organization is soft-deleted.
func (p *PlacementOrganization) IsDeleted() bool {
	return p.DeletedAt != nil
}
