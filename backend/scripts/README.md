# backend/scripts

Developer and operator scripts for the AetherCode platform backend. Run from the repository root.

## Service scaffolding

| Script | Purpose |
|--------|---------|
| `new-service` | Scaffold a new Go microservice skeleton |
| `new-migration` | Create a numbered up/down migration pair for a service |

## Validation and verification

| Script | Purpose |
|--------|---------|
| `verify-migrations` | Confirm every migration file has a matching down file and correct numbering |
| `validate-soft-delete.sh` | Assert soft-delete conventions are applied to all relevant tables |
| `verify-image-digest` | Verify container image SHAs against their pinned values |

## Infrastructure provisioning

| Script | Purpose |
|--------|---------|
| `provision-authz-context-key` | Generate and store the HMAC key for signed authorization capabilities |
| `provision-platform-connect` | Wire inter-service mTLS certificates for a new service |

## Migration generation

### `generate_authz_migration.py`

Generates the per-service `*_fix_authz_projection_lag.up.sql` / `.down.sql` migration
files from a shared template. The 9 service migrations are structurally identical
and differ only in role name, service guard, event type, and authorization table
variant (`global` for `question-bank`; `tenant` for all others).

```bash
# Dry-run — print all generated files to stdout
python3 backend/scripts/generate_authz_migration.py

# Verify existing files match generated content (CI gate)
python3 backend/scripts/generate_authz_migration.py --verify

# Apply changes (re-generate all known services)
python3 backend/scripts/generate_authz_migration.py --apply

# One service only
python3 backend/scripts/generate_authz_migration.py --service tenant --apply

# Add a new service
python3 backend/scripts/generate_authz_migration.py \
    --service mynewsvc --migration-number 000007 --apply
```

After `--apply`, commit the generated `.up.sql` files as a normal migration.
The `.down.sql` files are intentional no-ops: they document the revert path
without deleting functions that other services depend on.
