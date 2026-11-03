package rbac

// Actor is who changes roles, assignments or overwrites.
type Actor struct {
	Owner bool
	// Effective is the actor's resolved permissions at the node being changed.
	Effective Perms
	// Highest is the actor's highest-ranked role that reaches the node; HasHighest is false when none does.
	Highest    Rank
	HasHighest bool
}

// Rules are the flags the hierarchy checks need.
type Rules struct {
	Administrator int
	ManageRoles   int
	ManageMembers int
	Elevated      Perms
}

// CanManageRole reports whether the actor may create, edit, delete or reorder a role of the
// given rank: it needs MANAGE_ROLES (or ADMINISTRATOR), and the role must rank strictly below
// its highest role. Managed roles are never editable, by anyone.
func CanManageRole(rules Rules, actor Actor, target Role) bool {
	if target.Managed {
		return false
	}
	if actor.Owner {
		return true
	}
	if !actor.Effective.Has(rules.ManageRoles) && !actor.Effective.Has(rules.Administrator) {
		return false
	}
	return actor.HasHighest && actor.Highest.Above(target.Rank())
}

// CanAssignRole reports whether the actor may give or take a role from a member whose highest
// role is memberHighest (nil when the member has none): it needs MANAGE_MEMBERS (or
// ADMINISTRATOR), the role must be below the actor's, and so must the member's highest role.
func CanAssignRole(rules Rules, actor Actor, role Role, memberHighest *Rank) bool {
	if role.Managed {
		return false
	}
	if actor.Owner {
		return true
	}
	if !actor.Effective.Has(rules.ManageMembers) && !actor.Effective.Has(rules.Administrator) {
		return false
	}
	if !actor.HasHighest || !actor.Highest.Above(role.Rank()) {
		return false
	}
	return memberHighest == nil || actor.Highest.Above(*memberHighest)
}

// WithinCeiling reports whether the actor may put the given permissions into a role or an
// overwrite's allow set: it can only grant what it holds, unless it is the owner or has
// ADMINISTRATOR.
func WithinCeiling(rules Rules, actor Actor, grant Perms) bool {
	return actor.Owner || actor.Effective.Has(rules.Administrator) || actor.Effective.Covers(grant)
}

// NeedsStepUp reports whether the grant touches an elevated flag, which requires recently
// verified MFA (ADR-0066).
func NeedsStepUp(rules Rules, grant Perms) bool {
	return !grant.And(rules.Elevated).IsZero()
}
