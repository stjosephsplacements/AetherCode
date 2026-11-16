// Package authz holds the central authorization primitives: roles, capability
// tokens, the authorization client and MFA step-up handling.
package authz

// Role is a medallion-role assignment persisted by the user service.
type Role string

const (
	RoleSuperAdmin     Role = "super_admin"
	RolePlacementUser  Role = "placement_user"
	RoleCollegeAdmin   Role = "college_admin"
	RoleDepartmentUser Role = "department_user"
	RoleMentor         Role = "mentor"
	RoleStudent        Role = "student"
	// RoleCustom is a college-made role, assigned by role_id; its permissions are its role bits.
	RoleCustom Role = "custom"
)
