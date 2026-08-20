package repo

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/aethercode/aethercode/services/user/internal/app"
	"github.com/aethercode/aethercode/services/user/internal/domain"
	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

const (
	snapshotTenantID  = "018f4b0d-08f8-7c09-9ba7-efdf9c220911"
	snapshotStudentID = "018f4b0d-08f8-7c09-9ba7-efdf9c220912"
	snapshotBatchID   = "018f4b0d-08f8-7c09-9ba7-efdf9c220913"
	snapshotActorID   = "018f4b0d-08f8-7c09-9ba7-efdf9c220914"
)

func TestStudentBatchAffiliationSnapshotPayloadIsStrictAndRetainsNullBatch(t *testing.T) {
	t.Parallel()
	activeBatchID := snapshotBatchID
	for _, affiliation := range []app.StudentBatchAffiliation{
		{
			StudentID: snapshotStudentID, TenantID: snapshotTenantID, BatchID: &activeBatchID,
			LifecycleState: "active", Version: 2, UpdatedAt: time.Now().UTC(),
		},
		{
			StudentID: snapshotStudentID, TenantID: snapshotTenantID, BatchID: nil,
			LifecycleState: "inactive", Version: 3, UpdatedAt: time.Now().UTC(),
		},
	} {
		payload, err := studentBatchAffiliationSnapshotPayload(affiliation)
		if err != nil {
			t.Fatalf("studentBatchAffiliationSnapshotPayload() error = %v", err)
		}
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(payload, &fields); err != nil {
			t.Fatalf("decode payload: %v", err)
		}
		if len(fields) != 5 {
			t.Fatalf("payload fields = %d, want exactly 5: %s", len(fields), payload)
		}
		for _, field := range []string{"tenant_id", "student_id", "batch_id", "lifecycle_state", "version"} {
			if _, found := fields[field]; !found {
				t.Fatalf("payload omitted required field %q: %s", field, payload)
			}
		}
		if affiliation.BatchID == nil && string(fields["batch_id"]) != "null" {
			t.Fatalf("inactive snapshot batch_id = %s, want null", fields["batch_id"])
		}
	}
}

func TestStudentBatchAffiliationIdempotencyScopeIsPerActorAndOperation(t *testing.T) {
	t.Parallel()
	setScope, err := studentBatchAffiliationCommandScope("set", snapshotTenantID, snapshotStudentID, snapshotActorID)
	if err != nil {
		t.Fatalf("studentBatchAffiliationCommandScope() error = %v", err)
	}
	revokeScope, err := studentBatchAffiliationCommandScope("revoke", snapshotTenantID, snapshotStudentID, snapshotActorID)
	if err != nil {
		t.Fatalf("studentBatchAffiliationCommandScope() error = %v", err)
	}
	if setScope == revokeScope || len(setScope) > 127 {
		t.Fatalf("idempotency scopes = %q, %q; want unique valid scopes", setScope, revokeScope)
	}
	if _, err := studentBatchAffiliationCommandScope("invalid", snapshotTenantID, snapshotStudentID, snapshotActorID); err == nil {
		t.Fatal("studentBatchAffiliationCommandScope() accepted an invalid operation")
	}
}

// testGormDB creates a test GORM database connection.
// This is a placeholder helper that will need actual test database setup.
func testGormDB(t *testing.T) *gorm.DB {
	t.Skip("Integration test requires test database setup")
	return nil
}

func TestStudentGormRepo_SoftDeleteStudent_FiltersFromQueries(t *testing.T) {
	ctx := context.Background()
	db := testGormDB(t)
	repo := NewStudentGormRepo(db)

	// Create student
	s := &domain.Student{
		ID:               uuid.New(),
		PrincipalID:      uuid.New(),
		TenantID:         uuid.New(),
		EnrollmentNumber: "TEST001",
		Status:           domain.StatusActive,
	}
	require.NoError(t, repo.CreateStudent(ctx, s))

	// Soft delete
	actor := uuid.New()
	require.NoError(t, repo.SoftDeleteStudent(ctx, s.ID, actor, "Test deletion"))

	// Verify not found in default queries
	_, err := repo.GetStudentByID(ctx, s.ID)
	assert.ErrorIs(t, err, domain.ErrNotFound)

	// Verify accessible with IncludeDeleted
	deleted, err := repo.GetStudentByIDIncludeDeleted(ctx, s.ID)
	require.NoError(t, err)
	assert.NotNil(t, deleted.DeletedAt)
	assert.Equal(t, actor, *deleted.DeletedBy)
}
