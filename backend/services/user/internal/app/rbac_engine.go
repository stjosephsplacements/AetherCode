package app

import (
	"log/slog"
	"strings"
)

// Engine selects which model decides a request (ADR-0066). Shadow decides with Casbin and logs
// every request where the role bit sets would have decided differently.
type Engine string

const (
	EngineCasbin Engine = "casbin"
	EngineShadow Engine = "shadow"
	EngineBitset Engine = "bitset"
)

// ParseEngine reads AUTHZ_ENGINE; an empty value is Casbin.
func ParseEngine(value string) (Engine, bool) {
	switch Engine(strings.ToLower(strings.TrimSpace(value))) {
	case "", EngineCasbin:
		return EngineCasbin, true
	case EngineShadow:
		return EngineShadow, true
	case EngineBitset:
		return EngineBitset, true
	}
	return "", false
}

// usesRoleBits reports whether snapshots must carry the role bit sets.
func (engine Engine) usesRoleBits() bool { return engine == EngineShadow || engine == EngineBitset }

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

// logShadowDifference records a request the two models decided differently, so the role bit sets can
// be corrected before the cutover. It carries no personal data beyond the opaque principal ID.
func logShadowDifference(request Request, assignment Assignment, casbin, bits bool) {
	slog.Warn("authz shadow difference",
		"principal", request.PrincipalID, "role", assignment.Role, "scope_kind", assignment.ScopeKind,
		"service", request.TargetService, "resource", request.ResourceType, "action", request.Action,
		"casbin", casbin, "bitset", bits)
}
