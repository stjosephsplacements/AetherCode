package projection

import (
	"testing"
	"time"

	"github.com/aethercode/aethercode/libs/pkg/messaging"
)

func TestParseAssignmentSnapshotAcceptsRevokedTombstone(t *testing.T) {
	t.Parallel()
	event := messaging.Event{
		ID: "018f4b0d-08f8-7c09-9ba7-efdf9c223421", Type: assessmentCandidateAssignmentEvent,
		SchemaVersion: 1, AggregateType: "candidate_assignment", AggregateID: "018f4b0d-08f8-7c09-9ba7-efdf9c223422",
		TenantID: "018f4b0d-08f8-7c09-9ba7-efdf9c223423", OccurredAt: time.Now().UTC(),
		Payload: []byte(`{"tenant_id":"018f4b0d-08f8-7c09-9ba7-efdf9c223423","candidate_assignment_id":"018f4b0d-08f8-7c09-9ba7-efdf9c223422","candidate_id":"018f4b0d-08f8-7c09-9ba7-efdf9c223424","exam_id":"018f4b0d-08f8-7c09-9ba7-efdf9c223425","exam_version_id":"018f4b0d-08f8-7c09-9ba7-efdf9c223426","available_from":"2026-07-24T00:00:00Z","available_until":"2026-07-24T01:00:00Z","attempt_limit":1,"lifecycle_state":"revoked","version":2,"items":[]}`),
	}
	payload, err := parseAssignmentSnapshot(event)
	if err != nil || payload.LifecycleState != "revoked" || payload.Version != 2 {
		t.Fatalf("parseAssignmentSnapshot() = %#v, %v", payload, err)
	}
}

func TestParseAssignmentSnapshotRejectsUnknownFields(t *testing.T) {
	t.Parallel()
	event := messaging.Event{
		ID: "018f4b0d-08f8-7c09-9ba7-efdf9c223431", Type: assessmentCandidateAssignmentEvent,
		SchemaVersion: 1, AggregateType: "candidate_assignment", AggregateID: "018f4b0d-08f8-7c09-9ba7-efdf9c223432",
		TenantID: "018f4b0d-08f8-7c09-9ba7-efdf9c223433", OccurredAt: time.Now().UTC(),
		Payload: []byte(`{"tenant_id":"018f4b0d-08f8-7c09-9ba7-efdf9c223433","candidate_assignment_id":"018f4b0d-08f8-7c09-9ba7-efdf9c223432","candidate_id":"018f4b0d-08f8-7c09-9ba7-efdf9c223434","exam_id":"018f4b0d-08f8-7c09-9ba7-efdf9c223435","exam_version_id":"018f4b0d-08f8-7c09-9ba7-efdf9c223436","available_from":"2026-07-24T00:00:00Z","available_until":"2026-07-24T01:00:00Z","attempt_limit":1,"lifecycle_state":"revoked","version":2,"items":[],"unknown":true}`),
	}
	if _, err := parseAssignmentSnapshot(event); err == nil {
		t.Fatal("parseAssignmentSnapshot() accepted an unknown field")
	}
}
