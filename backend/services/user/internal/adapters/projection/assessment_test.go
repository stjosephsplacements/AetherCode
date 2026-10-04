package projection

import (
	"fmt"
	"strings"
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

// Assessment migration 000020 pins key references and the sample bundle on
// every item; items pinned earlier carry nulls. Both must decode.
func TestParseAssignmentSnapshotAcceptsPinnedBundleReferences(t *testing.T) {
	t.Parallel()
	item := `{"exam_item_id":"018f4b0d-08f8-7c09-9ba7-efdf9c223427","evaluation_bundle_object_key":"qbank/e.bundle","evaluation_bundle_checksum":"` + strings.Repeat("a", 64) + `","maximum_score":10,%s}`
	for name, extra := range map[string]string{
		"pinned": `"evaluation_bundle_key_reference":"local:k","sample_bundle_object_key":"qbank/s.bundle","sample_bundle_checksum":"` + strings.Repeat("b", 64) + `","sample_bundle_key_reference":"local:k"`,
		"legacy": `"evaluation_bundle_key_reference":null,"sample_bundle_object_key":null,"sample_bundle_checksum":null,"sample_bundle_key_reference":null`,
	} {
		event := messaging.Event{
			ID: "018f4b0d-08f8-7c09-9ba7-efdf9c223421", Type: assessmentCandidateAssignmentEvent,
			SchemaVersion: 1, AggregateType: "candidate_assignment", AggregateID: "018f4b0d-08f8-7c09-9ba7-efdf9c223422",
			TenantID: "018f4b0d-08f8-7c09-9ba7-efdf9c223423", OccurredAt: time.Now().UTC(),
			Payload: []byte(`{"tenant_id":"018f4b0d-08f8-7c09-9ba7-efdf9c223423","candidate_assignment_id":"018f4b0d-08f8-7c09-9ba7-efdf9c223422","candidate_id":"018f4b0d-08f8-7c09-9ba7-efdf9c223424","exam_id":"018f4b0d-08f8-7c09-9ba7-efdf9c223425","exam_version_id":"018f4b0d-08f8-7c09-9ba7-efdf9c223426","available_from":"2026-07-24T00:00:00Z","available_until":"2026-07-24T01:00:00Z","attempt_limit":1,"lifecycle_state":"active","version":1,"items":[` + fmt.Sprintf(item, extra) + `]}`),
		}
		if payload, err := parseAssignmentSnapshot(event); err != nil || len(payload.Items) != 1 {
			t.Fatalf("%s: parseAssignmentSnapshot() = %#v, %v", name, payload, err)
		}
	}
}
