package rbac

// Compute resolves a member's effective permissions on one scope path, following Discord's
// algorithm (https://docs.discord.com/developers/topics/permissions) walked down the path:
//
//  1. base is the guild's @everyone role plus every role the member holds at a node on the path;
//  2. the owner, or a base with ADMINISTRATOR, holds everything and overwrites are skipped;
//  3. for each node from the top: the @everyone overwrite (deny then allow), all role
//     overwrites for the member's roles (every deny, then every allow), then the member's own
//     overwrite (deny then allow);
//  4. implicit rules: without VIEW_SCOPE nothing remains, and a write flag without its read
//     flag is cleared.
//
// everyone is the role of the guild the path belongs to. Roles assigned at nodes outside the
// path do not apply, and overwrites are matched by node and target.
func Compute(flags Flags, everyone Role, member Member, path []Node, overwrites []Overwrite) Perms {
	if member.Owner {
		return All()
	}
	onPath := make(map[Node]bool, len(path))
	for _, node := range path {
		onPath[node] = true
	}

	base := everyone.Perms
	roleIDs := map[string]bool{everyone.ID: true}
	for _, held := range member.Roles {
		if onPath[held.At] {
			base = base.Or(held.Role.Perms)
			roleIDs[held.Role.ID] = true
		}
	}
	if base.Has(flags.Administrator) {
		return All()
	}

	p := base
	for _, node := range path {
		var roleAllow, roleDeny Perms
		for _, ow := range overwrites {
			if ow.At != node {
				continue
			}
			if ow.TargetKind == TargetRole && ow.TargetID == everyone.ID {
				p = p.AndNot(ow.Deny).Or(ow.Allow)
			}
		}
		for _, ow := range overwrites {
			if ow.At == node && ow.TargetKind == TargetRole && ow.TargetID != everyone.ID && roleIDs[ow.TargetID] {
				roleAllow = roleAllow.Or(ow.Allow)
				roleDeny = roleDeny.Or(ow.Deny)
			}
		}
		p = p.AndNot(roleDeny).Or(roleAllow)
		for _, ow := range overwrites {
			if ow.At == node && ow.TargetKind == TargetMember && ow.TargetID == member.ID {
				p = p.AndNot(ow.Deny).Or(ow.Allow)
			}
		}
	}
	return implicit(flags, p)
}

// implicit applies the rules that hold whatever the overwrites said.
func implicit(flags Flags, p Perms) Perms {
	if !p.Has(flags.ViewScope) {
		return Perms{}
	}
	for write, read := range flags.WriteImpliesRead {
		if p.Has(write) && !p.Has(read) {
			p = p.AndNot(Bit(write))
		}
	}
	return p
}

// Combine resolves a member on each tree of a guild (college tree, placement tree) and ORs
// the results: access is allowed if either tree allows it.
func Combine(results ...Perms) Perms {
	var p Perms
	for _, r := range results {
		p = p.Or(r)
	}
	return p
}
