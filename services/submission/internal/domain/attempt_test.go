package domain

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
)

func TestAttempt_SoftDelete_RequiresReason(t *testing.T) {
	a := &Attempt{
		ID:                    uuid.New(),
		TenantID:              uuid.New(),
		ExamID:                uuid.New(),
		CandidateID:           uuid.New(),
		CandidateAssignmentID: uuid.New(),
		LifecycleState:        LifecycleActive,
	}

	actor := uuid.New()
	err := a.SoftDelete(actor, "")

	assert.Error(t, err)
	assert.Contains(t, err.Error(), "deletion reason required")
	assert.Nil(t, a.DeletedAt)
}

func TestAttempt_SoftDelete_Success(t *testing.T) {
	a := &Attempt{
		ID:                    uuid.New(),
		TenantID:              uuid.New(),
		ExamID:                uuid.New(),
		CandidateID:           uuid.New(),
		CandidateAssignmentID: uuid.New(),
		LifecycleState:        LifecycleActive,
	}

	actor := uuid.New()
	reason := "Exam assignment cancelled"
	err := a.SoftDelete(actor, reason)

	assert.NoError(t, err)
	assert.NotNil(t, a.DeletedAt)
	assert.Equal(t, actor, *a.DeletedBy)
	assert.Equal(t, reason, *a.DeletionReason)
}

func TestAttempt_CannotSoftDeleteTwice(t *testing.T) {
	now := time.Now()
	actor := uuid.New()
	reason := "Already deleted"

	a := &Attempt{
		ID:             uuid.New(),
		TenantID:       uuid.New(),
		ExamID:         uuid.New(),
		CandidateID:    uuid.New(),
		DeletedAt:      &now,
		DeletedBy:      &actor,
		DeletionReason: &reason,
	}

	err := a.SoftDelete(uuid.New(), "Second deletion")

	assert.Error(t, err)
	assert.Contains(t, err.Error(), "already deleted")
}

func TestAttempt_IsDeleted(t *testing.T) {
	tests := []struct {
		name          string
		attempt       *Attempt
		expectDeleted bool
	}{
		{
			name: "not deleted",
			attempt: &Attempt{
				ID:          uuid.New(),
				TenantID:    uuid.New(),
				ExamID:      uuid.New(),
				CandidateID: uuid.New(),
				DeletedAt:   nil,
			},
			expectDeleted: false,
		},
		{
			name: "soft deleted",
			attempt: &Attempt{
				ID:          uuid.New(),
				TenantID:    uuid.New(),
				ExamID:      uuid.New(),
				CandidateID: uuid.New(),
				DeletedAt:   ptrTime(time.Now()),
			},
			expectDeleted: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.expectDeleted, tt.attempt.IsDeleted())
		})
	}
}

// Hard delete authorization is enforced by the Casbin central authorization service
// (via AuthorizeHTTP with action "delete"), not at the domain entity level.

// Helper function for pointer to time
func ptrTime(t time.Time) *time.Time {
	return &t
}
