package app

import (
	"context"
	"testing"
	"time"

	centralauthz "github.com/stjosephsplacements/AetherCode/libs/pkg/authz"
	"github.com/stjosephsplacements/AetherCode/libs/pkg/rbac"
)

var testFlagIndexes = map[string]int{
	"ADMINISTRATOR": 0, "VIEW_SCOPE": 1, "VIEW_STUDENT_PII": 7,
	"submission.attempts.read": 16, "submission.attempts.write": 17, "submission.attempts.delete": 18,
}

func bitsFor(keys ...string) rbac.Perms {
	var p rbac.Perms
	for _, key := range keys {
		p = p.With(testFlagIndexes[key])
	}
	return p
}

func TestBitsAllow(t *testing.T) {
	t.Parallel()
	read := Request{TargetService: "submission", ResourceType: "attempts", Action: "read"}
	write := Request{TargetService: "submission", ResourceType: "attempts", Action: "write"}
	remove := Request{TargetService: "submission", ResourceType: "attempts", Action: "delete"}
	hold := func(keys ...string) Assignment { return Assignment{Perms: bitsFor(keys...), HasPerms: true} }

	cases := []struct {
		name       string
		assignment Assignment
		request    Request
		want       bool
	}{
		{"read flag", hold("VIEW_SCOPE", "submission.attempts.read"), read, true},
		{"write flag grants read", hold("VIEW_SCOPE", "submission.attempts.write"), read, true},
		{"read flag does not grant write", hold("VIEW_SCOPE", "submission.attempts.read"), write, false},
		{"write is not delete", hold("VIEW_SCOPE", "submission.attempts.write"), remove, false},
		{"delete flag", hold("VIEW_SCOPE", "submission.attempts.delete"), remove, true},
		{"no VIEW_SCOPE reaches nothing", hold("submission.attempts.read"), read, false},
		{"ADMINISTRATOR holds everything", hold("VIEW_SCOPE", "ADMINISTRATOR"), write, true},
		{"role without bits", Assignment{}, read, false},
		{"delete flag grants read", hold("VIEW_SCOPE", "submission.attempts.delete"), read, true},
		{"delete does not grant write", hold("VIEW_SCOPE", "submission.attempts.delete"), write, false},
		{"ADMINISTRATOR without VIEW_SCOPE", hold("ADMINISTRATOR"), write, true},
		{"HasPerms true with zero bits", Assignment{HasPerms: true}, read, false},
		{"ADMINISTRATOR covers an unregistered resource", hold("VIEW_SCOPE", "ADMINISTRATOR"), Request{TargetService: "submission", ResourceType: "unknown", Action: "read"}, true},
	}
	for _, tc := range cases {
		if got := bitsAllow(testFlagIndexes, tc.assignment, tc.request); got != tc.want {
			t.Errorf("%s: got %v want %v", tc.name, got, tc.want)
		}
	}
	// An action outside read, write and delete is never allowed by bits.
	if bitsAllow(testFlagIndexes, hold("VIEW_SCOPE", "submission.attempts.read"), Request{TargetService: "submission", ResourceType: "attempts", Action: "list"}) {
		t.Error("an unknown action was allowed")
	}
}

var testResolverFlags = rbac.Flags{
	Administrator:    testFlagIndexes["ADMINISTRATOR"],
	ViewScope:        testFlagIndexes["VIEW_SCOPE"],
	WriteImpliesRead: map[int]int{testFlagIndexes["submission.attempts.write"]: testFlagIndexes["submission.attempts.read"]},
}

// withBits turns a snapshot into a role-bit snapshot: every assignment holds VIEW_SCOPE plus the
// named flags, and "ADMINISTRATOR" grants everything.
func withBits(snapshot Snapshot, keys ...string) Snapshot {
	flags := map[string]int{"ADMINISTRATOR": 0, "VIEW_SCOPE": 1}
	perms := rbac.Perms{}.With(flags["VIEW_SCOPE"])
	for _, key := range keys {
		if _, known := flags[key]; !known {
			flags[key] = len(flags) + 14
		}
		perms = perms.With(flags[key])
	}
	assignments := make([]Assignment, len(snapshot.Assignments))
	for i, assignment := range snapshot.Assignments {
		assignment.Perms, assignment.HasPerms = perms, true
		assignments[i] = assignment
	}
	snapshot.Assignments = assignments
	snapshot.Flags = flags
	snapshot.ResolverFlags = rbac.Flags{Administrator: flags["ADMINISTRATOR"], ViewScope: flags["VIEW_SCOPE"]}
	snapshot.EveryoneRoleID = "aaaaaaaa-0000-0000-0000-000000000001"
	snapshot.EveryonePerms = rbac.Perms{}.With(flags["VIEW_SCOPE"])
	return snapshot
}

func TestAuthorizeDecidesFromRoleBits(t *testing.T) {
	t.Parallel()
	request := Request{PrincipalID: testPrincipal, TenantID: testTenant, RequestID: testRequestID, Action: "read", ResourceType: "attempts", ResourceID: "a-1", TargetService: "submission"}
	base := Assignment{Role: centralauthz.RoleCollegeAdmin, ScopeKind: "college", TenantID: testTenant, ScopeID: testTenant}
	withPerms := base
	withPerms.Perms, withPerms.HasPerms = bitsFor("VIEW_SCOPE", "submission.attempts.read"), true

	cases := []struct {
		name       string
		assignment Assignment
		want       bool
	}{
		{"allows what the role bits grant", withPerms, true},
		{"denies without role bits", base, false},
	}
	for _, tc := range cases {
		service, err := NewService(fakeStore{snapshot: Snapshot{
			Revision: 3, Assignments: []Assignment{tc.assignment},
			Flags: testFlagIndexes, ResolverFlags: testResolverFlags,
			EveryoneRoleID: "aaaaaaaa-0000-0000-0000-000000000001",
			EveryonePerms:  bitsFor("VIEW_SCOPE"),
		}}, testKeyring(t), nil, false)
		if err != nil {
			t.Fatal(err)
		}
		service.now = func() time.Time { return time.Date(2026, 7, 24, 12, 0, 0, 0, time.UTC) }
		decision, err := service.Authorize(context.Background(), request)
		if err != nil {
			t.Fatalf("%s: %v", tc.name, err)
		}
		if decision.Allowed != tc.want {
			t.Errorf("%s: allowed = %v, want %v", tc.name, decision.Allowed, tc.want)
		}
	}
}

func TestScopePath(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		a    Assignment
		want int // expected path length, 0 = nil
	}{
		{"platform", Assignment{ScopeKind: "platform"}, 1},
		{"college", Assignment{ScopeKind: "college", ScopeID: "c1"}, 2},
		{"department", Assignment{ScopeKind: "department", TenantID: "c1", ScopeID: "d1"}, 3},
		{"batch", Assignment{ScopeKind: "batch", TenantID: "c1", ScopeID: "b1"}, 3},
		{"placement_organization", Assignment{ScopeKind: "placement_organization", ScopeID: "po1"}, 2},
		{"placement_department", Assignment{ScopeKind: "placement_department", ScopeID: "pd1"}, 2},
		{"self", Assignment{ScopeKind: "self", TenantID: "c1"}, 2},
		{"unknown", Assignment{ScopeKind: "unknown"}, 0},
	}
	for _, tc := range cases {
		path := scopePath(tc.a)
		got := len(path)
		if tc.want == 0 && path != nil {
			t.Errorf("%s: expected nil path", tc.name)
		} else if got != tc.want {
			t.Errorf("%s: path length %d, want %d", tc.name, got, tc.want)
		}
	}
}

func TestPermsAllow(t *testing.T) {
	t.Parallel()
	read := Request{TargetService: "submission", ResourceType: "attempts", Action: "read"}
	write := Request{TargetService: "submission", ResourceType: "attempts", Action: "write"}
	remove := Request{TargetService: "submission", ResourceType: "attempts", Action: "delete"}

	cases := []struct {
		name  string
		perms rbac.Perms
		req   Request
		want  bool
	}{
		{"read granted", bitsFor("VIEW_SCOPE", "submission.attempts.read"), read, true},
		{"write grants read", bitsFor("VIEW_SCOPE", "submission.attempts.write"), read, true},
		{"read does not grant write", bitsFor("VIEW_SCOPE", "submission.attempts.read"), write, false},
		{"admin grants all", bitsFor("VIEW_SCOPE", "ADMINISTRATOR"), write, true},
		{"no view scope", bitsFor("submission.attempts.read"), read, false},
		{"delete flag", bitsFor("VIEW_SCOPE", "submission.attempts.delete"), remove, true},
		{"unknown action denied", bitsFor("VIEW_SCOPE", "submission.attempts.read"), Request{TargetService: "submission", ResourceType: "attempts", Action: "list"}, false},
		{"pii reads proctor evidence", bitsFor("VIEW_SCOPE", "VIEW_STUDENT_PII"), Request{TargetService: "submission", ResourceType: "proctor_evidence", Action: "read"}, true},
		{"pii reads snapshots", bitsFor("VIEW_SCOPE", "VIEW_STUDENT_PII"), Request{TargetService: "submission", ResourceType: "snapshots", Action: "read"}, true},
		{"pii needs view scope", bitsFor("VIEW_STUDENT_PII"), Request{TargetService: "submission", ResourceType: "proctor_evidence", Action: "read"}, false},
		{"pii does not write evidence", bitsFor("VIEW_SCOPE", "VIEW_STUDENT_PII"), Request{TargetService: "submission", ResourceType: "proctor_evidence", Action: "write"}, false},
		{"pii writes talent cards", bitsFor("VIEW_SCOPE", "VIEW_STUDENT_PII"), Request{TargetService: "analytics", ResourceType: "talent_cards", Action: "write"}, true},
		{"talent cards need pii", bitsFor("VIEW_SCOPE"), Request{TargetService: "analytics", ResourceType: "talent_cards", Action: "write"}, false},
		{"pii does not read attempts", bitsFor("VIEW_SCOPE", "VIEW_STUDENT_PII"), read, false},
		{"evidence denied without pii", bitsFor("VIEW_SCOPE", "submission.attempts.read"), Request{TargetService: "submission", ResourceType: "proctor_evidence", Action: "read"}, false},
	}
	for _, tc := range cases {
		if got := permsAllow(testFlagIndexes, tc.perms, tc.req); got != tc.want {
			t.Errorf("%s: got %v want %v", tc.name, got, tc.want)
		}
	}
}

func TestComputeAllow(t *testing.T) {
	t.Parallel()
	readReq := Request{PrincipalID: "p1", TargetService: "submission", ResourceType: "attempts", Action: "read"}
	writeReq := Request{PrincipalID: "p1", TargetService: "submission", ResourceType: "attempts", Action: "write"}

	base := Snapshot{
		Flags:          testFlagIndexes,
		ResolverFlags:  testResolverFlags,
		EveryoneRoleID: "everyone-id",
		EveryonePerms:  bitsFor("VIEW_SCOPE"),
	}

	const staffRoleID = "bbbbbbbb-0000-0000-0000-000000000001"
	const deptRoleID = "bbbbbbbb-0000-0000-0000-000000000002"
	staffCollege := Assignment{
		Role: "staff", RoleID: staffRoleID, ScopeKind: "college", TenantID: "t1", ScopeID: "t1",
		Perms: bitsFor("VIEW_SCOPE", "submission.attempts.read"), HasPerms: true,
	}

	t.Run("role with read permission at college scope", func(t *testing.T) {
		if !computeAllow(base, staffCollege, readReq) {
			t.Error("expected read to be allowed")
		}
	})

	t.Run("role without HasPerms is denied", func(t *testing.T) {
		a := Assignment{Role: "staff", RoleID: staffRoleID, ScopeKind: "college", ScopeID: "t1"}
		if computeAllow(base, a, readReq) {
			t.Error("expected denial when HasPerms is false")
		}
	})

	t.Run("unknown scope kind returns nil path and denies", func(t *testing.T) {
		a := Assignment{Role: "staff", RoleID: staffRoleID, ScopeKind: "galaxy", HasPerms: true, Perms: bitsFor("VIEW_SCOPE", "ADMINISTRATOR")}
		if computeAllow(base, a, readReq) {
			t.Error("expected denial for unknown scope kind")
		}
	})

	t.Run("deny overwrite blocks read", func(t *testing.T) {
		snap := base
		snap.Overwrites = []rbac.Overwrite{{
			At:         rbac.Node{Kind: rbac.NodeCollege, ID: "t1"},
			TargetKind: rbac.TargetRole,
			TargetID:   staffRoleID,
			Deny:       bitsFor("submission.attempts.read"),
		}}
		if computeAllow(snap, staffCollege, readReq) {
			t.Error("expected deny overwrite to block read")
		}
	})

	t.Run("allow overwrite grants write", func(t *testing.T) {
		snap := base
		snap.Overwrites = []rbac.Overwrite{{
			At:         rbac.Node{Kind: rbac.NodeCollege, ID: "t1"},
			TargetKind: rbac.TargetRole,
			TargetID:   staffRoleID,
			Allow:      bitsFor("submission.attempts.write"),
		}}
		if !computeAllow(snap, staffCollege, writeReq) {
			t.Error("expected allow overwrite to grant write")
		}
	})

	t.Run("role-name overwrite target does not match RoleID", func(t *testing.T) {
		snap := base
		snap.Overwrites = []rbac.Overwrite{{
			At:         rbac.Node{Kind: rbac.NodeCollege, ID: "t1"},
			TargetKind: rbac.TargetRole,
			TargetID:   "staff",
			Deny:       bitsFor("submission.attempts.read"),
		}}
		if !computeAllow(snap, staffCollege, readReq) {
			t.Error("expected name-targeted overwrite to be ignored so read still allows")
		}
	})

	t.Run("empty RoleID ignores role-targeted overwrite", func(t *testing.T) {
		snap := base
		snap.Overwrites = []rbac.Overwrite{{
			At:         rbac.Node{Kind: rbac.NodeCollege, ID: "t1"},
			TargetKind: rbac.TargetRole,
			TargetID:   staffRoleID,
			Deny:       bitsFor("submission.attempts.read"),
		}}
		a := staffCollege
		a.RoleID = ""
		if !computeAllow(snap, a, readReq) {
			t.Error("expected empty RoleID not to match a UUID overwrite deny")
		}
	})

	t.Run("role deny on one assignment blocks sibling role on the same path", func(t *testing.T) {
		const otherRoleID = "bbbbbbbb-0000-0000-0000-000000000099"
		other := Assignment{
			Role: "monitor", RoleID: otherRoleID, ScopeKind: "college", TenantID: "t1", ScopeID: "t1",
			Perms: bitsFor("VIEW_SCOPE", "submission.attempts.read"), HasPerms: true,
		}
		snap := base
		snap.Assignments = []Assignment{staffCollege, other}
		snap.Overwrites = []rbac.Overwrite{{
			At:         rbac.Node{Kind: rbac.NodeCollege, ID: "t1"},
			TargetKind: rbac.TargetRole,
			TargetID:   staffRoleID,
			Deny:       bitsFor("submission.attempts.read"),
		}}
		// Looping the non-denied role must still see the deny on staffRoleID.
		if computeAllow(snap, other, readReq) {
			t.Error("expected deny on sibling role to remove the permission for the path")
		}
	})

	t.Run("member overwrite still matches principal", func(t *testing.T) {
		snap := base
		snap.Overwrites = []rbac.Overwrite{{
			At:         rbac.Node{Kind: rbac.NodeCollege, ID: "t1"},
			TargetKind: rbac.TargetMember,
			TargetID:   "p1",
			Deny:       bitsFor("submission.attempts.read"),
		}}
		if computeAllow(snap, staffCollege, readReq) {
			t.Error("expected member-targeted deny to block read")
		}
	})

	t.Run("department scope walks through college", func(t *testing.T) {
		a := Assignment{
			Role: "dept_admin", RoleID: deptRoleID, ScopeKind: "department", TenantID: "c1", ScopeID: "d1",
			Perms: bitsFor("VIEW_SCOPE", "submission.attempts.read"), HasPerms: true,
		}
		if !computeAllow(base, a, readReq) {
			t.Error("expected department-scoped assignment to allow read")
		}
	})
}

func TestResourceFlagDoesNotOpenPIIResources(t *testing.T) {
	t.Parallel()
	flags := map[string]int{flagViewScope: 1, flagViewStudentPII: 2, "submission.proctor_evidence.read": 3}
	request := Request{TargetService: "submission", ResourceType: "proctor_evidence", Action: "read"}
	if permsAllow(flags, rbac.Perms{}.With(1).With(3), request) {
		t.Fatal("resource flag opened evidence without VIEW_STUDENT_PII")
	}
	if !permsAllow(flags, rbac.Perms{}.With(1).With(2), request) {
		t.Fatal("VIEW_STUDENT_PII with VIEW_SCOPE must open evidence")
	}
	request.Action = "write"
	flags["submission.proctor_evidence.write"] = 4
	if permsAllow(flags, rbac.Perms{}.With(1).With(2).With(4), request) {
		t.Fatal("evidence has no write verb, with or without the flag")
	}
}
