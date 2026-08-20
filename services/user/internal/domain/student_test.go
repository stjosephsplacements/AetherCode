package domain

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
)

func TestStudent_SoftDelete_RequiresReason(t *testing.T) {
	s := &Student{
		ID:               uuid.New(),
		PrincipalID:      uuid.New(),
		TenantID:         uuid.New(),
		EnrollmentNumber: "TEST001",
		Status:           StatusActive,
	}

	actor := uuid.New()
	err := s.SoftDelete(actor, "")

	assert.Error(t, err)
	assert.Contains(t, err.Error(), "deletion reason required")
	assert.Nil(t, s.DeletedAt)
}

func TestStudent_SoftDelete_Success(t *testing.T) {
	s := &Student{
		ID:               uuid.New(),
		PrincipalID:      uuid.New(),
		TenantID:         uuid.New(),
		EnrollmentNumber: "TEST001",
		Status:           StatusActive,
	}

	actor := uuid.New()
	reason := "Student withdrew from program"
	err := s.SoftDelete(actor, reason)

	assert.NoError(t, err)
	assert.NotNil(t, s.DeletedAt)
	assert.Equal(t, actor, *s.DeletedBy)
	assert.Equal(t, reason, *s.DeletionReason)
}

func TestStudent_CannotSoftDeleteTwice(t *testing.T) {
	now := time.Now()
	actor := uuid.New()
	reason := "Already deleted"

	s := &Student{
		ID:             uuid.New(),
		PrincipalID:    uuid.New(),
		TenantID:       uuid.New(),
		DeletedAt:      &now,
		DeletedBy:      &actor,
		DeletionReason: &reason,
	}

	err := s.SoftDelete(uuid.New(), "Second deletion")

	assert.Error(t, err)
	assert.Contains(t, err.Error(), "already deleted")
}

func TestStudent_IsDeleted(t *testing.T) {
	tests := []struct {
		name          string
		student       *Student
		expectDeleted bool
	}{
		{
			name: "not deleted",
			student: &Student{
				ID:          uuid.New(),
				PrincipalID: uuid.New(),
				TenantID:    uuid.New(),
				DeletedAt:   nil,
			},
			expectDeleted: false,
		},
		{
			name: "soft deleted",
			student: &Student{
				ID:          uuid.New(),
				PrincipalID: uuid.New(),
				TenantID:    uuid.New(),
				DeletedAt:   ptrTime(time.Now()),
			},
			expectDeleted: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.expectDeleted, tt.student.IsDeleted())
		})
	}
}

// Hard delete authorization is enforced by the Casbin central authorization service
// (via AuthorizeHTTP with action "delete"), not at the domain entity level.

// Helper function for pointer to time
func ptrTime(t time.Time) *time.Time {
	return &t
}
