package rbac

import "testing"

// A small flag set for the tests: the resolver is configured with indexes, not names.
const (
	fAdmin = iota
	fView
	fRead
	fWrite
	fManageRoles
	fManageMembers
	fSecret
)

var testFlags = Flags{Administrator: fAdmin, ViewScope: fView, WriteImpliesRead: map[int]int{fWrite: fRead}}
var testRules = Rules{Administrator: fAdmin, ManageRoles: fManageRoles, ManageMembers: fManageMembers, Elevated: Of(fAdmin, fManageRoles)}

var (
	college = Node{NodeCollege, "c1"}
	dept    = Node{NodeDepartment, "d1"}
	batch   = Node{NodeBatch, "b1"}
	root    = Node{NodePlatform, ""}
	path    = []Node{root, college, dept, batch}
)

func role(id string, tier Tier, position int, perms ...int) Role {
	return Role{ID: id, Tier: tier, Position: position, Perms: Of(perms...)}
}

func TestBitStringRoundTrip(t *testing.T) {
	t.Parallel()
	p := Of(0, 1, 63, 64, 130, 255)
	got, err := ParseBitString(p.BitString())
	if err != nil || got != p {
		t.Fatalf("round trip = %v, %v", got, err)
	}
	if _, err := ParseBitString("101"); err == nil {
		t.Fatal("short string accepted")
	}
	if p.Count() != 6 || !p.Covers(Of(63, 255)) || p.Covers(Of(2)) {
		t.Fatal("Count or Covers wrong")
	}
}

func TestBaseIsEveryoneOrRoles(t *testing.T) {
	t.Parallel()
	everyone := role("e", Silver, 0, fView, fRead)
	faculty := role("f", Silver, 300, fWrite)
	member := Member{ID: "m", Roles: []Assigned{{faculty, dept}}}
	got := Compute(testFlags, everyone, member, path, nil)
	if want := Of(fView, fRead, fWrite); got != want {
		t.Fatalf("got %v want %v", got, want)
	}
	// A role assigned at a node off the path does not apply.
	other := Member{ID: "m", Roles: []Assigned{{faculty, Node{NodeDepartment, "elsewhere"}}}}
	if got := Compute(testFlags, everyone, other, path, nil); got != Of(fView, fRead) {
		t.Fatalf("off-path role applied: %v", got)
	}
}

func TestAdministratorAndOwnerBypassOverwrites(t *testing.T) {
	t.Parallel()
	everyone := role("e", Silver, 0, fView)
	admin := role("a", Silver, 500, fAdmin)
	deny := []Overwrite{{At: college, TargetKind: TargetRole, TargetID: "a", Deny: All()}, {At: college, TargetKind: TargetMember, TargetID: "m", Deny: All()}}
	if got := Compute(testFlags, everyone, Member{ID: "m", Roles: []Assigned{{admin, college}}}, path, deny); got != All() {
		t.Fatal("ADMINISTRATOR did not bypass overwrites")
	}
	if got := Compute(testFlags, everyone, Member{ID: "m", Owner: true}, path, deny); got != All() {
		t.Fatal("owner did not hold everything")
	}
}

func TestOverwriteOrder(t *testing.T) {
	t.Parallel()
	everyone := role("e", Silver, 0, fView, fRead, fWrite)
	roleA := role("a", Silver, 100, fSecret)
	roleB := role("b", Silver, 200)
	member := Member{ID: "m", Roles: []Assigned{{roleA, college}, {roleB, college}}}
	cases := []struct {
		name string
		ow   []Overwrite
		want Perms
	}{
		{"everyone deny then allow at one node", []Overwrite{{At: college, TargetKind: TargetRole, TargetID: "e", Deny: Of(fWrite, fRead), Allow: Of(fRead)}}, Of(fView, fRead, fSecret)},
		{"an allow from any role beats a deny from another", []Overwrite{
			{At: college, TargetKind: TargetRole, TargetID: "a", Deny: Of(fRead)},
			{At: college, TargetKind: TargetRole, TargetID: "b", Allow: Of(fRead)},
		}, Of(fView, fRead, fWrite, fSecret)},
		{"member overwrite wins over roles", []Overwrite{
			{At: college, TargetKind: TargetRole, TargetID: "b", Allow: Of(fRead)},
			{At: college, TargetKind: TargetMember, TargetID: "m", Deny: Of(fRead)},
		}, Of(fView, fSecret)}, // write is cleared along with its read
		{"a lower node overwrite applies after a higher one", []Overwrite{
			{At: college, TargetKind: TargetRole, TargetID: "e", Deny: Of(fWrite)},
			{At: batch, TargetKind: TargetRole, TargetID: "e", Allow: Of(fWrite)},
		}, Of(fView, fRead, fWrite, fSecret)},
		{"overwrites at a node off the path are ignored", []Overwrite{{At: Node{NodeCollege, "other"}, TargetKind: TargetRole, TargetID: "e", Deny: Of(fWrite)}}, Of(fView, fRead, fWrite, fSecret)},
		{"another member's overwrite is ignored", []Overwrite{{At: college, TargetKind: TargetMember, TargetID: "x", Deny: Of(fRead)}}, Of(fView, fRead, fWrite, fSecret)},
	}
	for _, tc := range cases {
		if got := Compute(testFlags, everyone, member, path, tc.ow); got != tc.want {
			t.Errorf("%s: got %v want %v", tc.name, got, tc.want)
		}
	}
}

func TestImplicitRules(t *testing.T) {
	t.Parallel()
	everyone := role("e", Silver, 0, fView, fRead, fWrite)
	member := Member{ID: "m"}
	// Without VIEW_SCOPE nothing else remains.
	hidden := []Overwrite{{At: college, TargetKind: TargetRole, TargetID: "e", Deny: Of(fView)}}
	if got := Compute(testFlags, everyone, member, path, hidden); !got.IsZero() {
		t.Fatalf("hidden scope kept %v", got)
	}
	// A write without its read is cleared.
	noRead := []Overwrite{{At: college, TargetKind: TargetRole, TargetID: "e", Deny: Of(fRead)}}
	if got := Compute(testFlags, everyone, member, path, noRead); got != Of(fView) {
		t.Fatalf("write kept without read: %v", got)
	}
}

func TestCombineIsEitherTree(t *testing.T) {
	t.Parallel()
	if got := Combine(Of(fRead), Of(fWrite)); got != Of(fRead, fWrite) {
		t.Fatalf("Combine = %v", got)
	}
}

func TestRankOrdersTierThenPositionThenID(t *testing.T) {
	t.Parallel()
	gold := Rank{Gold, 1, "z"}
	silver := Rank{Silver, 999, "a"}
	if !gold.Above(silver) || silver.Above(gold) {
		t.Fatal("tier does not dominate position")
	}
	if !(Rank{Silver, 5, "a"}).Above(Rank{Silver, 4, "a"}) {
		t.Fatal("position")
	}
	if !(Rank{Silver, 5, "a"}).Above(Rank{Silver, 5, "b"}) || (Rank{Silver, 5, "a"}).Above(Rank{Silver, 5, "a"}) {
		t.Fatal("equal positions must tie-break on id and never outrank themselves")
	}
}

func TestHierarchy(t *testing.T) {
	t.Parallel()
	actor := Actor{Effective: Of(fView, fManageRoles, fManageMembers, fRead), Highest: Rank{Silver, 500, "admin"}, HasHighest: true}
	below := role("faculty", Silver, 300)
	above := role("super", Silver, 600)
	equal := role("admin", Silver, 500)
	managed := Role{ID: "student", Tier: Bronze, Position: 100, Managed: true}

	if !CanManageRole(testRules, actor, below) {
		t.Error("cannot manage a role below")
	}
	for name, target := range map[string]Role{"above": above, "equal": equal, "managed": managed} {
		if CanManageRole(testRules, actor, target) {
			t.Errorf("managed a %s role", name)
		}
	}
	if CanManageRole(testRules, Actor{Effective: Of(fView), Highest: actor.Highest, HasHighest: true}, below) {
		t.Error("managed roles without MANAGE_ROLES")
	}
	if !CanManageRole(testRules, Actor{Owner: true}, below) || CanManageRole(testRules, Actor{Owner: true}, managed) {
		t.Error("owner may edit any role except managed ones")
	}

	memberLow := Rank{Silver, 100, "x"}
	memberHigh := Rank{Silver, 700, "y"}
	if !CanAssignRole(testRules, actor, below, &memberLow) || !CanAssignRole(testRules, actor, below, nil) {
		t.Error("cannot assign a lower role to a lower member")
	}
	if CanAssignRole(testRules, actor, below, &memberHigh) {
		t.Error("changed the roles of a member above the actor")
	}
	if CanAssignRole(testRules, actor, above, nil) {
		t.Error("assigned a role above the actor")
	}
}

func TestCeilingAndStepUp(t *testing.T) {
	t.Parallel()
	actor := Actor{Effective: Of(fView, fRead, fManageRoles)}
	if !WithinCeiling(testRules, actor, Of(fRead)) || WithinCeiling(testRules, actor, Of(fRead, fWrite)) {
		t.Fatal("ceiling must be a subset check")
	}
	if !WithinCeiling(testRules, Actor{Owner: true}, All()) || !WithinCeiling(testRules, Actor{Effective: Of(fAdmin)}, Of(fSecret)) {
		t.Fatal("owner and ADMINISTRATOR are above the ceiling")
	}
	if !NeedsStepUp(testRules, Of(fManageRoles)) || NeedsStepUp(testRules, Of(fRead)) {
		t.Fatal("elevated flags need step-up")
	}
}
