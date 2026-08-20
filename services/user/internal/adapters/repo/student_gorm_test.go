package repo

import (
	"testing"

	"github.com/aethercode/aethercode/services/user/internal/domain"
	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
)

// TestStudentGormRepo_RepositoryExists verifies that the GORM repository can be instantiated.
// This is a smoke test to ensure the constructor works.
func TestStudentGormRepo_RepositoryExists(t *testing.T) {
	repo := NewStudentGormRepo(nil)
	assert.NotNil(t, repo)
}

// TestSoftDeleteIntegrationPattern documents the expected integration test pattern.
// The actual integration test is in postgres_test.go but requires a test database.
func TestSoftDeleteIntegrationPattern(t *testing.T) {
	t.Log("Integration test pattern:")
	t.Log("1. Create a student record")
	t.Log("2. Soft delete the student using SoftDeleteStudent()")
	t.Log("3. Verify GetStudentByID() returns ErrNotFound (default scope filters deleted)")
	t.Log("4. Verify GetStudentByIDIncludeDeleted() returns the student with DeletedAt populated")
	t.Log("5. Verify DeletedBy matches the actor UUID")
	t.Log("6. Verify DeletionReason matches the provided reason")
}

// TestDomainErrorExists verifies the domain error is properly defined.
func TestDomainErrorExists(t *testing.T) {
	err := domain.ErrNotFound
	assert.NotNil(t, err)
	assert.Equal(t, "student not found", err.Error())
}

// TestDomainSoftDelete verifies domain entity soft delete logic.
func TestDomainSoftDelete(t *testing.T) {
	s := &domain.Student{
		ID:               uuid.New(),
		PrincipalID:      uuid.New(),
		TenantID:         uuid.New(),
		EnrollmentNumber: "TEST001",
		Status:           domain.StatusActive,
	}

	actor := uuid.New()
	reason := "Test deletion"

	// Verify soft delete works
	err := s.SoftDelete(actor, reason)
	assert.NoError(t, err)
	assert.NotNil(t, s.DeletedAt)
	assert.Equal(t, actor, *s.DeletedBy)
	assert.Equal(t, reason, *s.DeletionReason)
	assert.True(t, s.IsDeleted())

	// Verify double delete fails
	err = s.SoftDelete(actor, reason)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "already deleted")
}
