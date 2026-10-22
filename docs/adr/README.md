# Architecture decision records

Each decision is a numbered file; new ones start from [the template](0000-template.md). Superseded decisions stay, with their status updated.

| ADR | Decision |
|---|---|
| [0001](0001-monorepo-hexagonal.md) | Go workspace monorepo with hexagonal services |
| [0002](0002-database-per-service-rls.md) | Database per service with local row-level security |
| [0003](0003-nats-outbox.md) | NATS JetStream with transactional outbox and inbox deduplication |
| [0004](0004-central-casbin-authz.md) | Central typed Casbin authorization decisions |
| [0005](0005-platform-postgres-ha.md) | Three-node India-hosted PostgreSQL HA topology |
| [0006](0006-signed-authz-context.md) | Signed authorization context for local RLS |
| [0007](0007-india-residency-retention.md) | India-only residency and tenant-configurable retention |
| [0008](0008-judge-persistence-boundary.md) | Isolate Judge wrapper persistence from the Judge0 engine |
| [0009](0009-judge0-gvisor-compatibility-gate.md) | Block Judge0 promotion until gVisor isolation is proven |
| [0010](0010-judge-control-plane-ha.md) | Use independent HA control-plane and queue clusters for Judge |
| [0011](0011-assignment-revocation-cancellation.md) | Assignment revocation cancels nonterminal candidate work |
| [0012](0012-gateway-seb-enforcement-boundary.md) | Fail-closed Gateway and SEB enforcement boundary |
| [0013](0013-soft-delete-architecture.md) | Soft Delete Architecture |
| [0014](0014-evaluation-bundle-format.md) | Evaluation bundle JSON format and per-test-case object encryption |
| [0015](0015-judge-per-unit-result-visibility.md) | Carry per-unit Judge results on the completion ingress, not the platform event |
| [0016](0016-lean-exam-app-for-first-launch.md) | Lean exam app for the first graded launch |
| [0017](0017-go-platform-as-the-only-backend.md) | The Go platform is the only backend |
| [0018](0018-piston-engine-for-cgroup-v2-hosts.md) | Piston engine for cgroup v2 hosts |
| [0019](0019-administrator-provisioned-accounts.md) | Administrator-provisioned accounts |
| [0020](0020-staff-author-the-global-question-bank.md) | College staff author the global question bank |
| [0021](0021-candidate-runs-return-sample-output.md) | Candidate runs return sample-test output |
| [0022](0022-exam-lockdown-with-safe-exam-browser.md) | Exam lockdown with Safe Exam Browser |
| [0023](0023-candidate-paper-and-self-endpoints.md) | Candidate paper and self endpoints |
| [0024](0024-web-frontend-sessions-and-proxy.md) | Web frontend sessions and gateway proxy |
| [0025](0025-per-question-submit-and-custom-input.md) | Per-question submit, best score and custom input |
| [0026](0026-placement-department-assignments.md) | Exams assigned to a placement department |
| [0027](0027-exam-day-operations.md) | Exam-day operations: release, extra time, announcements, live monitor |
| [0028](0028-aethercode-execution-engine.md) | The AetherCode Execution Engine runs all platform code |
| [0029](0029-staff-attempt-review.md) | Staff review of an attempt |
| [0030](0030-lab-networks.md) | Lab networks on the exam lockdown policy |
| [0031](0031-similarity-report.md) | Code similarity report |
| [0032](0032-question-export-import.md) | Question export and import |
| [0033](0033-model-solution-checks.md) | Model-solution checks and per-client Judge completions |
| [0034](0034-question-pools.md) | Question pools |
| [0035](0035-multiple-choice-questions.md) | Multiple-choice questions |
| [0036](0036-replace-issued-passwords.md) | Users replace passwords staff issue |
| [0037](0037-exam-integrity.md) | Exam integrity: fullscreen, paste guard and flags |
| [0038](0038-released-test-verdicts.md) | Released results show test verdicts |
| [0039](0039-regrade.md) | Regrade with a corrected question version |
| [0040](0040-move-assignment-window.md) | Moving an assignment's window after publication |
| [0041](0041-practice-problems.md) | Practice problems and the question audience |
| [0042](0042-single-sign-on.md) | Single sign-on through the college's ZITADEL |
| [0043](0043-staff-operations-views.md) | Staff operations views: analytics, grading queue, audit log, roles |
| [0044](0044-question-review.md) | Question review before use |
| [0045](0045-college-branding.md) | College branding as deployment configuration |
| [0046](0046-staff-try-an-exam.md) | Staff try an exam as a student |
| [0047](0047-publish-needs-a-passing-model-solution.md) | A coding question is published only after a model solution passes |
| [0048](0048-community-content.md) | Community content in the notification service |
| [0049](0049-kubernetes-deployment.md) | Kubernetes deployment |
