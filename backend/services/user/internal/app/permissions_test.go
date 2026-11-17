package app

import "testing"

// Student images and conduct records are opened by VIEW_STUDENT_PII, never by a
// resource flag a college can hand out, so the catalogue must keep them platform-only.
func TestPIIEvidenceResourcesStayPlatformOnly(t *testing.T) {
	t.Parallel()
	want := map[string]bool{"submission.snapshots": false, "submission.proctor_evidence": false}
	for _, permission := range PermissionCatalogue() {
		key := permission.Service + "." + permission.Resource
		if _, tracked := want[key]; tracked {
			want[key] = true
			if !permission.PlatformOnly {
				t.Errorf("%s is grantable by a college; it must be platform-only", permission.Key)
			}
		}
	}
	for key, found := range want {
		if !found {
			t.Errorf("%s is missing from the permission catalogue", key)
		}
	}
}

// A grant or resource flag for a PII resource must not stand in for VIEW_STUDENT_PII.
func TestGrantNeverOpensPIIResources(t *testing.T) {
	t.Parallel()
	grants := []Grant{{ScopeKind: "platform", Permission: "submission.proctor_evidence.read"}, {ScopeKind: "platform", Permission: "analytics.talent_cards.write"}}
	for _, request := range []Request{
		{TargetService: "submission", ResourceType: "proctor_evidence", Action: "read"},
		{TargetService: "analytics", ResourceType: "talent_cards", Action: "write"},
	} {
		if _, ok := grantAllows(grants, request, false); ok {
			t.Errorf("grant opened %s.%s.%s without VIEW_STUDENT_PII", request.TargetService, request.ResourceType, request.Action)
		}
	}
	if _, ok := grantAllows([]Grant{{ScopeKind: "platform", Permission: "submission.attempts.read"}}, Request{TargetService: "submission", ResourceType: "attempts", Action: "read"}, false); !ok {
		t.Error("ordinary grants must keep working")
	}
}
