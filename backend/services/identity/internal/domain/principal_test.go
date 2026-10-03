package domain

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestPrincipal_SoftDelete(t *testing.T) {
	t.Run("successful soft delete", func(t *testing.T) {
		principal := &Principal{
			ID:          uuid.New(),
			Email:       "test@example.com",
			DisplayName: "Test User",
			Status:      StatusActive,
			CreatedAt:   time.Now().Add(-24 * time.Hour),
			UpdatedAt:   time.Now().Add(-24 * time.Hour),
		}

		actor := uuid.New()
		reason := "Account deactivation requested by user"

		err := principal.SoftDelete(actor, reason)
		if err != nil {
			t.Fatalf("expected no error, got %v", err)
		}

		if principal.DeletedAt == nil {
			t.Error("expected DeletedAt to be set")
		}
		if principal.DeletedBy == nil || *principal.DeletedBy != actor {
			t.Errorf("expected DeletedBy to be %v, got %v", actor, principal.DeletedBy)
		}
		if principal.DeletionReason == nil || *principal.DeletionReason != reason {
			t.Errorf("expected DeletionReason to be %q, got %v", reason, principal.DeletionReason)
		}
		if !principal.IsDeleted() {
			t.Error("expected IsDeleted to return true")
		}
	})

	t.Run("requires deletion reason", func(t *testing.T) {
		principal := &Principal{
			ID:     uuid.New(),
			Status: StatusActive,
		}

		err := principal.SoftDelete(uuid.New(), "")
		if err == nil {
			t.Error("expected error for empty deletion reason")
		}
	})

	t.Run("prevents double deletion", func(t *testing.T) {
		deletedAt := time.Now().Add(-1 * time.Hour)
		principal := &Principal{
			ID:        uuid.New(),
			Status:    StatusActive,
			DeletedAt: &deletedAt,
		}

		err := principal.SoftDelete(uuid.New(), "Second deletion attempt")
		if err == nil {
			t.Error("expected error when deleting already deleted principal")
		}
	})
}

func TestPrincipal_IsDeleted(t *testing.T) {
	t.Run("returns false for active principal", func(t *testing.T) {
		principal := &Principal{
			ID:     uuid.New(),
			Status: StatusActive,
		}

		if principal.IsDeleted() {
			t.Error("expected IsDeleted to return false for active principal")
		}
	})

	t.Run("returns true for deleted principal", func(t *testing.T) {
		deletedAt := time.Now()
		principal := &Principal{
			ID:        uuid.New(),
			Status:    StatusActive,
			DeletedAt: &deletedAt,
		}

		if !principal.IsDeleted() {
			t.Error("expected IsDeleted to return true for deleted principal")
		}
	})
}

// Hard delete authorization is enforced by the Casbin central authorization service
// (via AuthorizeHTTP with action "delete"), not at the domain entity level.
