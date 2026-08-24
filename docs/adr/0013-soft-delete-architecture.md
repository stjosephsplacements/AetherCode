# ADR-0013: Soft Delete Architecture

- Status: accepted
- Date: 2026-07-25

## Context

AetherCode is a multi-tenant academic platform where data retention is critical for:
1. Academic integrity investigations and appeals
2. Compliance audits and legal discovery
3. Historical performance analytics and trend analysis
4. Accidental deletion recovery

Hard deletes permanently destroy data, making investigations impossible. The platform must preserve audit trails while allowing authorized users to "remove" records from active use.

## Decision

Implement a **medallion-based soft delete architecture**:

1. **Soft delete pattern**: All tenant-scoped tables include `deleted_at`, `deleted_by`, and `deletion_reason` columns. Setting `deleted_at` archives the record without physical removal.

2. **Hard delete restriction**: Only the `super_admin` role can execute hard deletes via a security-definer database function `app.hard_delete()`. All other roles are denied physical DELETE operations through RLS policies.

3. **Automatic filtering**: Default queries filter `WHERE deleted_at IS NULL`. Archived record access requires explicit `include_deleted=true` parameter and appropriate authorization.

4. **Cascade behavior**: Soft deleting a parent marks all children with `deleted_at` through database triggers. Hard deletes use `CASCADE` only after SuperAdmin confirmation.

5. **Audit trail**: Every deletion (soft or hard) publishes a domain event with actor, reason, and affected entity details for the analytics service.

6. **Implementation strategy**:
   - Shared utility: `libs/pkg/database/softdelete.go` with GORM scopes and helpers
   - Database layer: RLS policies, triggers, security-definer functions
   - Domain layer: `SoftDelete(actor, reason)` and `HardDelete(actor, reason)` methods
   - API layer: Authorization middleware checks role before allowing delete operations

7. **Authorization architecture (defense-in-depth)**:
   - **Layer 1 - API authorization**: API middleware verifies actor has `super_admin` role via Casbin/User service mTLS call before invoking `app.hard_delete()`
   - **Layer 2 - Database access control**: `app.hard_delete()` is `SECURITY DEFINER` and only `GRANT EXECUTE` is given to the service's app role — no other database role can invoke it
   - **Layer 3 - RLS enforcement**: `block_delete AS RESTRICTIVE USING(false)` policies prevent any direct DELETE bypassing the function
   - **Rationale**: Application-layer UUIDs cannot map to PostgreSQL roles without creating operational complexity; GRANT-based restriction plus app-layer Casbin is simpler and equally effective
   - Each service's database remains isolated; no querying of `users.role_assignments` across services

## Consequences

### Positive
- **Data safety**: Accidental deletions recoverable by admins
- **Compliance**: Full audit trail for regulatory requirements
- **Investigations**: Historical data available for academic integrity cases
- **Analytics**: Trend analysis includes archived entities

### Negative
- **Database growth**: Soft-deleted records consume storage until hard-deleted
- **Query complexity**: Must explicitly filter `deleted_at IS NULL` in most queries
- **Migration effort**: All existing tables require schema updates
- **Performance**: Indexes must account for `deleted_at` filter predicate

### Operational
- Retention policies determine when SuperAdmin hard-deletes archived records
- Legal holds (ADR-0007) must be checked before any hard delete — code enforces this at the app layer
- Monitoring dashboard tracks soft-delete growth per tenant
- Backup/restore procedures must handle soft-deleted records correctly
- Testing requires fixtures with soft-deleted records to validate filtering

### RLS interaction (critical)
- Tenant-scoped services already have signed-context RLS policies (`authz.current_context_allows()`) for SELECT/INSERT/UPDATE
- The delete-block policy MUST be `AS RESTRICTIVE` (not PERMISSIVE) to AND-combine with existing policies
- Adding PERMISSIVE `USING(true)` for other commands would OR-combine with signed-context policies, defeating tenant isolation
- Services without existing signed-context RLS (identity, judge) may safely use PERMISSIVE `USING(true)`

## Known Limitations

- **`users.students` cannot actually be hard-deleted today.** `app.hard_delete('users.students', ...)`
  cannot succeed for any currently-enrolled student. `student_department_memberships`
  and `current_student_affiliations` both hold `ON DELETE RESTRICT` foreign keys to
  `users.students`, and the `protect_active_student_affiliation` trigger additionally
  blocks removing those membership/affiliation rows while the student's status is
  `'active'`. Soft delete never transitions a student's status away from `'active'`
  or removes those rows, so the SuperAdmin hard-delete guarantee this ADR promises
  is currently broken specifically for `users.students`. Fixing this needs a real
  design decision — either a defined cascade order that also retires the
  membership/affiliation rows, or a status-transition-then-delete flow — and is
  tracked as follow-up work, not fixed here.

## Alternatives Considered

1. **Flag-based (`is_deleted BOOLEAN`)**: Rejected because timestamps provide audit trail of when deletion occurred.

2. **Status enum (`status IN ('active', 'deleted')`)**: Rejected because status often represents business state (e.g., exam: draft/published/retired), conflating lifecycle with deletion.

3. **No soft delete (immediate hard delete)**: Rejected due to academic compliance requirements and investigation needs.

4. **Shadow tables (`_deleted` suffix)**: Rejected due to complexity in querying, foreign key management, and event-driven projection updates.
