package app

import (
	"github.com/stjosephsplacements/AetherCode/libs/pkg/rbac"
)

// metaFlags are the registry keys the resolver treats specially (migration 000039).
const (
	flagAdministrator = "ADMINISTRATOR"
	flagViewScope     = "VIEW_SCOPE"
)

// bitsAllow decides one request for one assignment from the role's permission bits: the role must
// reach the scope (VIEW_SCOPE), and hold the resource flag for the verb, or ADMINISTRATOR. A read
// is also granted by the write and delete flags, as the permission catalogue expands them.
func bitsAllow(flags map[string]int, assignment Assignment, request Request) bool {
	if !assignment.HasPerms {
		return false
	}
	has := func(key string) bool {
		index, ok := flags[key]
		return ok && assignment.Perms.Has(index)
	}
	if has(flagAdministrator) {
		return true
	}
	if !has(flagViewScope) {
		return false
	}
	base := request.TargetService + "." + request.ResourceType + "."
	switch request.Action {
	case "read":
		return has(base+"read") || has(base+"write") || has(base+"delete")
	case "write", "delete":
		return has(base + request.Action)
	}
	return false
}

// scopePath builds the node path from the root to the assignment's scope node. The path
// walks down the college tree (platform → college → department → batch) or the placement
// tree (platform → placement_organization → placement_department). Nodes above the
// assignment's scope are included because overwrites can be attached at any ancestor.
func scopePath(assignment Assignment) []rbac.Node {
	switch assignment.ScopeKind {
	case "platform":
		return []rbac.Node{{Kind: rbac.NodePlatform}}
	case "college":
		return []rbac.Node{{Kind: rbac.NodePlatform}, {Kind: rbac.NodeCollege, ID: assignment.ScopeID}}
	case "department":
		return []rbac.Node{{Kind: rbac.NodePlatform}, {Kind: rbac.NodeCollege, ID: assignment.TenantID}, {Kind: rbac.NodeDepartment, ID: assignment.ScopeID}}
	case "batch":
		return []rbac.Node{{Kind: rbac.NodePlatform}, {Kind: rbac.NodeCollege, ID: assignment.TenantID}, {Kind: rbac.NodeBatch, ID: assignment.ScopeID}}
	case "placement_organization":
		return []rbac.Node{{Kind: rbac.NodePlatform}, {Kind: rbac.NodePlacementOrganization, ID: assignment.ScopeID}}
	case "placement_department":
		return []rbac.Node{{Kind: rbac.NodePlatform}, {Kind: rbac.NodePlacementDepartment, ID: assignment.ScopeID}}
	case "self":
		return []rbac.Node{{Kind: rbac.NodePlatform}, {Kind: rbac.NodeCollege, ID: assignment.TenantID}}
	}
	return nil
}

// computeAllow resolves the full Discord algorithm (ADR-0075) for one assignment and
// checks the result for the requested permission. It replaces bitsAllow for the bitset
// path so that overwrites are applied.
func computeAllow(snapshot Snapshot, assignment Assignment, request Request) bool {
	if !assignment.HasPerms {
		return false
	}
	path := scopePath(assignment)
	if path == nil {
		return false
	}
	everyone := rbac.Role{ID: snapshot.EveryoneRoleID, Perms: snapshot.EveryonePerms}
	member := rbac.Member{
		ID:    request.PrincipalID,
		Owner: assignment.isRoot(),
		Roles: []rbac.Assigned{{Role: rbac.Role{ID: string(assignment.Role), Perms: assignment.Perms}, At: path[len(path)-1]}},
	}
	effective := rbac.Compute(snapshot.ResolverFlags, everyone, member, path, snapshot.Overwrites)
	return permsAllow(snapshot.Flags, effective, request)
}

// permsAllow checks whether a resolved permission set grants the requested action.
func permsAllow(flags map[string]int, effective rbac.Perms, request Request) bool {
	has := func(key string) bool {
		index, ok := flags[key]
		return ok && effective.Has(index)
	}
	if has(flagAdministrator) {
		return true
	}
	if !has(flagViewScope) {
		return false
	}
	base := request.TargetService + "." + request.ResourceType + "."
	switch request.Action {
	case "read":
		return has(base+"read") || has(base+"write") || has(base+"delete")
	case "write", "delete":
		return has(base + request.Action)
	}
	return false
}
