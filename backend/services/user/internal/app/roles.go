package app

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	centralauthz "github.com/stjosephsplacements/AetherCode/libs/pkg/authz"
	"github.com/stjosephsplacements/AetherCode/libs/pkg/database"
	apperrors "github.com/stjosephsplacements/AetherCode/libs/pkg/errors"
)

// Role is one row of users.roles with its permissions as flag keys (ADR-0066).
type Role struct {
	ID          string   `json:"id"`
	GuildKind   string   `json:"guild_kind"`
	TenantID    string   `json:"tenant_id,omitempty"`
	Tier        int      `json:"tier"`
	Name        string   `json:"name"`
	Position    int      `json:"position"`
	Permissions []string `json:"permissions"`
	Managed     bool     `json:"managed"`
	SystemKey   string   `json:"system_key,omitempty"`
	Version     int      `json:"version"`
}

// PermissionFlag is one entry of the append-only flag registry.
type PermissionFlag struct {
	Key          string `json:"key"`
	BitIndex     int    `json:"bit_index"`
	Kind         string `json:"kind"`
	Elevated     bool   `json:"elevated"`
	PlatformOnly bool   `json:"platform_only"`
}

// Overwrite adjusts a role's or member's permissions at one scope node.
type Overwrite struct {
	ID         string   `json:"id"`
	NodeKind   string   `json:"node_kind"`
	NodeID     string   `json:"node_id,omitempty"`
	TargetKind string   `json:"target_kind"`
	TargetID   string   `json:"target_id"`
	Allow      []string `json:"allow"`
	Deny       []string `json:"deny"`
}

type CreateRole struct {
	TenantID    string
	Name        string
	Tier        int
	Position    int
	Permissions []string
}

type UpdateRole struct {
	TenantID    string
	RoleID      string
	Name        *string
	Position    *int
	Permissions *[]string
}

type PutOverwrite struct {
	TenantID   string
	NodeKind   string
	NodeID     string
	TargetKind string
	TargetID   string
	Allow      []string
	Deny       []string
	GrantedBy  string
}

// RoleStore reads and writes roles and overwrites. The database enforces the hierarchy and the grant
// ceiling in triggers (migration 000040); this layer validates input and shapes errors.
type RoleStore interface {
	ListPermissionFlags(context.Context, pgx.Tx) ([]PermissionFlag, error)
	ListRoles(context.Context, pgx.Tx, string) ([]Role, error)
	CreateRole(context.Context, pgx.Tx, CreateRole) (Role, error)
	UpdateRole(context.Context, pgx.Tx, UpdateRole) (Role, error)
	DeleteRole(context.Context, pgx.Tx, string, string) error
	ListOverwrites(context.Context, pgx.Tx, string, string, string) ([]Overwrite, error)
	PutOverwrite(context.Context, pgx.Tx, PutOverwrite) (Overwrite, error)
	DeleteOverwrite(context.Context, pgx.Tx, string, string) error
}

// RolesService manages a college's roles and overwrites.
type RolesService struct {
	pool  *pgxpool.Pool
	store RoleStore
}

func NewRolesService(pool *pgxpool.Pool, store RoleStore) (*RolesService, error) {
	if pool == nil || store == nil {
		return nil, fmt.Errorf("user database pool and role store are required")
	}
	return &RolesService{pool: pool, store: store}, nil
}

var overwriteNodeKinds = map[string]bool{"college": true, "department": true, "batch": true}

func validRoleName(name string) bool {
	return len(name) >= 1 && len(name) <= 64 && !strings.ContainsAny(name, "\n\r\t")
}

func invalidRole(reason string) error { return apperrors.New(apperrors.CodeInvalidArgument, reason) }

func (service *RolesService) run(ctx context.Context, capability centralauthz.Capability, fn func(pgx.Tx) error) error {
	return database.WithTenantTx(ctx, service.pool, capability, fn)
}

func (service *RolesService) Flags(ctx context.Context, capability centralauthz.Capability) ([]PermissionFlag, error) {
	var flags []PermissionFlag
	err := service.run(ctx, capability, func(tx pgx.Tx) (err error) { flags, err = service.store.ListPermissionFlags(ctx, tx); return })
	return flags, err
}

func (service *RolesService) List(ctx context.Context, capability centralauthz.Capability, tenantID string) ([]Role, error) {
	if !isUUID(tenantID) {
		return nil, invalidRole("a college ID is required")
	}
	var roles []Role
	err := service.run(ctx, capability, func(tx pgx.Tx) (err error) { roles, err = service.store.ListRoles(ctx, tx, tenantID); return })
	return roles, err
}

func (service *RolesService) Create(ctx context.Context, capability centralauthz.Capability, command CreateRole) (Role, error) {
	command.Name = strings.TrimSpace(command.Name)
	if !isUUID(command.TenantID) || !validRoleName(command.Name) || (command.Tier != 1 && command.Tier != 2) || command.Position < 0 || command.Position >= 1000 {
		return Role{}, invalidRole("a role needs a college, a name of up to 64 characters, tier 1 or 2 and a position below 1000")
	}
	var role Role
	err := service.run(ctx, capability, func(tx pgx.Tx) (err error) { role, err = service.store.CreateRole(ctx, tx, command); return })
	return role, err
}

func (service *RolesService) Update(ctx context.Context, capability centralauthz.Capability, command UpdateRole) (Role, error) {
	if !isUUID(command.TenantID) || !isUUID(command.RoleID) || (command.Name == nil && command.Position == nil && command.Permissions == nil) {
		return Role{}, invalidRole("name a role and at least one change")
	}
	if command.Name != nil {
		trimmed := strings.TrimSpace(*command.Name)
		if !validRoleName(trimmed) {
			return Role{}, invalidRole("a role name is up to 64 characters")
		}
		command.Name = &trimmed
	}
	if command.Position != nil && (*command.Position < 0 || *command.Position >= 1000) {
		return Role{}, invalidRole("a position is below 1000")
	}
	var role Role
	err := service.run(ctx, capability, func(tx pgx.Tx) (err error) { role, err = service.store.UpdateRole(ctx, tx, command); return })
	return role, err
}

func (service *RolesService) Delete(ctx context.Context, capability centralauthz.Capability, tenantID, roleID string) error {
	if !isUUID(tenantID) || !isUUID(roleID) {
		return invalidRole("a college and a role are required")
	}
	return service.run(ctx, capability, func(tx pgx.Tx) error { return service.store.DeleteRole(ctx, tx, tenantID, roleID) })
}

func (service *RolesService) Overwrites(ctx context.Context, capability centralauthz.Capability, tenantID, nodeKind, nodeID string) ([]Overwrite, error) {
	if !isUUID(tenantID) || (nodeKind != "" && !overwriteNodeKinds[nodeKind]) || (nodeID != "" && !isUUID(nodeID)) {
		return nil, invalidRole("a college, and optionally a node, are required")
	}
	var found []Overwrite
	err := service.run(ctx, capability, func(tx pgx.Tx) (err error) {
		found, err = service.store.ListOverwrites(ctx, tx, tenantID, nodeKind, nodeID)
		return
	})
	return found, err
}

func (service *RolesService) Put(ctx context.Context, capability centralauthz.Capability, command PutOverwrite) (Overwrite, error) {
	if !isUUID(command.TenantID) || !overwriteNodeKinds[command.NodeKind] || !isUUID(command.NodeID) ||
		(command.TargetKind != "role" && command.TargetKind != "member") || !isUUID(command.TargetID) || !isUUID(command.GrantedBy) {
		return Overwrite{}, invalidRole("an overwrite needs a college, a node, a role or member and a granting member")
	}
	if command.NodeKind == "college" && command.NodeID != command.TenantID {
		return Overwrite{}, invalidRole("a college overwrite names its own college")
	}
	var stored Overwrite
	err := service.run(ctx, capability, func(tx pgx.Tx) (err error) { stored, err = service.store.PutOverwrite(ctx, tx, command); return })
	return stored, err
}

func (service *RolesService) DeleteOverwrite(ctx context.Context, capability centralauthz.Capability, tenantID, id string) error {
	if !isUUID(tenantID) || !isUUID(id) {
		return invalidRole("a college and an overwrite are required")
	}
	return service.run(ctx, capability, func(tx pgx.Tx) error { return service.store.DeleteOverwrite(ctx, tx, tenantID, id) })
}
