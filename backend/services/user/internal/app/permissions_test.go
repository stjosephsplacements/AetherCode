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
