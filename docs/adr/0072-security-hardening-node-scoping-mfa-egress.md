# ADR-0072: Security hardening — node scoping, MFA step-up, egress NetworkPolicies

**Status:** accepted  
**Date:** 2026-11-05

## Context

A security audit (F-001, F-002, F-007) identified three core gaps in the platform's authorization
and network isolation:

1. **F-001 (HIGH):** The capability chain signed only tenant-level scope. A staff member assigned to
   department A could read and write resources belonging to department B within the same tenant,
   because `assignmentApplies` checked `assignment.TenantID == request.TenantID` without verifying
   the department or batch scope ID.

2. **F-002 (MEDIUM):** Elevated operations (permission grants, role management, question exports,
   account provisioning) had no MFA recency requirement. A stolen session could perform privileged
   actions without re-authentication.

3. **F-007 (MEDIUM):** Platform service pods had ingress-only NetworkPolicies. Any pod could make
   arbitrary outbound connections, broadening the blast radius of a compromised container.

## Decision

### Node-scoped capability chain (v2 → v3)

- The signed capability envelope moves from `aether-authz-context-v2` (11 fields) to
  `aether-authz-context-v3` (13 fields, adding `nodes` as comma-joined UUIDs between `resource`
  and `issued_at`).
- `Capability.Nodes` carries the department, batch, and placement-department scope IDs from matching
  assignments. College-scope administrators produce an empty node list (unrestricted within tenant).
- `authz.set_context` in every service database accepts 12 parameters. The nodes array is stored in
  `authz.request_contexts.nodes`. The HMAC covers nodes, preventing any modification.
- A new `authz.current_context_covers_node(p_node_id uuid)` helper in user, assessment, analytics,
  and tenant databases returns true when the node is in the context's array or when the array is
  NULL/empty (unrestricted). Department/batch-keyed RLS policies will call this helper.
- Maximum 64 nodes per capability; each must be a UUID. Validation occurs both in Go and in the
  database function.

### MFA step-up for elevated operations

- `authn.Claims` gains an optional `mfa_vat` (MFA verified at) Unix timestamp, set by the Identity
  service when `CompleteMFA` succeeds.
- The User authorization service checks MFA recency (5-minute window) for: `permission_grants`
  write/delete, `roles` write/delete, `role_overwrites` write/delete, `question_exports` read, and
  `accounts` write.
- When the bearer has no recent MFA, the authorization decision returns `MFARequiredError` which
  maps to gRPC `PermissionDenied`. The gateway returns this to the frontend, which prompts for MFA
  re-verification.
- The check applies only when identity assertions are enforced (`requireIdentityAssertion = true`),
  preserving test and development flows.

### Egress NetworkPolicies

- The platform-service Helm chart template adds egress rules when `egress.enabled` is true (default).
  Each service's values file declares its outbound dependencies.
- Default egress allowlist: kube-dns (UDP/TCP 53), Postgres (5432), NATS (4222), and User gRPC
  (8080). Per-service overrides disable unused defaults and add service-specific rules.
- Gateway: all aethercode services (8080), NATS, DNS. No direct Postgres.
- Judge: Postgres, DNS, RabbitMQ (5672), MinIO (9000), execution wrapper (5100). No NATS or User
  gRPC.
- Frontend: gateway (8080), Prometheus (9090). No Postgres, NATS, or User gRPC.

## Consequences

- All 9 service databases must run the v3 migration (`node_scoped_capability_chain`) before
  deploying the updated Go binaries. Roll forward only; the down migration restores v2.
- Existing capabilities issued during migration rollout will fail HMAC validation. The 5-second
  TTL means a brief window of denied requests during deployment; no data is lost.
- Department/batch-keyed RLS policies must be added per table as each service's scoped data is
  ported. The helper function is ready; policies are the next step.
- MFA step-up is enforced at the authorization decision layer. Frontend prompt implementation is
  not included in this change.
- Egress policies require testing in the deployment environment. The `extraRules` escape hatch
  allows temporary additions without chart changes.

## Rollout and known limits (ultrareview follow-up)

- **Upgrade needs a maintenance window.** The v3 `authz.set_context` takes a `nodes` argument and the
  capability prefix moves from v2 to v3. Neither side accepts the other, so a rolling upgrade fails until
  the User service and every other service run the new image. Run the migrations, then roll the User
  service and all other services together, and expect requests to fail until they are all ready.
- **Department scope covers its batches** in `tenant.batches` and the assessment batch tables. Analytics
  rollups have no department column, so a department-scoped capability sees no batch rows there until a
  department projection is added. A batch-scoped capability deliberately does not cover its parent
  department (least privilege).
- A refresh drops an MFA stamp older than 15 minutes instead of failing; elevated writes then need a step-up.
