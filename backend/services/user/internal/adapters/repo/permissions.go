package repo

import (
	"context"
	"fmt"

	"github.com/aethercode/aethercode/libs/pkg/database"
	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
	"github.com/aethercode/aethercode/services/user/internal/app"
	"github.com/jackc/pgx/v5"
)

// grantsFor reads one person's per-person permissions for the authorizer (ADR-0055).
func grantsFor(contextValue context.Context, transaction pgx.Tx, principalID string) ([]app.Grant, error) {
	rows, err := transaction.Query(contextValue, `
		SELECT scope_kind, COALESCE(tenant_id::text, ''), permission
		FROM users.permission_grants
		WHERE principal_id = $1
		ORDER BY scope_kind, tenant_id NULLS FIRST, permission
	`, principalID)
	if err != nil {
		return nil, fmt.Errorf("read permission grants: %w", err)
	}
	defer rows.Close()
	var grants []app.Grant
	for rows.Next() {
		var grant app.Grant
		if err := rows.Scan(&grant.ScopeKind, &grant.TenantID, &grant.Permission); err != nil {
			return nil, fmt.Errorf("scan permission grant: %w", err)
		}
		grants = append(grants, grant)
	}
	return grants, rows.Err()
}

func scopeOf(tenantID string) string {
	if tenantID == "" {
		return "platform"
	}
	return "college"
}

// ReplacePermissionGrants makes the person's permissions in one scope exactly the
// list given: it adds the missing ones and removes the rest. The person has to hold a
// staff role there, because a grant never makes a student into staff.
func (repository *Postgres) ReplacePermissionGrants(contextValue context.Context, transaction pgx.Tx, command app.SetPermissionGrants) ([]string, error) {
	var staff bool
	if err := transaction.QueryRow(contextValue, `
		SELECT users.permission_target_is_staff($1::uuid, NULLIF($2, '')::uuid)
	`, command.PrincipalID, command.TenantID).Scan(&staff); err != nil {
		return nil, fmt.Errorf("check staff role: %w", err)
	}
	if !staff {
		return nil, apperrors.New(apperrors.CodeInvalidArgument, "permissions go to staff who already hold a role here")
	}
	if _, err := transaction.Exec(contextValue, `
		DELETE FROM users.permission_grants
		WHERE principal_id = $1 AND scope_kind = $2 AND tenant_id IS NOT DISTINCT FROM NULLIF($3, '')::uuid
		  AND permission <> ALL($4::text[])
	`, command.PrincipalID, scopeOf(command.TenantID), command.TenantID, command.Permissions); err != nil {
		return nil, mapWriteError(err, "permissions could not be removed")
	}
	for _, permission := range command.Permissions {
		id, err := database.NewUUIDv7()
		if err != nil {
			return nil, err
		}
		if _, err := transaction.Exec(contextValue, `
			INSERT INTO users.permission_grants (id, principal_id, scope_kind, tenant_id, permission, granted_by_principal_id)
			VALUES ($1, $2, $3, NULLIF($4, '')::uuid, $5, $6)
			ON CONFLICT DO NOTHING
		`, id, command.PrincipalID, scopeOf(command.TenantID), command.TenantID, permission, command.GrantedBy); err != nil {
			return nil, mapWriteError(err, "permissions could not be saved")
		}
	}
	return repository.ListPermissionGrants(contextValue, transaction, command.PrincipalID, command.TenantID)
}

func (repository *Postgres) ListPermissionGrants(contextValue context.Context, transaction pgx.Tx, principalID, tenantID string) ([]string, error) {
	rows, err := transaction.Query(contextValue, `
		SELECT permission FROM users.permission_grants
		WHERE principal_id = $1 AND scope_kind = $2 AND tenant_id IS NOT DISTINCT FROM NULLIF($3, '')::uuid
		ORDER BY permission
	`, principalID, scopeOf(tenantID), tenantID)
	if err != nil {
		return nil, fmt.Errorf("list permission grants: %w", err)
	}
	defer rows.Close()
	permissions := []string{}
	for rows.Next() {
		var permission string
		if err := rows.Scan(&permission); err != nil {
			return nil, fmt.Errorf("scan permission: %w", err)
		}
		permissions = append(permissions, permission)
	}
	return permissions, rows.Err()
}

// CallerHasPlatformAccess is true only when the signed context belongs to a
// platform administrator. It reads the context the database already verified.
func (repository *Postgres) CallerHasPlatformAccess(contextValue context.Context, transaction pgx.Tx) (bool, error) {
	var platform bool
	if err := transaction.QueryRow(contextValue, `SELECT authz.current_context_has_platform_access()`).Scan(&platform); err != nil {
		return false, fmt.Errorf("check platform access: %w", err)
	}
	return platform, nil
}
