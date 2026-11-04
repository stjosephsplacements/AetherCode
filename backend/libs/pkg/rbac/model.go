package rbac

// Tier is a medallion tier. A higher tier outranks every role of a lower one.
type Tier int

const (
	Bronze Tier = iota + 1 // batch or self: mentor, student
	Silver                 // one college: college admin, department user, custom college roles
	Gold                   // platform-wide: owner, super admin, placement officer
)

// Rank orders roles: tier first, then position inside the tier, then ID as the tie-break
// Discord uses for equal positions.
type Rank struct {
	Tier     Tier
	Position int
	ID       string
}

// Above reports whether r outranks other strictly.
func (r Rank) Above(other Rank) bool {
	if r.Tier != other.Tier {
		return r.Tier > other.Tier
	}
	if r.Position != other.Position {
		return r.Position > other.Position
	}
	return r.ID < other.ID
}

// Role is one row of users.roles.
type Role struct {
	ID       string
	Tier     Tier
	Position int
	Perms    Perms
	Managed  bool
}

func (r Role) Rank() Rank { return Rank{Tier: r.Tier, Position: r.Position, ID: r.ID} }

// NodeKind names a place in the two scope trees: the college tree runs platform, college,
// department, batch; the placement tree runs placement organisation, placement department.
type NodeKind string

const (
	NodePlatform              NodeKind = "platform"
	NodeCollege               NodeKind = "college"
	NodeDepartment            NodeKind = "department"
	NodeBatch                 NodeKind = "batch"
	NodePlacementOrganization NodeKind = "placement_organization"
	NodePlacementDepartment   NodeKind = "placement_department"
)

// Node is one scope node.
type Node struct {
	Kind NodeKind
	ID   string
}

// Assigned is a role a member holds at a node; it applies to that node and everything below.
type Assigned struct {
	Role Role
	At   Node
}

// TargetKind says whether an overwrite targets a role or one member.
type TargetKind string

const (
	TargetRole   TargetKind = "role"
	TargetMember TargetKind = "member"
)

// Overwrite adjusts permissions at one node for a role or a member (users.permission_overwrites).
type Overwrite struct {
	At         Node
	TargetKind TargetKind
	TargetID   string
	Allow      Perms
	Deny       Perms
}

// Member is whoever is being resolved.
type Member struct {
	ID string
	// Owner is the root administrator: it holds everything and nothing narrows it.
	Owner bool
	Roles []Assigned
}

// Flags are the meta flags the resolver itself must understand. Their indexes are fixed by
// the registry migration; the resolver is configured with them so tests can use small sets.
type Flags struct {
	Administrator int
	ViewScope     int
	// WriteImpliesRead maps a write flag to its read flag: a write without its read is cleared.
	WriteImpliesRead map[int]int
}
