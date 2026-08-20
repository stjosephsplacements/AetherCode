# Soft Delete Architecture - Gap Remediation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to execute this plan task-by-task.

**Goal:** Fix all 20 identified gaps in soft delete architecture to achieve production readiness.

**Architecture:** Multi-phase remediation targeting critical blockers first, then coverage completion, then operational excellence.

**Tech Stack:** PostgreSQL RLS, NATS JetStream, Prometheus metrics, Go domain events, cron automation

## Global Constraints

- Fix must not break existing functionality (6 services already deployed)
- All fixes must include tests
- Each fix must be independently deployable
- Maintain backward compatibility where possible
- Follow ADR-0013 architecture patterns

---

## Phase 1: Critical Blockers (Tasks 1-8)

### Task 1: Fix Cross-Schema Dependency in hard_delete()

**Files:**
- Modify: `services/identity/migrations/000008_soft_delete_schema.up.sql`
- Modify: `services/tenant/migrations/000008_soft_delete_schema.up.sql`
- Modify: `services/user/migrations/000017_soft_delete_schema.up.sql`
- Modify: `services/assessment/migrations/000012_soft_delete_schema.up.sql`
- Modify: `services/submission/migrations/000013_soft_delete_schema.up.sql`
- Modify: `services/question-bank/migrations/000006_soft_delete_schema.up.sql`
- Create: New migration for each service fixing the function

**Problem:** `app.hard_delete()` queries `users.role_assignments` which doesn't exist in other service databases.

**Solution:** Remove role check from database function, document that authorization is API-layer only.

**Steps:**
- [ ] Create migration 000009 for identity service
- [ ] Create migration 000009 for tenant service  
- [ ] Create migration 000018 for user service
- [ ] Create migration 000013 for assessment service
- [ ] Create migration 000014 for submission service
- [ ] Create migration 000007 for question-bank service
- [ ] Each migration: `CREATE OR REPLACE FUNCTION app.hard_delete()` without role check
- [ ] Update template in `docs/templates/soft-delete-migration.sql`
- [ ] Update ADR-0013 to document API-layer authorization requirement
- [ ] Test migrations on all 6 services
- [ ] Commit

---

### Task 2: Add RLS Policies to All Services

**Files:**
- Create: `services/identity/migrations/000010_soft_delete_rls.up.sql`
- Create: `services/tenant/migrations/000010_soft_delete_rls.up.sql`
- Create: `services/user/migrations/000019_soft_delete_rls.up.sql`
- Create: `services/assessment/migrations/000014_soft_delete_rls.up.sql`
- Create: `services/submission/migrations/000015_soft_delete_rls.up.sql`
- Create: `services/question-bank/migrations/000008_soft_delete_rls.up.sql`
- Plus `.down.sql` files for each

**Solution:** Add RLS policies that block DELETE statements, allowing only through security-definer function.

**Steps:**
- [ ] Identity service RLS migration
- [ ] Tenant service RLS migration
- [ ] User service RLS migration
- [ ] Assessment service RLS migration
- [ ] Submission service RLS migration
- [ ] Question-bank service RLS migration
- [ ] Test that direct DELETE fails but app.hard_delete() succeeds
- [ ] Commit

---

### Task 3: Judge Service Soft Delete

**Files:**
- Create: `services/judge/migrations/000003_soft_delete_schema.up.sql`
- Create: `services/judge/migrations/000003_soft_delete_schema.down.sql`

**Tables to update:**
- `judge.execution_jobs`
- `judge.reconciliation_state`
- `judge.delivery_leases`

**Steps:**
- [ ] Identify all Judge service tables needing soft delete
- [ ] Create up migration with deleted_at, deleted_by, deletion_reason
- [ ] Create down migration
- [ ] Test migration
- [ ] Commit

---

### Task 4: SEB Service Soft Delete

**Files:**
- Create: `services/seb/migrations/000004_soft_delete_schema.up.sql`
- Create: `services/seb/migrations/000004_soft_delete_schema.down.sql`

**Tables to update:**
- `seb.configurations`
- `seb.sessions`
- `seb.audit_events`

**Steps:**
- [ ] Create migrations for SEB tables
- [ ] Test migrations
- [ ] Commit

---

### Task 5: Notification Service Soft Delete

**Files:**
- Create: `services/notification/migrations/000003_soft_delete_schema.up.sql`
- Create: `services/notification/migrations/000003_soft_delete_schema.down.sql`

**Tables to update:**
- `notification.notifications`
- `notification.preferences`
- `notification.delivery_attempts`

**Steps:**
- [ ] Create migrations for notification tables
- [ ] Test migrations
- [ ] Commit

---

### Task 6: Analytics Service Soft Delete

**Files:**
- Create: `services/analytics/migrations/000011_soft_delete_schema.up.sql`
- Create: `services/analytics/migrations/000011_soft_delete_schema.down.sql`

**Tables to update:**
- `analytics.read_models`
- `analytics.projections`
- `analytics.report_exports`

**Steps:**
- [ ] Create migrations for analytics tables
- [ ] Test migrations
- [ ] Commit

---

### Task 7: Implement Domain Event Publishing

**Files:**
- Create: `libs/pkg/messaging/publisher.go`
- Create: `libs/pkg/messaging/publisher_test.go`
- Modify: `services/user/internal/app/management.go` (replace placeholder)
- Create: `libs/proto/events/deletion.proto`

**Solution:** Wire up actual NATS JetStream publisher for deletion events.

**Steps:**
- [ ] Define deletion event protobuf schema
- [ ] Implement NATS publisher in libs/pkg/messaging
- [ ] Add tests for publisher
- [ ] Replace User service placeholder with real publisher
- [ ] Add configuration for NATS connection
- [ ] Test end-to-end event publishing
- [ ] Commit

---

### Task 8: Add Cascade Triggers for Other Services

**Files:**
- Create: `services/tenant/migrations/000011_cascade_triggers.up.sql`
- Create: `services/assessment/migrations/000015_cascade_triggers.up.sql`
- Create: `services/identity/migrations/000011_cascade_triggers.up.sql`

**Cascades to implement:**
- Tenant → Departments → Batches
- Exam → Assignments → Attempts
- Principal → Credentials → MFA

**Steps:**
- [ ] Tenant cascade trigger (tenant → departments → batches)
- [ ] Assessment cascade trigger (exam → assignments)
- [ ] Identity cascade trigger (principal → credentials → mfa)
- [ ] Test cascade behavior
- [ ] Commit

---

## Phase 2: Operational Excellence (Tasks 9-13)

### Task 9: Retention Policy Automation

**Files:**
- Create: `services/user/cmd/retention-worker/main.go`
- Create: `services/user/internal/retention/policy.go`
- Create: `deploy/cron/retention-policy.yaml` (K8s CronJob)

**Solution:** Automated cron job to hard-delete expired soft-deleted records.

**Steps:**
- [ ] Implement retention policy evaluation logic
- [ ] Create cron worker that scans for expired records
- [ ] Execute hard deletes via security-definer function
- [ ] Add Kubernetes CronJob manifest
- [ ] Add tests
- [ ] Commit

---

### Task 10: Add Monitoring and Metrics

**Files:**
- Modify: `libs/pkg/database/softdelete.go` (add Prometheus metrics)
- Create: `deploy/monitoring/soft-delete-dashboard.json` (Grafana)
- Modify: `services/user/internal/app/management.go` (add metrics)

**Metrics to add:**
- `soft_deletes_total{service, table}`
- `hard_deletes_total{service, table}`
- `soft_deleted_records_bytes{service, table}`
- `soft_deleted_records_count{service, table}`

**Steps:**
- [ ] Add Prometheus metrics to softdelete.go
- [ ] Instrument User service with metrics
- [ ] Create Grafana dashboard JSON
- [ ] Add alerts for runaway growth
- [ ] Test metrics collection
- [ ] Commit

---

### Task 11: Centralized Audit Trail

**Files:**
- Create: `services/audit/` (new microservice)
- Create: `services/audit/migrations/000001_audit_trail.up.sql`
- Modify: `libs/pkg/database/softdelete.go` (publish to audit service)

**Solution:** Dedicated audit service that aggregates hard delete events.

**Steps:**
- [ ] Create audit microservice structure
- [ ] Create centralized audit_trail table
- [ ] Modify hard_delete() to publish to audit service
- [ ] Add query API for audit trail
- [ ] Test cross-service audit aggregation
- [ ] Commit

---

### Task 12: Authorization Integration

**Files:**
- Modify: `services/user/internal/app/management.go`
- Create: `libs/pkg/authz/casbin_policies.conf`
- Modify: `libs/pkg/authz/authorizer.go`

**Solution:** Proper Casbin integration for delete operations.

**Steps:**
- [ ] Define Casbin policies for soft/hard delete
- [ ] Integrate User service authorization client
- [ ] Add cross-service authorization checks
- [ ] Test role-based access control
- [ ] Commit

---

### Task 13: Update Validation Script

**Files:**
- Modify: `scripts/validate-soft-delete.sh`

**Updates:**
- Check for RLS policies
- Check all 11 services (not just 6)
- Validate domain event schemas
- Check retention policy configuration

**Steps:**
- [ ] Extend validation script for new services
- [ ] Add RLS policy checks
- [ ] Add event schema validation
- [ ] Test validation script
- [ ] Commit

---

## Phase 3: Enhancements (Tasks 14-18)

### Task 14: Bulk Delete Operations

**Files:**
- Modify: `services/user/internal/app/management.go`
- Modify: `services/user/internal/adapters/http/handler.go`

**Solution:** Batch soft delete endpoint.

**Steps:**
- [ ] Add BulkSoftDelete method to service layer
- [ ] Add POST /students/bulk-delete endpoint
- [ ] Implement transaction-based bulk delete
- [ ] Add tests
- [ ] Commit

---

### Task 15: Restore/Undelete Functionality

**Files:**
- Modify: `services/user/internal/domain/student.go`
- Modify: `services/user/internal/app/management.go`
- Modify: `services/user/internal/adapters/http/handler.go`

**Solution:** API to restore soft-deleted records.

**Steps:**
- [ ] Add Restore() method to domain
- [ ] Add RestoreStudent() to service layer
- [ ] Add POST /students/:id/restore endpoint
- [ ] Add authorization checks
- [ ] Add tests
- [ ] Commit

---

### Task 16: Search with Archive Filter

**Files:**
- Modify: `services/user/internal/adapters/http/handler.go`
- Modify: `services/user/internal/app/management.go`

**Solution:** Add `include_archived` query parameter to search endpoints.

**Steps:**
- [ ] Add include_archived parameter to search API
- [ ] Conditionally apply SoftDeleteScope
- [ ] Update API documentation
- [ ] Add tests
- [ ] Commit

---

### Task 17: Frontend Integration

**Files:**
- Create: `web/app/(dashboard)/archived/page.tsx`
- Modify: `web/app/api/students/route.ts`
- Create: `web/components/ArchiveToggle.tsx`

**Solution:** UI to view and restore archived records.

**Steps:**
- [ ] Create archived records page
- [ ] Add archive toggle component
- [ ] Add restore button for SuperAdmin
- [ ] Add hard delete button for SuperAdmin
- [ ] Test UI workflows
- [ ] Commit

---

### Task 18: Documentation Updates

**Files:**
- Modify: `docs/soft-delete-gaps-analysis.md` (mark gaps as resolved)
- Modify: `docs/adr/0013-soft-delete-architecture.md` (update with fixes)
- Create: `docs/runbooks/soft-delete-operations.md`
- Modify: All service READMEs

**Solution:** Complete documentation of remediation.

**Steps:**
- [ ] Update gap analysis with resolution status
- [ ] Update ADR-0013 with implementation details
- [ ] Create operational runbook
- [ ] Update service READMEs with new features
- [ ] Commit

---

## Plan Complete

All 18 tasks address the 20 identified gaps:

**Phase 1 (Tasks 1-8)**: Critical blockers
- Gap 1: Cross-schema dependency → Task 1
- Gap 2: Missing 4 services → Tasks 3-6
- Gap 3: RLS policies → Task 2
- Gap 4: Domain events → Task 7
- Gap 11: Cascades → Task 8

**Phase 2 (Tasks 9-13)**: Operational excellence
- Gap 5: Retention automation → Task 9
- Gap 7: Monitoring → Task 10
- Gap 12: Audit trail → Task 11
- Gap 9: Authorization → Task 12
- Validation → Task 13

**Phase 3 (Tasks 14-18)**: Enhancements
- Gap 16: Bulk delete → Task 14
- Gap 17: Restore → Task 15
- Gap 18: Search filter → Task 16
- Gap 10: Frontend → Task 17
- Documentation → Task 18

**Remaining gaps** (6, 8, 13-15, 19-20): Covered by operational improvements across tasks.

---

**Execution Strategy**: Use superpowers:subagent-driven-development to execute all 18 tasks systematically with test-driven approach and continuous validation.
