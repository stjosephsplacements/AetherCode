package domain

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestTenant_SoftDelete(t *testing.T) {
	tenantID := uuid.New()
	actorID := uuid.New()

	t.Run("successful soft delete", func(t *testing.T) {
		tenant := &Tenant{
			ID:     tenantID,
			Status: StatusActive,
		}

		err := tenant.SoftDelete(actorID, "Tenant closure")
		if err != nil {
			t.Fatalf("expected no error, got %v", err)
		}

		if tenant.DeletedAt == nil {
			t.Error("expected DeletedAt to be set")
		}
		if tenant.DeletedBy == nil || *tenant.DeletedBy != actorID {
			t.Error("expected DeletedBy to be set to actor ID")
		}
		if tenant.DeletionReason == nil || *tenant.DeletionReason != "Tenant closure" {
			t.Error("expected DeletionReason to be set")
		}
		if !tenant.IsDeleted() {
			t.Error("expected IsDeleted to return true")
		}
	})

	t.Run("reject soft delete without reason", func(t *testing.T) {
		tenant := &Tenant{
			ID:     tenantID,
			Status: StatusActive,
		}

		err := tenant.SoftDelete(actorID, "")
		if err == nil {
			t.Fatal("expected error for missing deletion reason")
		}
	})

	t.Run("reject soft delete on already deleted tenant", func(t *testing.T) {
		now := time.Now()
		tenant := &Tenant{
			ID:        tenantID,
			DeletedAt: &now,
		}

		err := tenant.SoftDelete(actorID, "Reason")
		if err == nil {
			t.Fatal("expected error for already deleted tenant")
		}
	})
}

// Hard delete authorization is enforced by the Casbin central authorization service
// (via AuthorizeHTTP with action "delete"), not at the domain entity level.

func TestDepartment_SoftDelete(t *testing.T) {
	deptID := uuid.New()
	actorID := uuid.New()

	t.Run("successful soft delete", func(t *testing.T) {
		dept := &Department{
			ID:   deptID,
			Code: "CS",
		}

		err := dept.SoftDelete(actorID, "Department restructure")
		if err != nil {
			t.Fatalf("expected no error, got %v", err)
		}

		if dept.DeletedAt == nil {
			t.Error("expected DeletedAt to be set")
		}
		if !dept.IsDeleted() {
			t.Error("expected IsDeleted to return true")
		}
	})
}

func TestBatch_SoftDelete(t *testing.T) {
	batchID := uuid.New()
	actorID := uuid.New()

	t.Run("successful soft delete", func(t *testing.T) {
		batch := &Batch{
			ID:   batchID,
			Code: "2024-CS",
		}

		err := batch.SoftDelete(actorID, "Batch completed")
		if err != nil {
			t.Fatalf("expected no error, got %v", err)
		}

		if batch.DeletedAt == nil {
			t.Error("expected DeletedAt to be set")
		}
		if !batch.IsDeleted() {
			t.Error("expected IsDeleted to return true")
		}
	})
}

func TestPlacementOrganization_SoftDelete(t *testing.T) {
	orgID := uuid.New()
	actorID := uuid.New()

	t.Run("successful soft delete", func(t *testing.T) {
		org := &PlacementOrganization{
			ID:   orgID,
			Code: "ORG001",
		}

		err := org.SoftDelete(actorID, "Organization dissolved")
		if err != nil {
			t.Fatalf("expected no error, got %v", err)
		}

		if org.DeletedAt == nil {
			t.Error("expected DeletedAt to be set")
		}
		if !org.IsDeleted() {
			t.Error("expected IsDeleted to return true")
		}
	})
}
