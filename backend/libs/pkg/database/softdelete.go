package database

import (
	"context"
	"fmt"
	"regexp"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// tableNamePattern validates table names in the format "schema.tablename"
// where both parts contain only alphanumeric characters and underscores.
var tableNamePattern = regexp.MustCompile(`^[a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_]*$`)

// validateTableName checks if the table name is safe for SQL interpolation.
// Returns an error if the table name doesn't match the expected format.
func validateTableName(table string) error {
	if !tableNamePattern.MatchString(table) {
		return fmt.Errorf("invalid table name format: must be 'schema.tablename' with only alphanumeric and underscore characters")
	}
	return nil
}

// SoftDeleteScope returns a GORM scope that filters out soft-deleted records.
// Use this as the default query scope for all models with deleted_at columns.
func SoftDeleteScope() func(db *gorm.DB) *gorm.DB {
	return func(db *gorm.DB) *gorm.DB {
		return db.Where("deleted_at IS NULL")
	}
}

// IncludeDeletedScope returns a GORM scope that includes soft-deleted records.
// Use when explicitly querying archived data (requires authorization check).
func IncludeDeletedScope() func(db *gorm.DB) *gorm.DB {
	return func(db *gorm.DB) *gorm.DB {
		return db.Unscoped()
	}
}

// SoftDeleteParams holds parameters for soft delete operations.
type SoftDeleteParams struct {
	Table    string     // Table name (e.g., "users.students")
	ID       uuid.UUID  // Record primary key
	Actor    uuid.UUID  // Principal performing deletion
	Reason   string     // Deletion reason for audit
	TenantID *uuid.UUID // Optional: tenant context for RLS
}

// SoftDelete marks a record as deleted without physical removal.
// Sets deleted_at, deleted_by, and deletion_reason columns.
func SoftDelete(ctx context.Context, tx *gorm.DB, params SoftDeleteParams) error {
	if err := validateTableName(params.Table); err != nil {
		return fmt.Errorf("soft delete validation failed: %w", err)
	}

	if params.Reason == "" {
		return fmt.Errorf("deletion reason is required for audit trail")
	}

	now := time.Now()
	query := fmt.Sprintf(
		"UPDATE %s SET deleted_at = ?, deleted_by = ?, deletion_reason = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
		params.Table,
	)

	result := tx.WithContext(ctx).Exec(query, now, params.Actor, params.Reason, now, params.ID)
	if result.Error != nil {
		return fmt.Errorf("soft delete failed: %w", result.Error)
	}

	if result.RowsAffected == 0 {
		return fmt.Errorf("record not found or already deleted: %s/%s", params.Table, params.ID)
	}

	return nil
}

// HardDeleteParams holds parameters for hard delete operations.
type HardDeleteParams struct {
	Table  string    // Table name
	ID     uuid.UUID // Record primary key
	Actor  uuid.UUID // SuperAdmin principal performing deletion
	Reason string    // Deletion reason (required for SuperAdmin audit)
}

// HardDelete permanently removes a record via security-definer function.
// Only SuperAdmin role can execute this. RLS policies enforce the restriction.
func HardDelete(ctx context.Context, tx *gorm.DB, params HardDeleteParams) error {
	if err := validateTableName(params.Table); err != nil {
		return fmt.Errorf("hard delete validation failed: %w", err)
	}

	if params.Reason == "" {
		return fmt.Errorf("hard delete reason is required for SuperAdmin audit")
	}

	// Call security-definer function that checks SuperAdmin role via RLS
	query := "SELECT app.hard_delete(?, ?, ?, ?)"
	var success bool
	err := tx.WithContext(ctx).Raw(query, params.Table, params.ID, params.Actor, params.Reason).Scan(&success).Error
	if err != nil {
		return fmt.Errorf("hard delete failed: %w", err)
	}

	if !success {
		return fmt.Errorf("hard delete denied: insufficient permissions or record not found")
	}

	return nil
}

// RestoreParams holds parameters for restore (undelete) operations.
type RestoreParams struct {
	Table string    // Table name (e.g., "users.students")
	ID    uuid.UUID // Record primary key
	Actor uuid.UUID // Principal performing restore
}

// Restore reverses a soft delete by clearing deletion fields.
// Only works on soft-deleted records (deleted_at IS NOT NULL).
func Restore(ctx context.Context, tx *gorm.DB, params RestoreParams) error {
	if err := validateTableName(params.Table); err != nil {
		return fmt.Errorf("restore validation failed: %w", err)
	}

	query := fmt.Sprintf(
		"UPDATE %s SET deleted_at = NULL, deleted_by = NULL, deletion_reason = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL",
		params.Table,
	)

	result := tx.WithContext(ctx).Exec(query, time.Now(), params.ID)
	if result.Error != nil {
		return fmt.Errorf("restore failed: %w", result.Error)
	}

	if result.RowsAffected == 0 {
		return fmt.Errorf("record not found or not deleted: %s/%s", params.Table, params.ID)
	}

	return nil
}

// MarkDeleted is a GORM callback that automatically sets deleted_at.
// Register this callback in models that support soft delete.
func MarkDeleted(db *gorm.DB) {
	if db.Statement.Schema != nil {
		if _, ok := db.Statement.Schema.FieldsByDBName["deleted_at"]; ok {
			db.Statement.SetColumn("deleted_at", time.Now())
		}
	}
}
