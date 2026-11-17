package app

import "testing"

// Student images and conduct records are opened by VIEW_STUDENT_PII alone, so the editor must
// not offer a resource flag or grant for them.
func TestPIIResourcesAreNotGrantable(t *testing.T) {
	t.Parallel()
	for _, permission := range PermissionCatalogue() {
		if _, pii := piiResources[permission.Service+"."+permission.Resource]; pii {
			t.Errorf("%s is offered as a grant but a grant never opens it", permission.Key)
		}
	}
}

// A grant or resource flag for a PII resource must not stand in for VIEW_STUDENT_PII.
func TestGrantNeverOpensPIIResources(t *testing.T) {
	t.Parallel()
	grants := []Grant{{ScopeKind: "platform", Permission: "submission.proctor_evidence.read"}, {ScopeKind: "platform", Permission: "submission.snapshots.delete"}, {ScopeKind: "platform", Permission: "analytics.talent_cards.write"}}
	for _, request := range []Request{
		{TargetService: "submission", ResourceType: "proctor_evidence", Action: "read"},
		{TargetService: "submission", ResourceType: "snapshots", Action: "delete"},
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
