package app

import (
	"context"
	"testing"
	"time"

	centralauthz "github.com/aethercode/aethercode/libs/pkg/authz"
	"github.com/aethercode/aethercode/libs/pkg/rbac"
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

func snapshotWith(assignment Assignment, casbinAllows bool) Snapshot {
	rules := []centralauthz.PolicyRule{{PType: "p", Values: []string{"college_admin", "college", "/attempts/:id", "read"}}}
	if !casbinAllows {
		rules = []centralauthz.PolicyRule{{PType: "p", Values: []string{"college_admin", "college", "/other/:id", "read"}}}
	}
	return Snapshot{Revision: 3, Assignments: []Assignment{assignment}, PolicyRules: rules, Flags: testFlagIndexes}
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
