package app

import (
	"context"
	"fmt"
	"slices"
	"strings"

	centralauthz "github.com/stjosephsplacements/AetherCode/libs/pkg/authz"
	"github.com/stjosephsplacements/AetherCode/libs/pkg/rbac"
)

// Self is what the signed-in principal may know about their own access:
// their active role assignments and, for a student, their college. The web
// frontend uses it to choose a home and the tenant for its requests; every
// service still authorizes each request itself.
type Self struct {
	PrincipalID string       `json:"principal_id"`
	Roles       []SelfRole   `json:"roles"`
	Student     *SelfStudent `json:"student"`
	// Permissions are the named flags held on any of the caller's roles
	// (union of role bits). Grants and overwrites are not included; services
	// still authorize each request. Used by the BFF for UI gates such as
	// VIEW_STUDENT_PII on the placement console.
	Permissions []string `json:"permissions"`
}

type SelfRole struct {
	RoleName  string `json:"role_name"`
	ScopeKind string `json:"scope_kind"`
	TenantID  string `json:"tenant_id,omitempty"`
	ScopeID   string `json:"scope_id,omitempty"`
}

type SelfStudent struct {
	TenantID string `json:"tenant_id"`
}

// Self verifies the gateway's identity assertion exactly as Authorize does and
// returns the caller's own active assignments. A principal can only ever read
// itself: the principal comes from the verified assertion, not the request.
func (service *Service) Self(contextValue context.Context, assertion string) (Self, error) {
	if assertion == "" || service.identityAssertionVerifier == nil {
		return Self{}, AuthenticationError{}
	}
	identity, err := service.identityAssertionVerifier.Verify(contextValue, assertion)
	principalID := strings.ToLower(strings.TrimSpace(identity.PrincipalID))
	if err != nil || !uuidPattern.MatchString(principalID) {
		return Self{}, AuthenticationError{}
	}
	snapshot, err := service.store.Snapshot(contextValue, SnapshotQuery{PrincipalID: principalID})
	if err != nil {
		return Self{}, fmt.Errorf("read own role assignments: %w", err)
	}
	self := Self{
		PrincipalID: principalID,
		Roles:       make([]SelfRole, 0, len(snapshot.Assignments)),
		Permissions: heldPermissionKeys(snapshot),
	}
	for _, assignment := range snapshot.Assignments {
		self.Roles = append(self.Roles, SelfRole{
			RoleName: string(assignment.Role), ScopeKind: assignment.ScopeKind,
			TenantID: assignment.TenantID, ScopeID: assignment.ScopeID,
		})
		if assignment.Role == centralauthz.RoleStudent && assignment.ScopeKind == "self" && self.Student == nil && assignment.TenantID != "" {
			self.Student = &SelfStudent{TenantID: assignment.TenantID}
		}
	}
	return self, nil
}

// heldPermissionKeys unions every assignment's role bits and returns the flag
// keys that are set. Root administrators are treated as holding ADMINISTRATOR.
func heldPermissionKeys(snapshot Snapshot) []string {
	var held rbac.Perms
	root := false
	for _, assignment := range snapshot.Assignments {
		if assignment.isRoot() {
			root = true
		}
		if assignment.HasPerms {
			held = held.Or(assignment.Perms)
		}
	}
	keys := make([]string, 0, len(snapshot.Flags))
	for key, index := range snapshot.Flags {
		if held.Has(index) {
			keys = append(keys, key)
		}
	}
	if root {
		if _, ok := snapshot.Flags[flagAdministrator]; ok && !slices.Contains(keys, flagAdministrator) {
			keys = append(keys, flagAdministrator)
		}
	}
	slices.Sort(keys)
	if keys == nil {
		return []string{}
	}
	return keys
}
