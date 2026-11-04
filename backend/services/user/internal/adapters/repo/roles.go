package repo

import (
	"context"
	"errors"
	"fmt"

	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
	"github.com/aethercode/aethercode/services/user/internal/app"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// roleColumns reads a role with its permissions as the flag keys that are set.
const roleColumns = `
	r.id::text, r.guild_kind, COALESCE(r.tenant_id::text, ''), r.tier, r.name, r.position,
	COALESCE((SELECT array_agg(f.key ORDER BY f.bit_index) FROM users.permission_flags AS f WHERE get_bit(r.permissions, f.bit_index) = 1), '{}'),
	r.managed, COALESCE(r.system_key, ''), r.version`

func scanRole(row pgx.Row) (app.Role, error) {
	var role app.Role
	err := row.Scan(&role.ID, &role.GuildKind, &role.TenantID, &role.Tier, &role.Name, &role.Position, &role.Permissions, &role.Managed, &role.SystemKey, &role.Version)
	return role, err
}

// roleError turns the database's refusals into caller errors: the hierarchy and ceiling triggers raise 42501.
func roleError(err error, action string) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "42501":
			return apperrors.New(apperrors.CodeForbidden, pgErr.Message)
		case "23505":
			return apperrors.New(apperrors.CodeConflict, "a role with that name already exists")
		case "23503", "22023", "22P02":
			return apperrors.New(apperrors.CodeInvalidArgument, "the role or its permissions are not valid")
		}
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return apperrors.New(apperrors.CodeNotFound, "not found")
	}
	return fmt.Errorf("%s: %w", action, err)
}

// flagBits turns flag keys into a bit(256) value, refusing unknown keys and platform-only flags,
// which only a platform role may hold.
func flagBits(ctx context.Context, tx pgx.Tx, keys []string) (string, error) {
	if len(keys) == 0 {
		keys = []string{}
	}
	var bits string
	var known int
	err := tx.QueryRow(ctx, `
		SELECT users.flag_bits($1::text[])::text,
		       (SELECT count(*) FROM users.permission_flags WHERE key = ANY ($1::text[]) AND NOT platform_only)
	`, keys).Scan(&bits, &known)
	if err != nil {
		return "", fmt.Errorf("encode permissions: %w", err)
	}
	if known != len(uniqueStrings(keys)) {
		return "", apperrors.New(apperrors.CodeInvalidArgument, "a permission is unknown or only a platform role may hold it")
	}
	return bits, nil
}

func uniqueStrings(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	out := values[:0:0]
	for _, value := range values {
		if _, ok := seen[value]; !ok {
			seen[value] = struct{}{}
			out = append(out, value)
		}
	}
	return out
}

func (repository *Postgres) ListPermissionFlags(ctx context.Context, tx pgx.Tx) ([]app.PermissionFlag, error) {
	rows, err := tx.Query(ctx, `SELECT key, bit_index, kind, elevated, platform_only FROM users.permission_flags ORDER BY bit_index`)
	if err != nil {
		return nil, roleError(err, "list permission flags")
	}
	defer rows.Close()
	flags := []app.PermissionFlag{}
	for rows.Next() {
		var flag app.PermissionFlag
		if err := rows.Scan(&flag.Key, &flag.BitIndex, &flag.Kind, &flag.Elevated, &flag.PlatformOnly); err != nil {
			return nil, fmt.Errorf("scan permission flag: %w", err)
		}
		flags = append(flags, flag)
	}
	return flags, rows.Err()
}

func (repository *Postgres) ListRoles(ctx context.Context, tx pgx.Tx, tenantID string) ([]app.Role, error) {
	rows, err := tx.Query(ctx, `SELECT `+roleColumns+` FROM users.roles AS r WHERE r.guild_kind = 'college' AND r.tenant_id = $1 ORDER BY r.tier DESC, r.position DESC, r.name`, tenantID)
	if err != nil {
		return nil, roleError(err, "list roles")
	}
	defer rows.Close()
	roles := []app.Role{}
	for rows.Next() {
		role, err := scanRole(rows)
		if err != nil {
			return nil, fmt.Errorf("scan role: %w", err)
		}
		roles = append(roles, role)
	}
	return roles, rows.Err()
}

func (repository *Postgres) CreateRole(ctx context.Context, tx pgx.Tx, command app.CreateRole) (app.Role, error) {
	bits, err := flagBits(ctx, tx, command.Permissions)
	if err != nil {
		return app.Role{}, err
	}
	role, err := scanRole(tx.QueryRow(ctx, `
		INSERT INTO users.roles AS r (guild_kind, tenant_id, tier, name, position, permissions)
		VALUES ('college', $1, $2, $3, $4, $5::bit(256))
		RETURNING `+roleColumns, command.TenantID, command.Tier, command.Name, command.Position, bits))
	if err != nil {
		return app.Role{}, roleError(err, "create role")
	}
	return role, nil
}

func (repository *Postgres) UpdateRole(ctx context.Context, tx pgx.Tx, command app.UpdateRole) (app.Role, error) {
	bits := ""
	if command.Permissions != nil {
		var err error
		if bits, err = flagBits(ctx, tx, *command.Permissions); err != nil {
			return app.Role{}, err
		}
	}
	role, err := scanRole(tx.QueryRow(ctx, `
		UPDATE users.roles AS r
		SET name = COALESCE($3, r.name), position = COALESCE($4, r.position),
		    permissions = COALESCE(NULLIF($5, '')::bit(256), r.permissions), version = r.version + 1, updated_at = clock_timestamp()
		WHERE r.id = $2 AND r.tenant_id = $1 AND r.guild_kind = 'college'
		RETURNING `+roleColumns, command.TenantID, command.RoleID, command.Name, command.Position, bits))
	if err != nil {
		return app.Role{}, roleError(err, "update role")
	}
	return role, nil
}

func (repository *Postgres) DeleteRole(ctx context.Context, tx pgx.Tx, tenantID, roleID string) error {
	tag, err := tx.Exec(ctx, `DELETE FROM users.roles WHERE id = $2 AND tenant_id = $1 AND guild_kind = 'college'`, tenantID, roleID)
	if err != nil {
		return roleError(err, "delete role")
	}
	if tag.RowsAffected() == 0 {
		return apperrors.New(apperrors.CodeNotFound, "role not found, or it cannot be deleted")
	}
	return nil
}

const overwriteColumns = `
	o.id::text, o.node_kind, COALESCE(o.node_id::text, ''), o.target_kind, o.target_id::text,
	COALESCE((SELECT array_agg(f.key ORDER BY f.bit_index) FROM users.permission_flags AS f WHERE get_bit(o.allow, f.bit_index) = 1), '{}'),
	COALESCE((SELECT array_agg(f.key ORDER BY f.bit_index) FROM users.permission_flags AS f WHERE get_bit(o.deny, f.bit_index) = 1), '{}')`

func scanOverwrite(row pgx.Row) (app.Overwrite, error) {
	var overwrite app.Overwrite
	err := row.Scan(&overwrite.ID, &overwrite.NodeKind, &overwrite.NodeID, &overwrite.TargetKind, &overwrite.TargetID, &overwrite.Allow, &overwrite.Deny)
	return overwrite, err
}

func (repository *Postgres) ListOverwrites(ctx context.Context, tx pgx.Tx, tenantID, nodeKind, nodeID string) ([]app.Overwrite, error) {
	rows, err := tx.Query(ctx, `
		SELECT `+overwriteColumns+` FROM users.permission_overwrites AS o
		WHERE o.tenant_id = $1 AND ($2 = '' OR o.node_kind = $2) AND ($3 = '' OR o.node_id = NULLIF($3, '')::uuid)
		ORDER BY o.node_kind, o.node_id, o.target_kind, o.target_id`, tenantID, nodeKind, nodeID)
	if err != nil {
		return nil, roleError(err, "list overwrites")
	}
	defer rows.Close()
	overwrites := []app.Overwrite{}
	for rows.Next() {
		overwrite, err := scanOverwrite(rows)
		if err != nil {
			return nil, fmt.Errorf("scan overwrite: %w", err)
		}
		overwrites = append(overwrites, overwrite)
	}
	return overwrites, rows.Err()
}

func (repository *Postgres) PutOverwrite(ctx context.Context, tx pgx.Tx, command app.PutOverwrite) (app.Overwrite, error) {
	allow, err := flagBits(ctx, tx, command.Allow)
	if err != nil {
		return app.Overwrite{}, err
	}
	deny, err := flagBits(ctx, tx, command.Deny)
	if err != nil {
		return app.Overwrite{}, err
	}
	overwrite, err := scanOverwrite(tx.QueryRow(ctx, `
		INSERT INTO users.permission_overwrites AS o (node_kind, node_id, tenant_id, target_kind, target_id, allow, deny, granted_by_principal_id)
		VALUES ($1, $2, $3, $4, $5, $6::bit(256), $7::bit(256), $8)
		ON CONFLICT (node_kind, COALESCE(node_id, '00000000-0000-0000-0000-000000000000'::uuid), target_kind, target_id)
		DO UPDATE SET allow = EXCLUDED.allow, deny = EXCLUDED.deny, granted_by_principal_id = EXCLUDED.granted_by_principal_id, updated_at = clock_timestamp()
		RETURNING `+overwriteColumns, command.NodeKind, command.NodeID, command.TenantID, command.TargetKind, command.TargetID, allow, deny, command.GrantedBy))
	if err != nil {
		return app.Overwrite{}, roleError(err, "save overwrite")
	}
	return overwrite, nil
}

func (repository *Postgres) DeleteOverwrite(ctx context.Context, tx pgx.Tx, tenantID, id string) error {
	tag, err := tx.Exec(ctx, `DELETE FROM users.permission_overwrites WHERE id = $2 AND tenant_id = $1`, tenantID, id)
	if err != nil {
		return roleError(err, "delete overwrite")
	}
	if tag.RowsAffected() == 0 {
		return apperrors.New(apperrors.CodeNotFound, "overwrite not found")
	}
	return nil
}
