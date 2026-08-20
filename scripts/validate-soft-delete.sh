#!/usr/bin/env bash
set -euo pipefail

echo "=== Validating Soft Delete Implementation ==="

SERVICES=(identity tenant user assessment submission question-bank)

for svc in "${SERVICES[@]}"; do
    echo "Checking $svc service..."

    # Verify migration files exist
    up_migration=$(find "services/$svc/migrations" -name "*soft_delete*.up.sql" | head -1)
    if [[ -z "$up_migration" ]]; then
        echo "ERROR: No soft delete up migration for $svc"
        exit 1
    fi

    # Verify migration contains required columns
    for col in deleted_at deleted_by deletion_reason; do
        if ! grep -q "ADD COLUMN $col" "$up_migration"; then
            echo "ERROR: Migration missing $col column in $svc"
            exit 1
        fi
    done

    # Verify hard_delete function exists
    if ! grep -q "CREATE OR REPLACE FUNCTION app.hard_delete" "$up_migration"; then
        echo "ERROR: Missing hard_delete function in $svc"
        exit 1
    fi

    echo "✓ $svc migration valid"
done

# Verify shared utilities exist
if [[ ! -f "libs/pkg/database/softdelete.go" ]]; then
    echo "ERROR: Missing shared softdelete.go"
    exit 1
fi

if ! grep -q "func SoftDeleteScope" "libs/pkg/database/softdelete.go"; then
    echo "ERROR: Missing SoftDeleteScope function"
    exit 1
fi

echo "✓ Shared utilities valid"

# Verify ADR exists
if [[ ! -f "docs/adr/0013-soft-delete-architecture.md" ]]; then
    echo "ERROR: Missing ADR-0013"
    exit 1
fi

echo "✓ ADR-0013 exists"

echo "=== All Soft Delete Validations Passed ==="
