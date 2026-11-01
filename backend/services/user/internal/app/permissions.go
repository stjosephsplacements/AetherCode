package app

import (
	"context"
	"fmt"
	"sort"
	"strings"

	centralauthz "github.com/aethercode/aethercode/libs/pkg/authz"
	"github.com/aethercode/aethercode/libs/pkg/database"
	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
	"github.com/jackc/pgx/v5"
)

// Per-person permissions (ADR-0055). A permission is "<service>.<resource>.<verb>",
// for example "assessment.exams.write". A grant adds a permission to what a person's
// role already allows and never removes anything. Write and delete imply read.

// Grant is one permission given to one person.
type Grant struct {
	ScopeKind  string
	TenantID   string
	Permission string
}

// Permission is one entry in the catalogue the permission editor lists.
type Permission struct {
	Key      string `json:"key"`
	Service  string `json:"service"`
	Resource string `json:"resource"`
	Verb     string `json:"verb"`
	// PlatformOnly permissions can be granted only by a root administrator.
	PlatformOnly bool `json:"platform_only"`
}

// platformOnlyResources are never delegated by a college administrator: they act
// across colleges, or hand out access.
var platformOnlyResources = map[string]struct{}{
	"tenant.tenants": {}, "tenant.placement_organizations": {}, "tenant.provisioning_requests": {},
	"question-bank.category_management": {}, "question-bank.question_exports": {},
	"user.permission_grants": {}, "user.role_assignments": {},
}

// unlistedResources are internal or belong to the person themselves, so the editor does not offer them.
var unlistedResources = map[string]struct{}{
	"user.profiles": {}, "user.accounts": {}, "submission.answer_revisions": {}, "submission.judge_receipts": {}, "submission.evaluation_requests": {},
	"notification.provider_idempotency_records": {}, "notification.delivery_attempts": {}, "notification.recipient_preferences": {},
	"seb.sessions": {}, "seb.validation_events": {}, "seb.key_rotations": {}, "assessment.exam_events": {},
}

var grantVerbs = []string{"read", "write", "delete"}

// PermissionCatalogue lists everything that can be granted, built from the same
// resource tables the authorizer uses, so the two cannot drift apart.
func PermissionCatalogue() []Permission {
	catalogue := make([]Permission, 0, 256)
	for service, definition := range routes {
		for resource := range definition.Resources {
			key := service + "." + resource
			if _, skip := unlistedResources[key]; skip {
				continue
			}
			_, platformOnly := platformOnlyResources[key]
			for _, verb := range grantVerbs {
				catalogue = append(catalogue, Permission{Key: key + "." + verb, Service: service, Resource: resource, Verb: verb, PlatformOnly: platformOnly})
			}
		}
	}
	sort.Slice(catalogue, func(i, j int) bool { return catalogue[i].Key < catalogue[j].Key })
	return catalogue
}

// ExpandPermissions returns the permissions with the reads that write and delete imply, sorted and without repeats.
func ExpandPermissions(permissions []string) []string {
	seen := make(map[string]struct{}, len(permissions)*2)
	for _, permission := range permissions {
		seen[permission] = struct{}{}
		cut := strings.LastIndex(permission, ".")
		if cut < 0 {
			continue
		}
		if verb := permission[cut+1:]; verb == "write" || verb == "delete" {
			seen[permission[:cut]+".read"] = struct{}{}
		}
	}
	expanded := make([]string, 0, len(seen))
	for permission := range seen {
		expanded = append(expanded, permission)
	}
	sort.Strings(expanded)
	return expanded
}

var catalogueKeys = func() map[string]Permission {
	keys := make(map[string]Permission)
	for _, permission := range PermissionCatalogue() {
		keys[permission.Key] = permission
	}
	return keys
}()

// grantAllows reports whether any grant covers this request. Write and delete
// grants cover reads of the same resource; a delete grant does not cover writes.
func grantAllows(grants []Grant, request Request, staffAuthoring bool) (Scope, bool) {
	base := request.TargetService + "." + request.ResourceType + "."
	for _, grant := range grants {
		if !strings.HasPrefix(grant.Permission, base) {
			continue
		}
		verb := strings.TrimPrefix(grant.Permission, base)
		covered := verb == request.Action || (request.Action == "read" && (verb == "write" || verb == "delete"))
		if !covered {
			continue
		}
		switch grant.ScopeKind {
		case "platform":
			return Scope{Kind: "platform"}, true
		case "college":
			if grant.TenantID == request.TenantID || (request.TenantID == "" && staffAuthoring) {
				return Scope{Kind: "college", ID: grant.TenantID}, true
			}
		}
	}
	return Scope{}, false
}

// holdsStaffRole is false for someone who only has the student role: a grant never
// makes a student into staff.
func holdsStaffRole(assignments []Assignment) bool {
	for _, assignment := range assignments {
		if assignment.Role != centralauthz.RoleStudent {
			return true
		}
	}
	return false
}

// SetPermissionGrants replaces the permissions one person holds in one scope.
type SetPermissionGrants struct {
	PrincipalID string
	// TenantID is empty for platform scope.
	TenantID    string
	Permissions []string
	GrantedBy   string
}

// SetPermissionGrants checks the ceiling inside the transaction, from the signed
// authorization context and never from the request: only a root administrator grants
// platform scope or a platform-only permission, and a college administrator is limited
// to their own college by row-level security.
func (service *ManagementService) SetPermissionGrants(contextValue context.Context, capability centralauthz.Capability, command SetPermissionGrants) ([]string, error) {
	if !isUUID(command.PrincipalID) || !isUUID(command.GrantedBy) || (command.TenantID != "" && !isUUID(command.TenantID)) {
		return nil, apperrors.New(apperrors.CodeInvalidArgument, "person, college and granting staff member must be valid IDs")
	}
	if len(command.Permissions) > len(catalogueKeys) {
		return nil, apperrors.New(apperrors.CodeInvalidArgument, "too many permissions")
	}
	needsPlatform := command.TenantID == ""
	for _, permission := range command.Permissions {
		entry, known := catalogueKeys[permission]
		if !known {
			return nil, apperrors.New(apperrors.CodeInvalidArgument, fmt.Sprintf("%q is not a permission", permission))
		}
		needsPlatform = needsPlatform || entry.PlatformOnly
	}
	command.Permissions = ExpandPermissions(command.Permissions)
	var stored []string
	err := database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		if needsPlatform {
			platform, err := service.store.CallerHasPlatformAccess(contextValue, transaction)
			if err != nil {
				return err
			}
			if !platform {
				return apperrors.New(apperrors.CodeForbidden, "only a root administrator grants platform-wide or platform-only permissions")
			}
		}
		var err error
		stored, err = service.store.ReplacePermissionGrants(contextValue, transaction, command)
		return err
	})
	return stored, err
}

func (service *ManagementService) ListPermissionGrants(contextValue context.Context, capability centralauthz.Capability, principalID, tenantID string) ([]string, error) {
	if !isUUID(principalID) || (tenantID != "" && !isUUID(tenantID)) {
		return nil, apperrors.New(apperrors.CodeInvalidArgument, "person and college must be valid IDs")
	}
	var permissions []string
	err := database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		var err error
		permissions, err = service.store.ListPermissionGrants(contextValue, transaction, principalID, tenantID)
		return err
	})
	return permissions, err
}
