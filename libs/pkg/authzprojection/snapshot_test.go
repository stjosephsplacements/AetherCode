package authzprojection

import (
	"testing"
	"time"

	"github.com/aethercode/aethercode/libs/pkg/messaging"
)

const (
	testEventID  = "018f4b0d-08f8-7c09-9ba7-efdf9c223001"
	testActorID  = "018f4b0d-08f8-7c09-9ba7-efdf9c223002"
	testTenantID = "018f4b0d-08f8-7c09-9ba7-efdf9c223003"
)

func TestParseSnapshotAcceptsCompleteGrantSet(t *testing.T) {
	event := messaging.Event{
		ID:            testEventID,
		Type:          SnapshotEventType,
		SchemaVersion: 1,
		AggregateType: "principal",
		AggregateID:   testActorID,
		OccurredAt:    time.Now().UTC(),
		Payload: []byte(`{
			"principal_id":"018f4b0d-08f8-7c09-9ba7-efdf9c223002",
			"authz_revision":7,
			"reason":"role_changed",
			"grants":[{
				"grant_kind":"tenant",
				"tenant_id":"018f4b0d-08f8-7c09-9ba7-efdf9c223003",
				"grant_source_id":"018f4b0d-08f8-7c09-9ba7-efdf9c223003",
				"expires_at":""
			}]
		}`),
	}
	payload, err := parseSnapshot(event)
	if err != nil {
		t.Fatalf("parse valid snapshot: %v", err)
	}
	if payload.PrincipalID != testActorID || payload.AuthorizationRev != 7 || len(payload.Grants) != 1 {
		t.Fatalf("unexpected parsed payload: %#v", payload)
	}
}

func TestParseSnapshotRejectsDuplicateAndTrailingPayload(t *testing.T) {
	for _, payload := range [][]byte{
		[]byte(`{"principal_id":"018f4b0d-08f8-7c09-9ba7-efdf9c223002","authz_revision":1,"reason":"test","grants":[{"grant_kind":"tenant","tenant_id":"018f4b0d-08f8-7c09-9ba7-efdf9c223003","grant_source_id":"018f4b0d-08f8-7c09-9ba7-efdf9c223003","expires_at":""},{"grant_kind":"tenant","tenant_id":"018f4b0d-08f8-7c09-9ba7-efdf9c223003","grant_source_id":"018f4b0d-08f8-7c09-9ba7-efdf9c223003","expires_at":""}]}`),
		[]byte(`{"principal_id":"018f4b0d-08f8-7c09-9ba7-efdf9c223002","authz_revision":1,"reason":"test","grants":[]} {}`),
	} {
		_, err := parseSnapshot(messaging.Event{
			ID: testEventID, Type: SnapshotEventType, SchemaVersion: 1,
			AggregateType: "principal", AggregateID: testActorID,
			OccurredAt: time.Now().UTC(), Payload: payload,
		})
		if err == nil {
			t.Fatalf("expected invalid snapshot payload to fail: %s", payload)
		}
	}
}
