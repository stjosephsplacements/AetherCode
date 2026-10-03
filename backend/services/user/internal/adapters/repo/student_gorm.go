package repo

import (
	"context"
	"errors"
	"fmt"

	"github.com/aethercode/aethercode/libs/pkg/database"
	"github.com/aethercode/aethercode/services/user/internal/domain"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// StudentGormRepo provides GORM-based student repository operations with soft delete support.
// This repository demonstrates ADR-0013 soft delete integration at the repository layer.
type StudentGormRepo struct {
	db *gorm.DB
}

// NewStudentGormRepo creates a new GORM-based student repository.
func NewStudentGormRepo(db *gorm.DB) *StudentGormRepo {
	return &StudentGormRepo{db: db}
}

// CreateStudent creates a new student record.
func (r *StudentGormRepo) CreateStudent(ctx context.Context, s *domain.Student) error {
	return r.db.WithContext(ctx).Create(s).Error
}

// GetStudentByID retrieves active (non-deleted) student by ID.
// Soft-deleted records are automatically filtered by the default scope.
func (r *StudentGormRepo) GetStudentByID(ctx context.Context, id uuid.UUID) (*domain.Student, error) {
	var s domain.Student
	err := r.db.WithContext(ctx).
		Scopes(database.SoftDeleteScope()).
		Where("id = ?", id).
		First(&s).Error

	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("query student: %w", err)
	}

	return &s, nil
}

// GetStudentByIDIncludeDeleted retrieves student including soft-deleted.
// Requires authorization check before calling (SuperAdmin or role with archive access).
func (r *StudentGormRepo) GetStudentByIDIncludeDeleted(ctx context.Context, id uuid.UUID) (*domain.Student, error) {
	var s domain.Student
	err := r.db.WithContext(ctx).
		Scopes(database.IncludeDeletedScope()).
		Where("id = ?", id).
		First(&s).Error

	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("query student: %w", err)
	}

	return &s, nil
}

// SoftDeleteStudent marks student as deleted with audit trail.
// Uses shared database.SoftDelete function from Task 2.
func (r *StudentGormRepo) SoftDeleteStudent(ctx context.Context, id, actor uuid.UUID, reason string) error {
	return database.SoftDelete(ctx, r.db, database.SoftDeleteParams{
		Table:  "users.students",
		ID:     id,
		Actor:  actor,
		Reason: reason,
	})
}

// HardDeleteStudent permanently removes student via security-definer function.
// Only SuperAdmin can execute this (enforced via RLS and function).
func (r *StudentGormRepo) HardDeleteStudent(ctx context.Context, id, actor uuid.UUID, reason string) error {
	return database.HardDelete(ctx, r.db, database.HardDeleteParams{
		Table:  "users.students",
		ID:     id,
		Actor:  actor,
		Reason: reason,
	})
}
