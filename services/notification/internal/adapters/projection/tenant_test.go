package projection

import (
	"testing"
	"time"

	"github.com/aethercode/aethercode/libs/pkg/messaging"
)

func TestParseRetentionPolicyAcceptsVersionedTenantPayload(t *testing.T) {
	t.Parallel()
	event := messaging.Event{
		ID: "018f4b0d-08f8-7c09-9ba7-efdf9c220611", Type: RetentionPolicyEvent, SchemaVersion: 1,
		AggregateType: "retention_policy", AggregateID: "018f4b0d-08f8-7c09-9ba7-efdf9c220612",
		TenantID: "018f4b0d-08f8-7c09-9ba7-efdf9c220612", OccurredAt: time.Now().UTC(),
		Payload: []byte(`{"tenant_id":"018f4b0d-08f8-7c09-9ba7-efdf9c220612","notification_delivery_days":90,"version":2}`),
	}
	payload, err := parseRetentionPolicy(event)
	if err != nil || payload.Version != 2 || payload.NotificationDeliveryDays != 90 {
		t.Fatalf("parseRetentionPolicy() = %#v, %v", payload, err)
	}
}

func TestParseLegalHoldRejectsScopeMismatch(t *testing.T) {
	t.Parallel()
	event := messaging.Event{
		ID: "018f4b0d-08f8-7c09-9ba7-efdf9c220621", Type: LegalHoldPlacedEvent, SchemaVersion: 1,
		AggregateType: "legal_hold", AggregateID: "018f4b0d-08f8-7c09-9ba7-efdf9c220622",
		TenantID: "018f4b0d-08f8-7c09-9ba7-efdf9c220623", OccurredAt: time.Now().UTC(),
		Payload: []byte(`{"legal_hold_id":"018f4b0d-08f8-7c09-9ba7-efdf9c220622","tenant_id":"018f4b0d-08f8-7c09-9ba7-efdf9c220623","scope":"tenant","subject_id":"018f4b0d-08f8-7c09-9ba7-efdf9c220624","status":"active"}`),
	}
	if _, err := parseLegalHold(event, LegalHoldPlacedEvent, "active"); err == nil {
		t.Fatal("parseLegalHold() accepted a tenant hold with a subject")
	}
}
