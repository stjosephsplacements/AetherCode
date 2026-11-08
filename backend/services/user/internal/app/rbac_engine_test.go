package app

import (
	"context"
	"testing"
	"time"

	centralauthz "github.com/stjosephsplacements/AetherCode/libs/pkg/authz"
	"github.com/stjosephsplacements/AetherCode/libs/pkg/rbac"
)

var testFlagIndexes = map[string]int{
	"ADMINISTRATOR": 0, "VIEW_SCOPE": 1,
	"submission.attempts.read": 16, "submission.attempts.write": 17, "submission.attempts.delete": 18,
}

func bitsFor(keys ...string) rbac.Perms {
	var p rbac.Perms
	for _, key := range keys {
		p = p.With(testFlagIndexes[key])
	}
	return p
}

func TestParseEngine(t *testing.T) {
	t.Parallel()
	for value, want := range map[string]Engine{"": EngineCasbin, "casbin": EngineCasbin, " Shadow ": EngineShadow, "BITSET": EngineBitset} {
		if got, ok := ParseEngine(value); !ok || got != want {
			t.Errorf("ParseEngine(%q) = %q, %v", value, got, ok)
		}
	}
	if _, ok := ParseEngine("both"); ok {
		t.Error("an unknown engine was accepted")
	}
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

func snapshotWith(assignment Assignment, casbinAllows bool) Snapshot {
	rules := []centralauthz.PolicyRule{{PType: "p", Values: []string{"college_admin", "college", "/attempts/:id", "read"}}}
	if !casbinAllows {
		rules = []centralauthz.PolicyRule{{PType: "p", Values: []string{"college_admin", "college", "/other/:id", "read"}}}
	}
	return Snapshot{
		Revision: 3, Assignments: []Assignment{assignment}, PolicyRules: rules,
		Flags: testFlagIndexes, ResolverFlags: testResolverFlags,
		EveryoneRoleID: "aaaaaaaa-0000-0000-0000-000000000001",
		EveryonePerms:  bitsFor("VIEW_SCOPE"),
	}
}

func TestEnginesDecideFromTheirOwnModel(t *testing.T) {
	t.Parallel()
	request := Request{PrincipalID: testPrincipal, TenantID: testTenant, RequestID: testRequestID, Action: "read", ResourceType: "attempts", ResourceID: "a-1", TargetService: "submission"}
	base := Assignment{Role: centralauthz.RoleCollegeAdmin, ScopeKind: "college", TenantID: testTenant, ScopeID: testTenant}
	withBits := base
	withBits.Perms, withBits.HasPerms = bitsFor("VIEW_SCOPE", "submission.attempts.read"), true

	cases := []struct {
		name         string
		engine       Engine
		assignment   Assignment
		casbinAllows bool
		want         bool
	}{
		{"casbin allows, bits absent", EngineCasbin, base, true, true},
		{"shadow follows Casbin when bits disagree", EngineShadow, base, true, true},
		{"shadow follows Casbin when it denies", EngineShadow, withBits, false, false},
		{"bitset follows the bits", EngineBitset, withBits, false, true},
		{"bitset denies without role bits", EngineBitset, base, true, false},
	}
	for _, tc := range cases {
		service, err := NewService(fakeStore{snapshot: snapshotWith(tc.assignment, tc.casbinAllows)}, testKeyring(t), nil, false)
		if err != nil {
			t.Fatal(err)
		}
		service.now = func() time.Time { return time.Date(2026, 7, 24, 12, 0, 0, 0, time.UTC) }
		decision, err := service.WithEngine(tc.engine).Authorize(context.Background(), request)
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

	t.Run("role with read permission at college scope", func(t *testing.T) {
		a := Assignment{Role: "staff", ScopeKind: "college", TenantID: "t1", ScopeID: "t1", Perms: bitsFor("VIEW_SCOPE", "submission.attempts.read"), HasPerms: true}
		if !computeAllow(base, a, readReq) {
			t.Error("expected read to be allowed")
		}
	})

	t.Run("role without HasPerms is denied", func(t *testing.T) {
		a := Assignment{Role: "staff", ScopeKind: "college", ScopeID: "t1"}
		if computeAllow(base, a, readReq) {
			t.Error("expected denial when HasPerms is false")
		}
	})

	t.Run("unknown scope kind returns nil path and denies", func(t *testing.T) {
		a := Assignment{Role: "staff", ScopeKind: "galaxy", HasPerms: true, Perms: bitsFor("VIEW_SCOPE", "ADMINISTRATOR")}
		if computeAllow(base, a, readReq) {
			t.Error("expected denial for unknown scope kind")
		}
	})

	t.Run("deny overwrite blocks read", func(t *testing.T) {
		snap := base
		snap.Overwrites = []rbac.Overwrite{{
			At:         rbac.Node{Kind: rbac.NodeCollege, ID: "t1"},
			TargetKind: rbac.TargetRole,
			TargetID:   "staff",
			Deny:       bitsFor("submission.attempts.read"),
		}}
		a := Assignment{Role: "staff", ScopeKind: "college", TenantID: "t1", ScopeID: "t1", Perms: bitsFor("VIEW_SCOPE", "submission.attempts.read"), HasPerms: true}
		if computeAllow(snap, a, readReq) {
			t.Error("expected deny overwrite to block read")
		}
	})

	t.Run("allow overwrite grants write", func(t *testing.T) {
		snap := base
		snap.Overwrites = []rbac.Overwrite{{
			At:         rbac.Node{Kind: rbac.NodeCollege, ID: "t1"},
			TargetKind: rbac.TargetRole,
			TargetID:   "staff",
			Allow:      bitsFor("submission.attempts.write"),
		}}
		a := Assignment{Role: "staff", ScopeKind: "college", TenantID: "t1", ScopeID: "t1", Perms: bitsFor("VIEW_SCOPE", "submission.attempts.read"), HasPerms: true}
		if !computeAllow(snap, a, writeReq) {
			t.Error("expected allow overwrite to grant write")
		}
	})

	t.Run("department scope walks through college", func(t *testing.T) {
		a := Assignment{Role: "dept_admin", ScopeKind: "department", TenantID: "c1", ScopeID: "d1", Perms: bitsFor("VIEW_SCOPE", "submission.attempts.read"), HasPerms: true}
		if !computeAllow(base, a, readReq) {
			t.Error("expected department-scoped assignment to allow read")
		}
	})
}

// TestBitsetEngineDoesNotRequirePolicyRules confirms that EngineBitset allows a decision
// when PolicyRules is empty — the early-exit guard must not fire in bitset mode.
func TestBitsetEngineDoesNotRequirePolicyRules(t *testing.T) {
	t.Parallel()
	withBits := Assignment{
		Role: centralauthz.RoleCollegeAdmin, ScopeKind: "college", TenantID: testTenant, ScopeID: testTenant,
	}
	withBits.Perms, withBits.HasPerms = bitsFor("VIEW_SCOPE", "submission.attempts.read"), true
	snapshot := Snapshot{
		Revision:    1,
		Assignments: []Assignment{withBits},
		// PolicyRules intentionally empty — bitset does not need them.
		Flags: testFlagIndexes, ResolverFlags: testResolverFlags,
	}
	service, err := NewService(fakeStore{snapshot: snapshot}, testKeyring(t), nil, false)
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	service.now = func() time.Time { return time.Date(2026, 7, 24, 12, 0, 0, 0, time.UTC) }
	request := Request{
		PrincipalID: testPrincipal, TenantID: testTenant, RequestID: testRequestID,
		Action: "read", ResourceType: "attempts", ResourceID: "a-1", TargetService: "submission",
	}
	decision, err := service.WithEngine(EngineBitset).Authorize(context.Background(), request)
	if err != nil {
		t.Fatalf("Authorize() error = %v", err)
	}
	if !decision.Allowed {
		t.Error("EngineBitset must allow when role bits grant the permission, even with no PolicyRules")
	}
}

// TestCasbinEngineStillDeniesWithoutPolicyRules confirms that the casbin early-exit
// guard is preserved: an empty PolicyRules list is a deny for casbin/shadow modes.
func TestCasbinEngineStillDeniesWithoutPolicyRules(t *testing.T) {
	t.Parallel()
	assignment := Assignment{Role: centralauthz.RoleCollegeAdmin, ScopeKind: "college", TenantID: testTenant, ScopeID: testTenant}
	snapshot := Snapshot{
		Revision:    1,
		Assignments: []Assignment{assignment},
		// No PolicyRules — casbin cannot decide; deny is the safe default.
	}
	service, err := NewService(fakeStore{snapshot: snapshot}, testKeyring(t), nil, false)
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	request := Request{
		PrincipalID: testPrincipal, TenantID: testTenant, RequestID: testRequestID,
		Action: "read", ResourceType: "attempts", ResourceID: "a-1", TargetService: "submission",
	}
	decision, err := service.Authorize(context.Background(), request)
	if err != nil {
		t.Fatalf("Authorize() error = %v", err)
	}
	if decision.Allowed {
		t.Error("EngineCasbin must deny when PolicyRules is empty")
	}
}
