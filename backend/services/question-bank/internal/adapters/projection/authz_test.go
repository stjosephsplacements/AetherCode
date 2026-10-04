package projection

import (
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/aethercode/aethercode/libs/pkg/messaging"
)

const (
	testEventID     = "018f4b0d-08f8-7c09-9ba7-efdf9c220001"
	testPrincipalID = "018f4b0d-08f8-7c09-9ba7-efdf9c220002"
	testTenantID    = "018f4b0d-08f8-7c09-9ba7-efdf9c220003"
	testDepartment  = "018f4b0d-08f8-7c09-9ba7-efdf9c220004"
)

func TestParseSnapshotExtractsPlatformGrant(t *testing.T) {
	payload := map[string]any{
		"principal_id":   testPrincipalID,
		"authz_revision": 7,
		"reason":         "role.assigned",
		"grants": []map[string]string{
			{
				"grant_kind": "platform", "tenant_id": zeroUUID,
				"grant_source_id": zeroUUID, "expires_at": "2026-07-24T12:00:00Z",
			},
			{
				"grant_kind": "placement", "tenant_id": testTenantID,
				"grant_source_id": testDepartment, "expires_at": "",
			},
		},
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := parseSnapshot(messaging.Event{
		ID: testEventID, Type: AuthorizationSnapshotEventType, SchemaVersion: 1,
		AggregateType: "principal", AggregateID: testPrincipalID,
		OccurredAt: time.Now().UTC(), Payload: raw,
	})
	if err != nil {
		t.Fatalf("parseSnapshot() error = %v", err)
	}
	if !parsed.HasGlobalAccess || parsed.GlobalExpiresAt == nil || parsed.AuthorizationRevision != 7 {
		t.Fatalf("parsed snapshot = %#v", parsed)
	}
}

func TestParseSnapshotTreatsEmptyGrantsAsRevocation(t *testing.T) {
	raw := []byte(`{"principal_id":"018f4b0d-08f8-7c09-9ba7-efdf9c220002","authz_revision":8,"reason":"role.revoked","grants":[]}`)
	parsed, err := parseSnapshot(messaging.Event{
		ID: testEventID, Type: AuthorizationSnapshotEventType, SchemaVersion: 1,
		AggregateType: "principal", AggregateID: testPrincipalID,
		OccurredAt: time.Now().UTC(), Payload: raw,
	})
	if err != nil {
		t.Fatalf("parseSnapshot() error = %v", err)
	}
	if parsed.HasGlobalAccess || parsed.GlobalExpiresAt != nil {
		t.Fatalf("empty grants were not interpreted as a revoke: %#v", parsed)
	}
}

func TestParseSnapshotRejectsInvalidGlobalScope(t *testing.T) {
	raw := []byte(`{"principal_id":"018f4b0d-08f8-7c09-9ba7-efdf9c220002","authz_revision":8,"reason":"role.revoked","grants":[{"grant_kind":"platform","tenant_id":"018f4b0d-08f8-7c09-9ba7-efdf9c220003","grant_source_id":"00000000-0000-0000-0000-000000000000","expires_at":""}]}`)
	_, err := parseSnapshot(messaging.Event{
		ID: testEventID, Type: AuthorizationSnapshotEventType, SchemaVersion: 1,
		AggregateType: "principal", AggregateID: testPrincipalID,
		OccurredAt: time.Now().UTC(), Payload: raw,
	})
	if err == nil {
		t.Fatal("parseSnapshot() accepted an invalid platform grant scope")
	}
}

func parseTestSnapshot(t *testing.T, grants string) (authorizationSnapshot, error) {
	t.Helper()
	raw := []byte(`{"principal_id":"` + testPrincipalID + `","authz_revision":9,"reason":"staff_authoring_grant","grants":` + grants + `}`)
	return parseSnapshot(messaging.Event{
		ID: testEventID, Type: AuthorizationSnapshotEventType, SchemaVersion: 1,
		AggregateType: "principal", AggregateID: testPrincipalID,
		OccurredAt: time.Now().UTC(), Payload: raw,
	})
}

// ADR-0020: a staff tenant grant authors the global bank; a plain tenant
// grant (a student or mentor) does not.
func TestParseSnapshotGrantsGlobalAccessToStaffAuthoring(t *testing.T) {
	tenantGrant := `{"grant_kind":"tenant","tenant_id":"` + testTenantID + `","grant_source_id":"` + testTenantID + `","expires_at":"%s"%s}`
	for _, scenario := range []struct {
		name       string
		grants     string
		wantAccess bool
		wantExpiry bool
	}{
		{"student tenant grant", "[" + fmt.Sprintf(tenantGrant, "", "") + "]", false, false},
		{"staff tenant grant", "[" + fmt.Sprintf(tenantGrant, "", `,"authoring":true`) + "]", true, false},
		{"expiring staff grant", "[" + fmt.Sprintf(tenantGrant, "2026-12-01T00:00:00Z", `,"authoring":true`) + "]", true, true},
	} {
		parsed, err := parseTestSnapshot(t, scenario.grants)
		if err != nil {
			t.Fatalf("%s: parseSnapshot() error = %v", scenario.name, err)
		}
		if parsed.HasGlobalAccess != scenario.wantAccess || (parsed.GlobalExpiresAt != nil) != scenario.wantExpiry {
			t.Fatalf("%s: access = %v, expiry = %v", scenario.name, parsed.HasGlobalAccess, parsed.GlobalExpiresAt)
		}
	}
	never := `{"grant_kind":"platform","tenant_id":"` + zeroUUID + `","grant_source_id":"` + zeroUUID + `","expires_at":""}`
	parsed, err := parseTestSnapshot(t, "["+never+","+fmt.Sprintf(tenantGrant, "2026-12-01T00:00:00Z", `,"authoring":true`)+"]")
	if err != nil || !parsed.HasGlobalAccess || parsed.GlobalExpiresAt != nil {
		t.Fatalf("a non-expiring grant must win: %#v, %v", parsed, err)
	}
	if _, err := parseTestSnapshot(t, `[{"grant_kind":"platform","tenant_id":"`+zeroUUID+`","grant_source_id":"`+zeroUUID+`","expires_at":"","authoring":true}]`); err == nil {
		t.Fatal("parseSnapshot() accepted authoring on a platform grant")
	}
}
