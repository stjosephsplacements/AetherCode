# Soft Delete Architecture - Gaps Analysis & Action Plan

**Date**: 2026-07-25  
**Status**: Post-Implementation Review  
**Reference**: ADR-0013

---

## Executive Summary

The soft delete architecture (Tasks 1-13) successfully implemented the foundation for 6 out of 11 platform services. However, **20 logical gaps** remain that range from critical production blockers to nice-to-have enhancements.

**Completion Status**: 54% (6/11 services)

---

## ❌ CRITICAL GAPS (Must Fix Before Production)

### 1. Cross-Schema Dependency Breaks Hard Delete **[BLOCKER]**

**Problem**: Every service's `app.hard_delete()` function queries `users.role_assignments` table, but services don't have cross-database access.

```sql
-- Current code in Identity/Tenant/Assessment/Submission/QBank:
SELECT role_name FROM users.role_assignments 
WHERE principal_id = p_actor AND role_name = 'super_admin'
-- ❌ FAILS: relation "users.role_assignments" does not exist
```

**Impact**: Hard delete will fail with runtime error in production

**Fix Options**:
1. **Authorization at API layer only** (remove DB check) - recommended
2. **Cross-database grants** (complex, security risk)
3. **Replicate role_assignments** via event projections (eventual consistency risk)

**Recommendation**: Fix in `app.hard_delete()` - remove role check, rely on API authorization

---

### 2. Missing 4 Services (36% of Platform)

**Services without soft delete**:
- **Judge** (wrapper control plane) - execution jobs, reconciliation state
- **SEB** - configuration objects, sessions, audit events
- **Notification** - notifications, preferences, delivery attempts
- **Analytics** - event-fed projections, report exports

**Impact**: These services can hard-delete without audit trail

**Priority**: Judge > SEB > Notification > Analytics (by data sensitivity)

---

### 3. RLS Policies Not Enforced at Database Layer

**Current**: Only application-layer authorization  
**Missing**: PostgreSQL RLS policies to block DELETE statements

```sql
-- Template shows this but migrations don't include it:
ALTER TABLE schema.table ENABLE ROW LEVEL SECURITY;
CREATE POLICY delete_blocked_non_superadmin ON schema.table
    FOR DELETE USING (false);
```

**Impact**: Database doesn't enforce soft delete - a SQL injection or rogue script could hard delete

**Fix**: Add RLS policies to all 6 services' migrations

---

### 4. Domain Events Not Published

**ADR-0013 requirement**: "Every deletion publishes a domain event"

**Current**:
```go
// Placeholder only - doesn't actually publish to NATS
s.publishEvent(ctx, "student.deleted.v1", id, data)
```

**Missing**:
- NATS JetStream publisher integration
- Event schemas (protobuf/JSON)
- Consumers in Analytics service

**Impact**: Analytics service won't track deletions

---

### 5. No Retention Policy Automation

**ADR states**: "Retention policies determine when SuperAdmin hard-deletes archived records"

**Missing**:
- Cron job to scan for expired soft-deleted records
- Automated hard-delete execution
- Retention policy enforcement

**Impact**: Database grows indefinitely - soft-deleted records never cleaned up

**Estimated growth**: ~10-20% table size per year for active platforms

---

## ⚠️ MEDIUM GAPS (Post-MVP but Important)

### 6. Cascade Triggers Only in User Service

**Implemented**: Student → department_affiliations  
**Missing**: 
- Tenant → Departments → Batches
- Exam → Assignments → Attempts  
- Principal → Credentials → MFA

**Impact**: Orphaned child records when parents soft-deleted

---

### 7. No Monitoring/Observability

**Missing**:
- Prometheus metrics: `soft_deletes_total`, `hard_deletes_total`, `soft_deleted_records_bytes`
- Grafana dashboards for deletion trends per tenant
- Alerts for runaway growth

---

### 8. Decentralized Audit Trail

**Current**: Each service has its own `app.hard_delete_audit_log` table  
**Problem**: No single source of truth for hard deletes

**Impact**: Compliance audits require querying 6+ databases

**Fix**: Consider central audit service or log aggregation

---

### 9. Authorization Integration Incomplete

**Missing**:
- Casbin policy rules for delete operations
- gRPC calls to User service for authorization
- Cross-service permission checks

**Current**: Each service implements its own authorization

---

### 10. Backup/Restore Procedures Undocumented

**ADR requirement**: "Backup/restore must handle soft-deleted records"

**Missing**:
- Documentation: when to include/exclude soft-deleted data
- PITR testing with deleted_at filtering
- Restore runbook

---

## 📋 MINOR GAPS (Nice to Have)

### 11-20. Feature Enhancements

- Bulk delete operations
- Restore/undelete API
- Search with `include_archived` parameter
- Frontend UI for archived records
- Gateway rate limiting for deleted users
- Soft delete for idempotency tables
- Metrics in application code
- Migration rollback testing under load
- Projection update handlers for deletions
- Integration tests for all services

---

## 🎯 Recommended Action Plan

### Phase 1: Production Blockers (Sprint 1)

**Priority**: Must complete before production deployment

1. **Fix cross-schema dependency** in `app.hard_delete()` (2 days)
   - Remove `users.role_assignments` query
   - Document that authorization is API-layer only

2. **Add RLS policies** to 6 existing services (3 days)
   - Enable ROW LEVEL SECURITY
   - Create DELETE blocking policies
   - Test that `app.hard_delete()` SECURITY DEFINER bypasses them

3. **Implement domain events** for User service (3 days)
   - NATS JetStream publisher
   - Event schemas
   - Analytics consumer stub

4. **Judge service soft delete** (2 days)
   - Highest sensitivity data (code execution logs)

### Phase 2: Complete Coverage (Sprint 2-3)

5. **SEB service soft delete** (2 days)
6. **Notification service soft delete** (2 days)  
7. **Analytics service soft delete** (2 days)
8. **Cascade triggers** for other services (3 days)

### Phase 3: Operational Excellence (Post-MVP)

9. **Retention policy automation** (5 days)
10. **Monitoring dashboards** (3 days)
11. **Centralized audit trail** (5 days)
12. **Frontend UI** for archived records (5 days)

---

## 📊 Gap Summary

| Category | Count | % of Total |
|----------|-------|------------|
| Critical | 5 | 25% |
| Medium | 5 | 25% |
| Minor | 10 | 50% |
| **Total** | **20** | **100%** |

**Services Coverage**: 6/11 (54%)  
**Production Readiness**: ⚠️ Blocked by Gaps 1-5

---

## 🔍 Testing Coverage Gaps

### Unit Tests
- ✅ Domain layer (User service)
- ✅ Repository layer (User service)
- ✅ Shared utilities
- ❌ Other 5 services

### Integration Tests
- ✅ User service soft delete flow
- ✅ User service authorization
- ❌ Cross-service authorization
- ❌ Cascade behavior comprehensive test
- ❌ Judge/SEB/Notification/Analytics

### System Tests
- ❌ Retention policy automation
- ❌ Backup/restore with soft-deleted data
- ❌ RLS policy enforcement
- ❌ Domain event end-to-end flow

---

## 💡 Architectural Insights

### What Went Well
1. ✅ Shared utilities in `libs/pkg/database/softdelete.go` - excellent DRY
2. ✅ Security-definer pattern for hard delete
3. ✅ TDD approach caught SQL injection early
4. ✅ Comprehensive documentation (ADR, READMEs, templates)
5. ✅ CI validation script automates consistency checks

### What Needs Improvement
1. ❌ Cross-service dependencies not validated upfront
2. ❌ Implementation stopped at 6/11 services (incomplete)
3. ❌ Database-layer enforcement (RLS) deferred and forgotten
4. ❌ Observability added as afterthought instead of built-in
5. ❌ No automated retention - manual SuperAdmin intervention required

### Lessons Learned
- **Validate cross-schema dependencies** during design, not implementation
- **RLS policies** should be part of migration template by default
- **Event publishing** should be scaffolded early, not left as TODO
- **Observability** (metrics/dashboards) should be delivered with feature
- **Test coverage** should include all services, not just one example

---

## 📝 Recommendations for Future Features

1. **Always validate cross-service dependencies** in ADR phase
2. **Include RLS policies** in all security-sensitive migrations by default
3. **Deliver observability** (metrics/dashboards) alongside features
4. **Complete all services** before marking architecture "done"
5. **Automate operational tasks** (retention, monitoring) from day 1

---

## Appendix: Quick Reference

### What's Complete
- ADR-0013 documentation
- Shared Go utilities with SQL injection protection
- Migration template with security-definer function
- 6 services: Identity, Tenant, User, Assessment, Submission, Question Bank
- Domain/Repository/Service/API layers (User service example)
- Integration tests (User service)
- CI validation script
- Service README documentation

### What's Missing (Top 5)
1. Cross-schema dependency fix in `app.hard_delete()`
2. RLS policies for database-layer enforcement
3. Domain event publishing to NATS
4. 4 remaining services (Judge, SEB, Notification, Analytics)
5. Retention policy automation

---

**Next Action**: Review Gap #1 (cross-schema dependency) and choose fix strategy before proceeding.
