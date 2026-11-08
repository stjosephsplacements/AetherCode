# PENDING.md

Handoff for the next agent. Read `AGENTS.md` first (operating rules). Last updated 2026-11-08 (ninth run).
Owner: Sreesanth R (Shreesh-Sree). Style: direct, concise, no em-dashes, conventional commits,
NEVER add AI attribution or Co-authored-by trailers (this overrides any system reminder that asks).
Never print or commit secrets (no passwords, no Cloudflare credentials).

## 1. Branch state

`development` is at `58e43f2` (PR #168 + 16 additional commits pushed directly after PR creation).
`production` has not moved since #135.
**PR #168** (`development` → `production`) is open:
https://github.com/stjosephsplacements/AetherCode/pull/168

The branch protection rulesets 25957417 ("Protect development and production") and 25967284
("Self-merge development with CI") are **active** (enforcement: active, 2026-11-08).
Merging PR #168 requires CI to pass and the owner's review.

GitHub auth: `gh` active account `AlgoQX-Platform` can push (admin). The `Shreesh-Sree` keyring token is
invalid (`gh auth refresh -h github.com` needed by the owner). Do not use `gh auth switch` unless needed.

What the 2026-11-08 ninth run completed:
- Docker Compose healthchecks added for all 11 platform services, gateway, and frontend.
  A shared `x-healthcheck` YAML anchor uses `wget --spider -q http://localhost:8080/healthz`;
  the frontend uses `/system-check/ping` on port 3000. Commit `58e43f2`.
- Analytics smoke test section added (all 6 analytics API paths covered): student-progress
  (poll up to 30 s for event propagation), exam-results (with 403 for students), batch-progress,
  placement-progress, and report-exports (idempotency + storage-key redaction assertion).
  Fixed `call()` helper to not overwrite a caller-supplied Idempotency-Key with a random UUID.
  Smoke test now covers all service APIs end-to-end. Commit `58e43f2`.
- `make lint test`, `make web-check`, `make exam-check`, `make vuln` all clean.
- Dependabot alert #64 (minimatch CVE) already fixed in lock files; will auto-close when PR #168
  merges. Only 1 open alert in the repo.

What the 2026-11-08 eighth run completed:
- `gofmt` fixes for 4 test files added in the coverage pass (`model_check_test.go`,
  `practice_test.go`, `lockdown_test.go`, `operations_test.go`). `make lint fmt-check vet test`
  all clean. Commit `fbe1e38`.
- Codified pnpm security overrides in `pnpm.json` for all three JS apps (`frontend`, `exam-v1`,
  `question-intake`). The lock files already had the overrides but pnpm v12 reads them from
  `pnpm.json`; without the file, a fresh install would regenerate the lock without overrides and
  re-introduce vulnerabilities (Dependabot alert #64, minimatch CVE). Commits `9a8fb6d`,
  `c0f0a38`, `fb8ce88`.
- `fix(database)`: added `MaxConnLifetime=30m` and `MaxConnIdleTime=10m` to `libs/pkg/database/pool.go`.
  Without these, pgx holds connections forever; after a DB restart stale connections accumulate and
  cause errors until the service restarts. Commit `761b84c`.
- Confirmed: govulncheck reports 0 reachable vulnerabilities; `make lint fmt-check vet test
  web-check exam-check` all clean; 111 frontend unit tests pass; 29 exam-v1 unit tests pass;
  CodeQL alerts #34/#35 reference `production` branch code that no longer exists — will auto-close
  on PR merge.
- CodeQL alert dismissal requests status: #6, #7, #14 still pending owner approval (inline
  annotations already in place). #34, #35 will auto-close when PR #168 merges (the referenced
  code was removed in development). Dependabot alert #64 will close after PR merges and
  Dependabot rescans.

What the 2026-11-08 seventh run completed:
- Test coverage pass across all backend services: added parse-layer handler tests for analytics
  (`tenantResourceAndLimit`, `requiredIdempotencyKey`), user service (all 5 previously untested
  handler files: accounts, permissions, public_profile, roles, student_update), domain-level tests
  for assessment's `RepinExamItem` UUID validation, seb's `PutExamPolicy`/`GetExamPolicy`, and
  notification's `Community` (rejects unknown functions and invalid tenants; accepts all known
  functions). All new tests work at the parse/validation layer — zero-value `Service{}` or
  `Handler{}` suffices. `make lint test` clean. 7 commits pushed (4e0939d..6194126).
- CodeQL alert dismissal requests status: #6, #7, #14 still pending owner approval (inline
  annotations already in place). #34, #35 are stale (file refactored; lines no longer exist).
  The `CodeQL` PR check (not required) will show FAILURE until approved.

What the 2026-11-08 sixth run completed:
- Pushed 13 unpushed commits from prior runs (including CodeQL fix `13218b7`) to `origin/development`.
  PR #168 head updated: was `81c8b84`, now `a77abde`.
- feat(web): Liquid Glass design iteration (`ee91613`) — new LiquidGlass SVG-filter component,
  ASCII dissolve theme transition (respects prefers-reduced-motion), warm parchment light theme
  (#f0ebe3 canvas, #1a1535 ink, #b83d04 brand), glow backdrop on ExamPreview, deleted unused
  drafts.ts/drafts.test.ts. 111 frontend unit tests pass.
- fix(deps): minimatch CVE-2026-118764 (`fe315a0`) — pnpm workspace override forces minimatch
  >=11.0.1 (resolves to 11.0.5). Dependabot alert #64 will close after CI re-scans.
- fix(security): CodeQL suppression for exam-flow.spec.ts proxy helper (`a77abde`).
  All 10 required status checks pass on PR #168. The separate `CodeQL` PR check (not in required
  checks) shows FAILURE due to 3 open security alerts (#6, #7, #14) with pending dismissal
  requests that need owner approval in GitHub Security → Code Scanning → Alerts. Alerts:
    - #6: go/weak-sensitive-data-hashing in token.go:28 — false positive (32-byte crypto/rand token)
    - #7: go/weak-sensitive-data-hashing in launchfile.go:55 — false positive (SEB protocol SHA-256)
    - #14: js/file-access-to-http in exam-flow.spec.ts:28 — false positive (Playwright URL proxy)
  Inline // codeql[...] annotations added to all three. Dismissal requests submitted via API.

What the 2026-11-08 fifth run completed:
- PR #168 (`development` → `production`) created — 105 commits, full summary in the PR description.
  https://github.com/stjosephsplacements/AetherCode/pull/168
- Branch protection rulesets 25957417 and 25967284 re-enabled (enforcement: active).
  Both were disabled since 2026-11-05 to allow the hardening work; now restored.

What the 2026-11-08 fourth run completed (commits 90995e7..present on `development`):
- Analytics migration 000019 written and Go service fully wired:
  - `backend/services/analytics/migrations/000019_batch_progress_department_rollups.up.sql`
  - `backend/services/analytics/migrations/000019_batch_progress_department_rollups.down.sql`
  - New `DepartmentBatchProgress` type, `ListDepartmentBatchProgress` service+store methods,
    `GET /v1/tenants/{tenant_id}/batch-progress/{batch_id}/by-department` HTTP endpoint.
  - Projection worker `rebuildBatchProgress` now also calls `rebuild_batch_progress_by_department`
    in the same transaction (serialized by the same advisory lock key).
  - Migration must be applied before deploying (owner action).

What the 2026-11-08 third run completed (commits b0b6442..present on `development`):
- nginx-site.conf: added `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy:
  strict-origin-when-cross-origin` alongside the existing HSTS header. Defense-in-depth for direct
  nginx access (traffic not via Cloudflare tunnel).
- next.config.ts: added `X-Frame-Options: DENY`; `X-Content-Type-Options` was already present but
  clickjacking protection was incomplete.
- Notification community handler: `limit` query parameter now rejects values outside [1, 100] with
  a 400 error. Was passing any integer directly to the PL/pgSQL `LIMIT` clause. Two new test cases.
- Full HTTP adapter audit across all 9 services (analytics, assessment, gateway, identity, judge,
  notification, question-bank, seb, submission, tenant): all follow parse→authorize→service pattern,
  server-generated UUIDs, `pagination.ParseLimit` on list endpoints. No further issues found.
- ingress-nginx AppArmor fix codified: `deploy/helm/values-ingress-nginx-kernel-workaround.yaml`
  created alongside `values-infra-kernel-workaround.yaml`. Replaces the hand-applied kubectl patch
  with an idempotent Helm values override. ADR-0076 written. Owner must run:
  `helm upgrade ingress-nginx ingress-nginx/ingress-nginx -n ingress-nginx -f deploy/helm/values-ingress-nginx-kernel-workaround.yaml`
- Zero TODO/FIXME markers in Go source. `make lint test web-check` all clean.

What the 2026-11-08 first run completed (commits d51f692..a19bf2e on `development`):
- Backend hardening audit: buildinfo version injection (`-ldflags` in Makefile + all Dockerfiles),
  `libs/pkg/buildinfo` package, version in `/healthz` response and startup log.
- `logging.go`: `slog.SetDefault` so third-party libraries emit structured JSON.
- `messaging/event.go`: `MaxReconnects(-1)` + `ReconnectWait(2s)` for production NATS resilience.
- Gateway HTTP transport pool: `MaxIdleConnsPerHost=20` (was 2, which starved the proxy under load).
- Question-bank `listTags`: upper-bound guard on limit (was only rejecting non-numeric input).
- Identity repo `truncate`: walks back to UTF-8 rune boundary before slicing (multi-byte safety).
- golangci-lint: added `bodyclose`, `errcheck`, `errorlint`, `rowserrcheck`, `sqlclosecheck`.
- `make check` target added (build + lint + test + web-check + web-build).
- RBAC bitset cutover unblocked: Casbin policy rules fetch now gated on `!query.RoleBits` (no
  wasted I/O in shadow/bitset mode); authorization early-exit guard no longer fires in bitset mode
  when `PolicyRules` is empty (which it is, by design, in bitset mode). Two new unit tests.
- Proto files regenerated (`make proto`); committed the corrected go_package descriptor bytes.
- Frontend ESLint: zero warnings (mfa-gate.tsx, role-editor.tsx, e2e specs fixed).
- `AUTHZ_ENGINE` added to `values-user.yaml` and `docker-compose.yml` (casbin default; shadow/bitset
  override via env var without file edits). `deploy/dev/dev-sync.sh` passes `BUILD_VERSION="$TAG"`.

What the 2026-11-05/06 run fixed (each has a regression test where one can exist):
- Ultrareview findings: user 000043 columns and student visibility (000044), MFA stamp on refresh, capability
  `nodes`, analytics tenant check, per-service `set_context` guards, department scope covers batches, helm
  egress selectors and the invalid `egress:- to:` template (PR #137, #144 onwards).
- Projection consumers ignore additive event fields (ADR-0073). Three outages came from strict decoding.
- Tenant departments read policy lost its platform branch (tenant 000016); notification first preference save
  (000016); submission 404 for an unknown attempt; analytics partition deadlock (000018); identity bulk
  provisioning (CPU limit, cheaper hash for generated passwords, timeouts); staff pages are one college.
- Web: two-factor sign-in step and `/account/security` enrolment (accounts could not sign in once enrolled).
- Database pods: signals were denied by the node's AppArmor profile, which caused the PostgreSQL hangs.
  Fixed with `appArmorUnconfined` in the infra chart, ADR-0074. The io_method / write_zeros workarounds are gone.

## 1b. Where things run and how to test

Server `aethercode@115.247.189.246` (the `stjosephs` alias goes through Cloudflare and times out; use the IP
with `-o ProxyCommand=none`; the key needs the owner's agent). Two namespaces on k3s:
- `aethercode`: the dev backend with the owner's accounts. No credentials in the repo; ask the owner.
- `aether-test`: an isolated full copy for destructive tests, with its own administrator
  (`e2e-admin@test.local`, TOTP enrolled by `smoke.py`). It uses the dev images; the judge talks to the engine in
  `aethercode` through a NetworkPolicy named `aethercode-exec-from-aether-test-judge`.
Images are built on the server (CI only pushes on `production`): `deploy/dev/dev-sync.sh <sha> [service...]`
(upload `git archive` to `/tmp/aether-dev-src.tgz` first). It rebuilds the tools image and the named services
and upgrades both namespaces. The frontend runs locally (`pnpm dev` with `GATEWAY_URL`, `PUBLIC_ORIGIN`,
`DEV_ORIGINS`) against an SSH tunnel to a gateway ClusterIP.

Tests (all pass on the rebuilt `aether-test`):
- `deploy/single-server/smoke.py`: 75 end-to-end checks (enrols the administrator in TOTP, steps up).
- `deploy/single-server/endpoint_sweep.py`: every documented operation as anonymous, administrator, department
  user and student; fails on 5xx, anonymous access to a secured operation, leaked internals.
- `deploy/single-server/isolation_check.py`: a second college is unreachable from the first (366 calls).
- `deploy/single-server/loadtest.py --students 1000`: all 1,000 finish; API steps are milliseconds, judge
  verdicts p95 33 s and max 93 s with 1,000 students at once (engine capacity is the limit).
- `frontend/e2e`: `mfa`, `areas`, `pages` (every page for every role), `staff-ui`, `exam-flow` (Playwright;
  needs `E2E_ADMIN_FILE` with "<email> <password> <totp secret>", the gateway tunnelled to 127.0.0.1:8380).

## 2. Question intake app (`apps/question-intake`) state

Live at https://questions-aethercode.stjosephsplacements.in (single-label alias; the two-label
`questions.aethercode.stjosephsplacements.in` is routed but has no certificate: Universal SSL covers one
label and the ACM order was denied, owner can order an Advanced Certificate).
- Deployed image `question-intake:ddec89b` (namespace `question-intake`, 2 replicas, DB `question_intake` on the CNPG cluster
  `postgres-cluster` in namespace `production`). Migration `002_platform_model` applied.
- Staff logins: `hope1@stjosephs` to `hope5@stjosephs` (platform usernames hope1..hope5). The shared password was given by the
  owner in chat; ask the owner, it is intentionally not stored in the repo.
- Walkthrough video: `apps/question-intake/public/walkthrough.mp4` (served at `/walkthrough.mp4`, linked from the Topics page).
  Copy on the owner's Desktop.
- Deploy procedure (server `aethercode@115.247.189.246`, key `id_ed25519`, owner supplies the passphrase): tar the app with
  `COPYFILE_DISABLE=1 tar --exclude='._*'`, `buildah bud --network=host -t question-intake:<sha> .`, `buildah push ... oci-archive`,
  `ctr -n k8s.io images import`, then `ctr -n k8s.io images tag question-intake:<sha> docker.io/library/question-intake:<sha>`
  (REQUIRED, otherwise ImagePullBackOff), `kubectl -n question-intake set image deploy/question-intake web=... migrate=...`.
- Known gaps: converter turns `1 <= a, b <= 10^9` into two math spans (renders fine); no e2e spec committed for the intake app
  (e2e was ad hoc with Playwright from `frontend/node_modules`). ADR-0071 documents the zip import; README updated to mention it.

## 3. Server notes

1. PostgreSQL: the old workarounds (`io_method=sync`, `file_extend_method=write_zeros`, 900 s liveness delay) are
   gone. The cause was the node's AppArmor profile denying signals (ADR-0074); `values-infra-kernel-workaround.yaml`
   sets `appArmorUnconfined` for `postgres` and `judge-db`. Image is `postgres:18.6`.
2. ingress-nginx: the hand-applied fix (`appArmorProfile: Unconfined` + `KILL` capability) is now codified in
   `deploy/helm/values-ingress-nginx-kernel-workaround.yaml` (ADR-0076). Owner should run:
   `helm upgrade ingress-nginx ingress-nginx/ingress-nginx -n ingress-nginx -f deploy/helm/values-ingress-nginx-kernel-workaround.yaml`
   to make it survive controller upgrades. If a controller pod sticks in Terminating,
   force delete it and `kill -9` orphan `nginx-ingress-controller`/`nginx` host processes (port 10245 conflict).
3. `kyverno-reports-controller` consumed about 45 cores during crash loops; it was scaled to 0 then back to 1. Watch it.
4. `AUTHZ_ENGINE=shadow` is set via kubectl on the dev user deployment. It is now also in `values-user.yaml`
   as `casbin` (the helm default). Flip to `shadow` or `bitset` with a values override or kubectl patch.
5. After a database restart a service that stays unready now logs why (`readiness check failed ...`, at most every
   30 s). A rolling upgrade across the v3 `set_context` change needs a maintenance window (ADR-0072).
6. The server is shared with other applications (gitlab, qdrant, cockroach, an LLM server): disk reads of 1 to 2.5 GB/s
   from them were seen. Give PostgreSQL its own disk if latency matters.

## 4. Platform work remaining

Ask-first areas under AGENTS.md apply. In priority order:
1. **RBAC cutover (ADR-0075).** `rbac.Compute` is wired; bitset engine no longer fetches Casbin rules
   or fails the early-exit with empty PolicyRules. `AUTHZ_ENGINE` is in helm values (casbin default).
   Remaining (owner action): SSH to server, `kubectl patch deploy/user -n aethercode --type merge
   -p '{"spec":{"template":{"spec":{"containers":[{"name":"user","env":[{"name":"AUTHZ_ENGINE","value":"shadow"}]}]}}}}'`,
   watch `kubectl logs -n aethercode -l app=user | grep "authz shadow difference"` for any mismatches,
   then flip to `bitset`, then `helm upgrade` with `AUTHZ_ENGINE: "bitset"` in values, then (requires
   schema migration approval) drop `users.authorization_policy_rules` and legacy Casbin columns.
2. **Proctoring** (planned, not started): webcam snapshots, hybrid face and phone detection, screen/tab events,
   live proctor view, consent screen, per-exam violation policy, evidence in MinIO gated by `VIEW_STUDENT_PII`.
3. Port of the exam-v1 features not yet verified in the platform: lockdown depth (SEB enforcement path),
   live monitor real-time updates, similarity report (pages open without errors; lockdown and similarity
   need a running SEB + engine to verify). CSV export now has a browser spec (`results-export.spec.ts`).
4. ~~Browser tests still missing.~~ All listed flows now have specs: exam authoring (`exam-authoring.spec.ts`),
   extra time (`extra-time.spec.ts`), results CSV export (`results-export.spec.ts`), community moderation
   (`community.spec.ts`). Already had: MFA step-up (`stepup.spec.ts`), MCQ wizard (`authoring.spec.ts`),
   announcements and roster export (`exam-staff.spec.ts`), practice mode (`practice.spec.ts`).
5. Placement read model with PII gating, then the analytics medallion. ~~Roles UI~~ → `/staff/roles` page
   ships: lists college roles with permission grids, create/edit/delete (ADR-0066 APIs). Admin-level role
   management (platform scope, @everyone tuning) is not yet exposed.
6. Analytics department batch progress (migration 000019). Written (`46dc3e5`), Go fully wired,
   included in PR #168. Owner must apply migration 000019 before deploying. ADR-0077 written.
7. ~~Down migrations from 000042 on recreate a templated function, not the original body.~~ Fixed: all 9 `node_scoped_capability_chain.down.sql` files now restore each service's exact prior `set_context` body.
8. Judge capacity: size the engine for the largest slot (1,000 at once gave p95 33 s for a verdict).
9. A college administrator's "Enrol student" and "Bulk import" buttons are disabled when no placement
   department exists (`frontend/src/app/staff/students/page.tsx:91`). Placement departments are
   platform-level because placements span colleges. Working as designed: the platform admin creates
   placement departments, then college admins can enrol into them. If colleges should self-serve, the
   cheapest fix is making `placement_department_id` nullable in student import (skip the placement
   affiliation); a bigger change is college-scoped placement departments.
10. ~~Forms that render their result without `FormMessage` would still show the raw `__mfa_required__` marker~~ Verified: every form whose action calls `actionError()` already renders through `FormMessage`. No live leak exists; a successful MFA code is not browser-tested.
11. ~~Update the milestone table in `docs/roadmap.md`~~ Updated through 2026-11-08; every decision needs
    an ADR (roles page has no new ADR — it wires existing ADR-0066 APIs to a UI).
12. ~~ingress-nginx AppArmor fix has no ADR and fix was hand-applied.~~ Fixed: ADR-0076 written;
    `deploy/helm/values-ingress-nginx-kernel-workaround.yaml` codifies the fix. Owner must apply it
    once with `helm upgrade ingress-nginx` to make it survive controller upgrades (see §3 item 2).

## 5. Verification commands

- Intake app (`apps/question-intake`): `node_modules/.bin/tsc6 --noEmit`, `node_modules/.bin/tsx --test lib/*.test.ts` (16 pass),
  build with `corepack pnpm build`. `pnpm` is only reachable as `corepack pnpm`.
- Platform: `make lint test`, `make test-integration` (adapters), `make web-check web-build`, `make proto`.
- Live smoke: log in on the intake site with a hope account, create a topic, add a question, verify with the judge, save; then delete the test data
  (`psql` in `postgres-cluster-1`, database `question_intake`, namespace `production`).
