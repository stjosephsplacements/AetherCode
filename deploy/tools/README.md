# deploy/tools

Maintenance scripts for the AetherCode platform backend.

## generate_authz_migration.py

Generates the per-service `*_fix_authz_projection_lag.up.sql` / `.down.sql` migration
files from a shared template. The 9 service migrations are structurally identical and
differ only in role name, service guard, event type, and authorization table variant
(global for question-bank; tenant for all others).

```
# Dry-run — print all generated files to stdout
python3 deploy/tools/generate_authz_migration.py

# Verify existing files match generated content (CI gate)
python3 deploy/tools/generate_authz_migration.py --verify

# Apply changes (re-generate all known services)
python3 deploy/tools/generate_authz_migration.py --apply

# One service only
python3 deploy/tools/generate_authz_migration.py --service tenant --apply

# Add a new service
python3 deploy/tools/generate_authz_migration.py \
    --service mynewsvc --migration-number 000007 --apply
```

After `--apply`, commit the generated `.up.sql` files as a normal migration.
The `.down.sql` files are intentional no-ops: they document the revert path
without deleting functions that other code depends on.
