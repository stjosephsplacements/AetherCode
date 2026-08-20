# Complete Soft Delete Implementation Plan

> **For agentic workers:** Execute all remaining work to achieve 100% feature completion

**Goal:** Complete application layer for all 9 remaining services, add infrastructure components, achieve true production readiness

**Current State**: 35% complete (database layer done, User service complete)
**Target State**: 100% complete (all services working, infrastructure operational)

## Global Constraints

- Follow User service as reference implementation
- Maintain consistency across all services
- All code must include tests
- Each service independently deployable
- Zero breaking changes to existing functionality

---

## PHASE 1: Critical Services Application Layer (Priority 1)

### Task 1: Identity Service Complete Implementation

**Files:**
- Modify: `services/identity/internal/domain/principal.go`
- Create: `services/identity/internal/domain/principal_test.go` (soft delete tests)
- Modify: `services/identity/internal/adapters/repo/postgres.go`
- Create: `services/identity/internal/adapters/repo/postgres_test.go` (soft delete tests)
- Modify: `services/identity/internal/app/service.go`
- Modify: `services/identity/internal/adapters/http/handler.go`

**Implementation:**
- [ ] Add `DeletedAt`, `DeletedBy`, `DeletionReason` to Principal struct
- [ ] Implement `Principal.SoftDelete(actor, reason)` with validation
- [ ] Implement `Principal.IsDeleted()` and `CanHardDelete(roles)`
- [ ] Write domain tests (TDD approach)
- [ ] Update all repository queries to use `Scopes(database.SoftDeleteScope())`
- [ ] Add `GetPrincipalIncludeDeleted()` method
- [ ] Add `SoftDeletePrincipal()` and `HardDeletePrincipal()` methods
- [ ] Write repository integration tests
- [ ] Add service layer `DeletePrincipal()` and `HardDeletePrincipal()` methods
- [ ] Add API endpoints `DELETE /principals/:id` and `DELETE /principals/:id/hard`
- [ ] Write API tests
- [ ] Commit

---

### Task 2: Assessment Service Complete Implementation

**Tables**: exams, exam_versions, candidate_assignments

**Pattern**: Same as Task 1, for Exam entity

- [ ] Domain layer with SoftDelete methods
- [ ] Repository layer with scope filtering
- [ ] Service layer with authorization
- [ ] API layer with endpoints
- [ ] Tests at all layers
- [ ] Commit

---

### Task 3: Submission Service Complete Implementation

**Tables**: attempts

**Pattern**: Same as Task 1, for Attempt entity

- [ ] Domain layer
- [ ] Repository layer
- [ ] Service layer
- [ ] API layer
- [ ] Tests
- [ ] Commit

---

## PHASE 2: Remaining Core Services (Priority 2)

### Task 4: Tenant Service Complete Implementation

**Tables**: tenants, departments, batches, placement_orgs

**Pattern**: Same structure, Tenant entity

---

### Task 5: Question-bank Service Complete Implementation

**Tables**: questions, question_versions

**Pattern**: Same structure, Question entity

---

## PHASE 3: New Services (Priority 3)

### Task 6: Judge Service Complete Implementation

**Challenge**: Service may not have traditional domain layer (wrapper service)

**Approach**: Add soft delete support at repository/API layer only if domain doesn't exist

---

### Task 7: SEB Service Complete Implementation

**Tables**: configurations, sessions

---

### Task 8: Notification Service Complete Implementation

**Tables**: notifications, preferences

---

### Task 9: Analytics Service Complete Implementation

**Tables**: report_exports

**Note**: Event-fed service, minimal domain layer

---

## PHASE 4: Missing RLS Policies (Priority 1)

### Task 10: Add RLS to New Services

**Services**: Judge, SEB, Notification, Analytics

**Pattern**: Same as Task 2 from remediation plan

- [ ] Create RLS migration for Judge
- [ ] Create RLS migration for SEB
- [ ] Create RLS migration for Notification
- [ ] Create RLS migration for Analytics
- [ ] Test all policies
- [ ] Commit

---

## PHASE 5: Event Publishing Infrastructure (Priority 2)

### Task 11: NATS Event Publishing

**Files:**
- Create: `libs/proto/events/deletion.proto`
- Create: `libs/proto/events/deletion.pb.go` (generated)
- Create: `libs/pkg/messaging/publisher.go`
- Create: `libs/pkg/messaging/publisher_test.go`
- Modify: All service layers to publish events

**Implementation:**
- [ ] Define deletion event protobuf schema
- [ ] Generate Go code from proto
- [ ] Implement NATS JetStream publisher
- [ ] Add configuration for NATS connection
- [ ] Write publisher tests
- [ ] Integrate into User service (replace placeholder)
- [ ] Integrate into all other services
- [ ] Add Analytics consumer
- [ ] Test end-to-end event flow
- [ ] Commit

---

## PHASE 6: Monitoring & Observability (Priority 3)

### Task 12: Add Prometheus Metrics

**Files:**
- Modify: `libs/pkg/database/softdelete.go`
- Create: `deploy/monitoring/soft-delete-dashboard.json`

**Metrics:**
- `soft_deletes_total{service, table}`
- `hard_deletes_total{service, table}`
- `soft_deleted_records_count{service, table}`
- `soft_deleted_records_bytes{service, table}`

**Implementation:**
- [ ] Add Prometheus client to softdelete.go
- [ ] Instrument SoftDelete() function
- [ ] Instrument HardDelete() function
- [ ] Create Grafana dashboard JSON
- [ ] Add alerting rules
- [ ] Test metrics collection
- [ ] Commit

---

## PHASE 7: Retention Automation (Priority 3)

### Task 13: Retention Policy Worker

**Files:**
- Create: `services/user/cmd/retention-worker/main.go`
- Create: `services/user/internal/retention/policy.go`
- Create: `services/user/internal/retention/policy_test.go`
- Create: `deploy/cron/retention-policy.yaml`

**Implementation:**
- [ ] Implement retention policy evaluation logic
- [ ] Query for expired soft-deleted records
- [ ] Execute hard delete via database function
- [ ] Add dry-run mode
- [ ] Write tests
- [ ] Create Kubernetes CronJob manifest
- [ ] Document retention configuration
- [ ] Commit

---

## PHASE 8: Additional Cascade Triggers (Priority 4)

### Task 14: Add Missing Cascades

**Services:**
- Tenant: Tenant → Departments → Batches
- Assessment: Exam → Assignments
- Identity: Principal → Credentials → MFA

**Implementation:**
- [ ] Create cascade trigger migration for Tenant
- [ ] Create cascade trigger migration for Assessment
- [ ] Create cascade trigger migration for Identity
- [ ] Test cascade behavior
- [ ] Commit

---

## PHASE 9: Enhancement Features (Priority 5)

### Task 15: Bulk Delete Operations

**Services**: User service first, then others

- [ ] Add BulkSoftDelete() service method
- [ ] Add POST /students/bulk-delete endpoint
- [ ] Transaction-based bulk processing
- [ ] Tests
- [ ] Commit

---

### Task 16: Restore/Undelete API

**Services**: User service first

- [ ] Add Restore() domain method
- [ ] Add repository method
- [ ] Add service method
- [ ] Add POST /:id/restore endpoint
- [ ] Tests
- [ ] Commit

---

### Task 17: Search with Archive Filter

**Services**: All services with search

- [ ] Add include_archived query parameter
- [ ] Conditionally apply SoftDeleteScope
- [ ] Update API documentation
- [ ] Tests
- [ ] Commit

---

## PHASE 10: Documentation & Validation (Priority 1)

### Task 18: Update Documentation

- [ ] Update all service READMEs with complete examples
- [ ] Create operational runbook
- [ ] Update gap analysis with resolutions
- [ ] Update completion report
- [ ] Commit

### Task 19: Update Validation Script

- [ ] Extend script to check all 10 services
- [ ] Add RLS policy validation
- [ ] Add domain/repository/API layer checks
- [ ] Test validation script
- [ ] Commit

### Task 20: Final Integration Testing

- [ ] Run all migrations
- [ ] Test soft delete in all 10 services
- [ ] Test hard delete authorization
- [ ] Test RLS policies
- [ ] Test cascade triggers
- [ ] Test event publishing
- [ ] Test metrics collection
- [ ] Generate final report
- [ ] Commit

---

## Execution Strategy

**Parallel Execution**: 
- Tasks 1-3 (Critical services) in parallel
- Tasks 4-5 (Core services) in parallel
- Tasks 6-9 (New services) in parallel
- Task 10 concurrent with Phase 1-3
- Tasks 11-13 (Infrastructure) in parallel

**Estimated Timeline**:
- Phase 1: 3 services × 8 hours = 24 hours
- Phase 2: 2 services × 8 hours = 16 hours
- Phase 3: 4 services × 6 hours = 24 hours
- Phase 4: RLS policies = 4 hours
- Phase 5: Event publishing = 8 hours
- Phase 6: Monitoring = 6 hours
- Phase 7: Retention = 6 hours
- Phase 8: Cascades = 4 hours
- Phase 9: Enhancements = 8 hours
- Phase 10: Documentation = 4 hours

**Total**: ~100 hours of agent work (can run in parallel)

---

## Success Criteria

✅ All 10 services have complete application layer implementation  
✅ All queries use SoftDeleteScope by default  
✅ All services have DELETE endpoints  
✅ All services have RLS policies  
✅ Event publishing operational  
✅ Monitoring dashboards deployed  
✅ Retention automation working  
✅ 100% test coverage at all layers  
✅ Documentation complete  
✅ Validation script passing  

**Result**: True 100% completion, genuinely production ready
