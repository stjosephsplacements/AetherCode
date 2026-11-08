package repo

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/stjosephsplacements/AetherCode/services/user/internal/app"
	"github.com/stretchr/testify/require"
)

const (
	snapshotTenantID    = "018f4b0d-08f8-7c09-9ba7-efdf9c220911"
	snapshotStudentID   = "018f4b0d-08f8-7c09-9ba7-efdf9c220912"
	snapshotPrincipalID = "018f4b0d-08f8-7c09-9ba7-efdf9c220915"
	snapshotBatchID     = "018f4b0d-08f8-7c09-9ba7-efdf9c220913"
	snapshotActorID     = "018f4b0d-08f8-7c09-9ba7-efdf9c220914"
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
		placement := snapshotActorID
		payload, err := studentBatchAffiliationSnapshotPayload(affiliation, snapshotPrincipalID, &placement)
		if err != nil {
			t.Fatalf("studentBatchAffiliationSnapshotPayload() error = %v", err)
		}
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(payload, &fields); err != nil {
			t.Fatalf("decode payload: %v", err)
		}
		if len(fields) != 7 {
			t.Fatalf("payload fields = %d, want exactly 7: %s", len(fields), payload)
		}
		for _, field := range []string{"tenant_id", "student_id", "principal_id", "batch_id", "placement_department_id", "lifecycle_state", "version"} {
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


func TestLikePatternEscapesWhatLIKEReads(t *testing.T) {
	t.Parallel()
	require.Nil(t, likePattern("   "))
	require.Equal(t, "%21cs%", likePattern(" 21cs "))
	require.Equal(t, `%50\%\_a\\b%`, likePattern(`50%_a\b`))
}
