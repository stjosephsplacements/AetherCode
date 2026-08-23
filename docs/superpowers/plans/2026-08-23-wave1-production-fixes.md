# Wave 1 Production Readiness Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close seven independent, well-scoped production-readiness gaps found in a full-backend audit (2026-08-23): CI never runs the one integration-test suite that exists, a test helper self-skips permanently, five sensitive endpoints have no abuse protection, judge's soft/hard-delete capability is unreachable from any transport, exam authors cannot remove a section or item once added, six of eleven services have zero tenant-isolation test coverage, and there is no tooling to operationalize the HMAC key rotation the schema already supports.

**Architecture:** Every task is independent and touches a different subsystem; no task depends on another task's output. Every task mirrors a pattern that already exists and works elsewhere in this repo — the notification retention worker's role-scoped migration shape, the register endpoint's token-bucket limiter, the `add_exam_section` stored-procedure shape, the `user` service's Testcontainers RLS test, and the bootstrap CLI's connect-and-call-a-function shape. Nothing here introduces a new pattern.

**Tech Stack:** Go 1.26.7, pgx/v5, PostgreSQL with FORCE RLS, golang-migrate, gRPC/protobuf via buf, Testcontainers.

**Spec:** No separate spec document — this plan implements the seven-item "Wave 1" scope approved in chat on 2026-08-23, following a full-backend gap audit. The audit findings and approved item list are the spec of record for this plan.

## Global Constraints

- Go module path for shared code is `github.com/aethercode/aethercode/libs/pkg`.
- No placeholders, stub bodies, `TODO` comments, or fake data may be committed.
- Every new SQL function is `REVOKE ALL ... FROM PUBLIC` then granted only to its intended role.
- Every migration ships a paired `.down.sql`. `make test-migrations` runs fresh-apply, rollback, and reapply.
- Tests are table-driven and call `t.Parallel()`.
- Commits use Conventional Commits, one commit per task (or per logical sub-step within Task 6).
- Cross-service logic goes in `libs/pkg/*`, never copy-pasted between services.
- **Environment (mandatory on every Go command):**
  `export PATH="$HOME/.local/go/bin:$HOME/go/bin:$PATH"`,
  `export TMPDIR="$HOME/.cache/aethercode-tmp"`, `export GOTMPDIR="$HOME/.cache/aethercode-tmp"`.
  `/tmp` is a 437M partition the Go linker exhausts; "no space left on device" means TMPDIR is unset.

---

## Task 1: Wire `make test-integration` into CI

**Files:**
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `make test-integration` (already defined in `Makefile:35-36` as `@for module in $(MODULES); do (cd $$module && go test -tags=integration ./...); done`)
- Produces: nothing consumed by later tasks

- [ ] **Step 1: Read the current workflow in full**

Run: `cat .github/workflows/ci.yml`

Note the exact shape of the `build-test` job (lines 12-24):
```yaml
  build-test:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v6.0.2
      - uses: actions/setup-go@v6.4.0
        with:
          go-version: '1.26.7'
          cache-dependency-path: |
            libs/pkg/go.sum
            services/*/go.sum
      - run: go work sync
      - run: make build
      - run: make test
```

- [ ] **Step 2: Add a new `integration-test` job**

Insert a new job after `build-test`, before `migration-verification`. GitHub's `ubuntu-24.04` runners ship Docker preinstalled, which is all Testcontainers needs — no extra service containers or docker-in-docker setup required.

```yaml
  integration-test:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v6.0.2
      - uses: actions/setup-go@v6.4.0
        with:
          go-version: '1.26.7'
          cache-dependency-path: |
            libs/pkg/go.sum
            services/*/go.sum
      - run: go work sync
      - run: make test-integration
```

- [ ] **Step 3: Validate YAML syntax**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))" && echo VALID`
Expected: `VALID`. (No `act`/local GitHub Actions runner is required — this validates the file parses; the job's actual behavior is verified by the next step.)

- [ ] **Step 4: Verify the target this job runs actually passes locally**

Run: `make test-integration` from the repo root, after `make dev-up` if a local Postgres isn't already listening on the port Testcontainers needs (Testcontainers starts its own ephemeral container, so `dev-up` is not required — just Docker itself running).
Expected: PASS (this exercises the existing `user` service Testcontainers suite; it is not new work, just confirmation the CI job will succeed).

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: run make test-integration in its own job"
```

---

## Task 2: Fix the self-skipping test authorizer

**Files:**
- Modify: `services/user/test/integration/soft_delete_test.go`

**Interfaces:**
- Consumes: `libs/pkg/authz.NewClient(client authz.AuthorizationRPC) (*authz.Client, error)` and `libs/pkg/httpauth.New(client *authz.Client, targetService string) (*httpauth.Authorizer, error)`
- Produces: a real `*httpauth.Authorizer` for `createTestAuthorizer`, consumed at `soft_delete_test.go:45,136` via `httpadapter.NewHandler("user-test", service, readinessFunc, authorizer)`

- [ ] **Step 1: Read the full test file and the authorizer chain**

Run:
```bash
sed -n '1,60p;260,320p' services/user/test/integration/soft_delete_test.go
cat libs/pkg/httpauth/authorizer.go
cat libs/pkg/authz/client.go
sed -n '1,40p' libs/pkg/authz/client_test.go
```

The current stub (`soft_delete_test.go:277-286`):
```go
func createTestAuthorizer(t *testing.T) *httpauth.Authorizer {
	t.Skip("Test authorizer not implemented yet - requires full authorization infrastructure")
	return nil
}
```

`httpauth.Authorizer` (`libs/pkg/httpauth/authorizer.go:20-31`) wraps a `*authz.Client`:
```go
type Authorizer struct {
	client        *centralauthz.Client
	targetService string
}

func New(client *centralauthz.Client, targetService string) (*Authorizer, error) {
	if client == nil || strings.TrimSpace(targetService) == "" {
		return nil, fmt.Errorf("central authorization client and target service are required")
	}
	return &Authorizer{client: client, targetService: strings.TrimSpace(targetService)}, nil
}
```

`authz.Client` (`libs/pkg/authz/client.go:50-59`) needs anything satisfying:
```go
type AuthorizationRPC interface {
	Authorize(context.Context, *authzv1.AuthorizeRequest, ...grpc.CallOption) (*authzv1.AuthorizeResponse, error)
}
```

`libs/pkg/authz/client_test.go:14-22` already has exactly this shape of fake, but it is unexported and lives in `package authz` — it cannot be imported from `services/user/test/integration` (package `integration_test`). Read it as the reference shape, then write an equivalent unexported type local to `soft_delete_test.go`.

- [ ] **Step 2: Understand what `AuthorizeHTTP` needs from the request**

`Authorizer.AuthorizeHTTP` reads the principal from the request via a Bearer token (`libs/pkg/httpauth/authorizer.go` — read the `AuthorizeHTTP` and `principalFromRequest` methods in full, they call `httpx.BearerToken` and `authn.UnverifiedSubject`). This means whatever request the integration test's HTTP calls send must carry a `Bearer` token in the `Authorization` header, not just context values. Read the existing `injectAuthContext` helper (`soft_delete_test.go:288-301`) and every place it's called — it currently injects raw context values (`"actor_id"`, `"tenant_id"`, `"actor_roles"`), which is **disconnected** from how the real `Authorizer` extracts identity. Trace how the test currently builds its HTTP requests (look for `httptest.NewRequest` calls in the same file) and determine whether a token needs to be attached there instead. If `authn.UnverifiedSubject` just base64-decodes a JWT-shaped payload without signature verification (check `libs/pkg/authn` for its implementation), construct a minimal unsigned token carrying the test's `actorID`/`tenantID` and set it as the Bearer token on each test request — do not weaken `authn.UnverifiedSubject` itself, only supply it a well-formed unverified token.

- [ ] **Step 3: Write the fake AuthorizationRPC and real authorizer construction**

In `soft_delete_test.go`, add (package-level, alongside the existing test helpers):

```go
type fakeAuthorizationRPC struct {
	response *authzv1.AuthorizeResponse
}

func (rpc *fakeAuthorizationRPC) Authorize(
	_ context.Context, request *authzv1.AuthorizeRequest, _ ...grpc.CallOption,
) (*authzv1.AuthorizeResponse, error) {
	return rpc.response, nil
}
```

Replace `createTestAuthorizer` so it builds a real `*httpauth.Authorizer` backed by this fake, configured to always allow, with a `DatabaseCapability` that is a validly-encoded capability (mirror how `libs/pkg/authz/client_test.go`'s `TestClientDecodesFreshAllowedCapability` builds one via `ParseKeyring` + `Keyring.Issue` + `Capability.Encode()` — the integration test needs its own keyring with a fixed test key, matching whatever audience/key_id the seeded `authz.context_keys` row in the test database uses, so the returned capability's signature is valid if anything downstream re-verifies it. If the code path under test never re-verifies the capability signature server-side within this test's scope, a syntactically valid but not necessarily re-verifiable capability is sufficient — confirm which is true by reading how `decision.Capability` is used after `AuthorizeHTTP` returns, in the handler code the test exercises).

The new `createTestAuthorizer` must not call `t.Skip` and must return a non-nil, working `*httpauth.Authorizer`.

- [ ] **Step 4: Remove the dead `injectAuthContext` path if it's superseded**

If Step 2's investigation shows `injectAuthContext` is no longer how the test authenticates requests (because real `AuthorizeHTTP` needs a Bearer token instead), update every call site to attach the Bearer token approach instead. Do not leave both an unused old helper and a new one — delete `injectAuthContext` if it becomes dead code, or fold the token-attachment logic into it if the name still fits.

- [ ] **Step 5: Run the previously-skipped tests**

Run: `cd services/user && go test -tags=integration ./test/integration/... -v -run TestSoftDelete` (adjust the `-run` pattern to match whatever test names call `createTestAuthorizer` — find them with `grep -n "createTestAuthorizer" services/user/test/integration/soft_delete_test.go`).
Expected: PASS, and no `--- SKIP` lines referencing "Test authorizer not implemented".

- [ ] **Step 6: Full verification and commit**

```bash
cd services/user && go build ./... && go vet ./...
cd /home/shreesh/Documents/AlgoQX && make fmt-check
git add services/user/test/integration/soft_delete_test.go
git commit -m "fix: implement real test authorizer, stop skipping soft-delete integration tests"
```

---

## Task 3: Shared rate limiter + apply to login, password reset, submission, judge

**Files:**
- Create: `libs/pkg/ratelimit/limiter.go`
- Create: `libs/pkg/ratelimit/limiter_test.go`
- Delete: `services/gateway/internal/edge/limiter.go`, `services/gateway/internal/edge/limiter_test.go`
- Delete: `services/identity/internal/adapters/http/limiter.go`
- Modify: `services/gateway/internal/edge/handler.go`, `services/gateway/internal/edge/handler_test.go`, `services/gateway/cmd/server/main.go`
- Modify: `services/identity/internal/adapters/http/handler.go`, `services/identity/internal/adapters/http/handler_test.go`, `services/identity/cmd/server/main.go`
- Modify: `services/submission/internal/adapters/http/handler.go`, `services/submission/cmd/server/main.go`
- Modify: `services/judge/internal/adapters/grpc/server.go`, `services/judge/cmd/server/main.go`

**Interfaces:**
- Produces: `ratelimit.Config{Capacity, RefillPerSecond float64; MaxEntries int; IdleTTL time.Duration}`, `ratelimit.New(config) (*ratelimit.Limiter, error)`, `(*ratelimit.Limiter).Allow(key string, now time.Time) bool`

- [ ] **Step 1: Read both existing implementations to confirm they're identical**

```bash
cat services/gateway/internal/edge/limiter.go
cat services/identity/internal/adapters/http/limiter.go
```

They are logically identical (`Config`/`RateLimitConfig`/`RegisterLimiterConfig` all have `Capacity float64, RefillPerSecond float64, MaxEntries int, IdleTTL time.Duration`; the bucket struct, `New`, `Allow`, `refill`, `evictIdle`, `evictOldest` methods are all the same token-bucket logic). Confirm this yourself by diffing them:

```bash
diff <(sed 's/RegisterLimiter/Limiter/g; s/RateLimitConfig/Config/g; s/RegisterLimiterConfig/Config/g; s/bucket/tokenBucket/g' services/identity/internal/adapters/http/limiter.go) services/gateway/internal/edge/limiter.go
```

- [ ] **Step 2: Write the failing test for the extracted package**

Create `libs/pkg/ratelimit/limiter_test.go`. Copy the test cases from whichever of the two existing `*_test.go` files is more complete (read both: `services/gateway/internal/edge/limiter_test.go` and check whether `services/identity/internal/adapters/http/handler_test.go` has limiter-specific unit tests beyond handler-level tests), adapted to `package ratelimit`, testing `New`, `Allow` (capacity, refill-over-time, `MaxEntries` eviction, `IdleTTL` eviction), using `t.Parallel()` throughout.

- [ ] **Step 3: Run to verify it fails**

Run: `cd libs/pkg && go test ./ratelimit/... -v`
Expected: FAIL — package does not exist yet.

- [ ] **Step 4: Create `libs/pkg/ratelimit/limiter.go`**

Move the logic from `services/gateway/internal/edge/limiter.go` verbatim into `package ratelimit`, renaming: `RateLimitConfig` → `Config`, `Limiter` stays `Limiter`, `NewLimiter` → `New`, `tokenBucket` stays `tokenBucket`. Preserve every comment and the exact validation/refill/eviction logic unchanged — this is a pure extraction, not a rewrite.

- [ ] **Step 5: Run to verify it passes**

Run: `cd libs/pkg && go test ./ratelimit/... -v`
Expected: PASS.

- [ ] **Step 6: Migrate gateway to the shared package**

Delete `services/gateway/internal/edge/limiter.go` and `services/gateway/internal/edge/limiter_test.go`. In `services/gateway/internal/edge/handler.go` and `services/gateway/cmd/server/main.go`, replace every `edge.Limiter`/`edge.NewLimiter`/`edge.RateLimitConfig` reference with `ratelimit.Limiter`/`ratelimit.New`/`ratelimit.Config`, importing `"github.com/aethercode/aethercode/libs/pkg/ratelimit"`. Update `services/gateway/internal/edge/handler_test.go` the same way. The call site at `handler.go:212` (`handler.limiter.Allow(limitKey, handler.now())`) and the construction at `cmd/server/main.go:51` change only their type names, not their logic.

- [ ] **Step 7: Migrate identity's register limiter to the shared package**

Delete `services/identity/internal/adapters/http/limiter.go`. In `services/identity/internal/adapters/http/handler.go`, change the `registerLimiter *RegisterLimiter` field to `registerLimiter *ratelimit.Limiter`. In `services/identity/cmd/server/main.go:189-194`, change `httpadapter.NewRegisterLimiter(httpadapter.RegisterLimiterConfig{...})` to `ratelimit.New(ratelimit.Config{...})` with the same field values (`Capacity: float64(runtime.RegisterBurst)`, `RefillPerSecond: float64(runtime.RegisterRate) / 3600.0`, `MaxEntries: 50000`, `IdleTTL: 2 * time.Hour`). Update `services/identity/internal/adapters/http/handler_test.go`'s three call sites (`NewRegisterLimiter` at lines 149, 196, 235) to the new type/constructor.

- [ ] **Step 8: Build and test after the extraction, before adding new limiters**

```bash
cd libs/pkg && go build ./... && go test ./...
cd /home/shreesh/Documents/AlgoQX && make build && make test
```
Expected: all pass — this checkpoint proves the extraction alone introduced no behavior change, before new limiter instances are added.

- [ ] **Step 9: Find how `RegisterBurst`/`RegisterRate` are loaded from environment**

Run: `grep -rn "RegisterBurst\|RegisterRate" services/identity/internal/` to find the runtime config loader (likely `services/identity/internal/adapters/http/runtime.go` or similar, look for `IDENTITY_REGISTER_BURST`/`IDENTITY_REGISTER_RATE` env var names). Read that loader function in full — the new login and password-reset limiters mirror its exact validation and env-var-naming convention.

- [ ] **Step 10: Add login and password-reset limiters to identity**

In the runtime config loader found in Step 9, add three more burst/rate pairs following the exact same env-var-naming and validation pattern: `IDENTITY_LOGIN_BURST`/`IDENTITY_LOGIN_RATE`, `IDENTITY_PASSWORD_RESET_BURST`/`IDENTITY_PASSWORD_RESET_RATE` (shared by both `POST /v1/auth/password-reset` and `/password-reset/complete` — password reset is one abuse surface, not two independent budgets). In `services/identity/cmd/server/main.go`, construct `loginLimiter` and `passwordResetLimiter` via `ratelimit.New` the same way `registerLimiter` is constructed, and pass both into `httpadapter.NewHandler(...)` (add them as new parameters, following the existing `registerLimiter *ratelimit.Limiter` parameter's nil-means-disabled convention documented at `handler.go:61`).

In `services/identity/internal/adapters/http/handler.go`: add `loginLimiter *ratelimit.Limiter` and `passwordResetLimiter *ratelimit.Limiter` fields to `Handler`, threaded through `NewHandler`'s signature. In the `login` handler (currently `handler.go:157-182`, no rate check at all), add the same guard shape used by `register` (`handler.go:105-112` — `if handler.registerLimiter != nil { if !handler.registerLimiter.Allow(ip, time.Now().UTC()) { ...write 429... } }`), keyed by `clientIP(request)`. Add the identical guard to both `requestPasswordReset` (`handler.go:256-267`) and `resetPassword` (`handler.go:287-298`), both using `handler.passwordResetLimiter`.

- [ ] **Step 11: Add and run identity handler tests for the new limiters**

Add test cases to `services/identity/internal/adapters/http/handler_test.go` mirroring the existing register-limiter test cases (search for the register limiter test, likely named something like `TestRegisterRespectsRateLimit`) — one for login, one for password-reset, each asserting a 429 status once the bucket is exhausted and asserting a nil limiter disables the check (matching the existing register test's coverage).

Run: `cd services/identity && go test ./... -v`
Expected: PASS, including the new tests.

- [ ] **Step 12: Add a limiter to submission's attempt-creation endpoint**

Read `services/submission/internal/adapters/http/handler.go` in full around `startAttempt` (route registered at line 29: `POST /v1/tenants/{tenant_id}/attempts`, handler at lines 44-84) and `services/submission/cmd/server/main.go` to see how the `Handler` is constructed. Following the same pattern as Step 10 (new `Handler` field, new constructor parameter, `ratelimit.New` built in `main.go` from a `SUBMISSION_START_ATTEMPT_BURST`/`SUBMISSION_START_ATTEMPT_RATE` env-driven config — check whether submission already has a runtime-config loader to extend or whether one needs to be created following identity's shape), key the limiter on `httpx.ParseUUIDPathValue(request, "candidate_id")`-derived candidate identity if available in the request path, otherwise on client IP (read the full handler to determine what identity is available before the service call — do not weaken tenant isolation by keying on tenant_id alone, since that would let one candidate exhaust the whole tenant's budget).

- [ ] **Step 13: Add and run submission handler tests**

Add a test case to `services/submission/internal/adapters/http/handler_test.go` for the new limiter, mirroring identity's Step 11 tests structurally.

Run: `cd services/submission && go test ./... -v`
Expected: PASS.

- [ ] **Step 14: Add a limiter to judge's SubmitExecution RPC**

Read `services/judge/internal/adapters/grpc/server.go` in full (the `SubmitExecution` method, lines 29-63, and the `Server` struct at lines 18-21) and `services/judge/cmd/server/main.go` to see how `grpcadapter.NewServer(judgeService)` is constructed (main.go:133-134). Add a `limiter *ratelimit.Limiter` field to `Server`, a new `NewServer(service *app.Service, limiter *ratelimit.Limiter) *Server` parameter (nil-means-disabled, matching the HTTP services' convention), and a guard at the top of `SubmitExecution` keyed on `request.GetTenantFairnessKey()` (this field already exists on `SubmitExecutionRequest` specifically to prevent one tenant from starving others — read its doc comment/usage elsewhere in `services/judge` to confirm this is the correct dispatch-fairness key before using it) — return `status.Error(codes.ResourceExhausted, "submission rate exceeded")` when the limiter rejects. Build the limiter in `main.go` from a `JUDGE_SUBMIT_BURST`/`JUDGE_SUBMIT_RATE` env-driven config, following the same loader shape as the other services.

- [ ] **Step 15: Add and run judge server tests**

Add a test case to `services/judge/internal/adapters/grpc/server_test.go` (read it first to confirm the existing test structure — table-driven gRPC handler tests) asserting a `ResourceExhausted` status once the limiter's bucket is exhausted, and that a nil limiter disables the check.

Run: `cd services/judge && go test ./... -v`
Expected: PASS.

- [ ] **Step 16: Full verification and commit**

```bash
cd /home/shreesh/Documents/AlgoQX && make build && make test && make vet && make fmt-check && make lint
git add libs/pkg/ratelimit/ services/gateway/ services/identity/ services/submission/ services/judge/
git commit -m "feat: extract shared rate limiter, apply to login, password reset, submission, and judge dispatch"
```

Update `services/identity/README.md`, `services/submission/README.md`, and `services/judge/README.md` to document the new environment variables and endpoints protected, in the same commit.

---

## Task 4: Judge gRPC delete RPCs

**Files:**
- Modify: `libs/proto/proto/aethercode/judge/v1/judge.proto`
- Modify: `services/judge/internal/adapters/grpc/server.go`
- Modify: `services/judge/internal/adapters/grpc/server_test.go`

**Interfaces:**
- Consumes: `(*app.Service).DeleteExecutionJob(ctx, app.DeleteExecutionJob) error` and `(*app.Service).HardDeleteExecutionJob(ctx, app.DeleteExecutionJob) error` (`services/judge/internal/app/service.go:306-332`), where `app.DeleteExecutionJob` is `struct { ID, ActorID, Reason string }`
- Produces: `JudgeService.DeleteExecutionJob` and `JudgeService.HardDeleteExecutionJob` RPCs

- [ ] **Step 1: Read the proto and the closest-shaped existing RPC**

```bash
cat libs/proto/proto/aethercode/judge/v1/judge.proto
sed -n '108,126p' services/judge/internal/adapters/grpc/server.go
sed -n '1,30p' services/judge/internal/adapters/grpc/server.go
```

`AcknowledgeCompletion` (`server.go:108-126`) is the template — it takes a request, validates non-nil, maps fields into an `app.` command struct, calls the service method, maps errors via `toStatusError`, returns an empty/simple response.

- [ ] **Step 2: Add the two RPCs and their messages to the proto**

Edit `libs/proto/proto/aethercode/judge/v1/judge.proto`. Add to the `service JudgeService` block:

```protobuf
  rpc DeleteExecutionJob(DeleteExecutionJobRequest) returns (DeleteExecutionJobResponse);
  rpc HardDeleteExecutionJob(DeleteExecutionJobRequest) returns (DeleteExecutionJobResponse);
```

Add new messages (place near `AcknowledgeCompletionRequest`/`Response` for locality):

```protobuf
message DeleteExecutionJobRequest {
  string id = 1;
  string actor_id = 2;
  string reason = 3;
}

message DeleteExecutionJobResponse {}
```

Both RPCs share one request/response shape since `app.DeleteExecutionJob{ID, ActorID, Reason}` is identical for both soft and hard delete — only the app-layer method called differs.

- [ ] **Step 3: Regenerate the Go bindings**

Run: `make proto` (defined at `Makefile:42-44` as `cd libs/proto && buf lint && buf generate`).
Expected: succeeds, and `libs/proto/gen/go/aethercode/judge/v1/*.go` now contains `DeleteExecutionJobRequest`, `DeleteExecutionJobResponse`, and the two new RPC method stubs on `JudgeServiceServer`/`JudgeServiceClient`.

If `buf lint` fails on the new messages/RPC (e.g. naming convention lint rules), fix the proto to satisfy the linter rather than suppressing the lint rule.

- [ ] **Step 4: Write the failing server test**

Add to `services/judge/internal/adapters/grpc/server_test.go` (read the file first to match its existing table-driven fake-service pattern — likely a `fakeService` or similar implementing whatever interface `Server` depends on):

```go
func TestServerDeleteExecutionJob(t *testing.T) {
	t.Parallel()
	// mirror the existing AcknowledgeCompletion test's fake-service wiring;
	// assert the request maps to app.DeleteExecutionJob{ID, ActorID, Reason}
	// and that a service error becomes the expected gRPC status code via toStatusError.
}

func TestServerHardDeleteExecutionJob(t *testing.T) {
	t.Parallel()
	// same shape, asserting the HardDeleteExecutionJob app method is called instead.
}
```

Write both tests with real assertions (not placeholder bodies) once Step 1's read of the existing test file shows the exact fake/mock shape to reuse — do not invent a different test double style than what the file already uses.

- [ ] **Step 5: Run to verify failure**

Run: `cd services/judge && go test ./internal/adapters/grpc/... -v -run TestServerDeleteExecutionJob`
Expected: FAIL — `Server` has no `DeleteExecutionJob` method yet.

- [ ] **Step 6: Implement the two RPC methods**

In `services/judge/internal/adapters/grpc/server.go`, add:

```go
func (server *Server) DeleteExecutionJob(
	contextValue context.Context,
	request *judgev1.DeleteExecutionJobRequest,
) (*judgev1.DeleteExecutionJobResponse, error) {
	if request == nil {
		return nil, status.Error(codes.InvalidArgument, "delete request is required")
	}
	if err := server.service.DeleteExecutionJob(contextValue, app.DeleteExecutionJob{
		ID:      request.GetId(),
		ActorID: request.GetActorId(),
		Reason:  request.GetReason(),
	}); err != nil {
		return nil, toStatusError(err)
	}
	return &judgev1.DeleteExecutionJobResponse{}, nil
}

func (server *Server) HardDeleteExecutionJob(
	contextValue context.Context,
	request *judgev1.DeleteExecutionJobRequest,
) (*judgev1.DeleteExecutionJobResponse, error) {
	if request == nil {
		return nil, status.Error(codes.InvalidArgument, "delete request is required")
	}
	if err := server.service.HardDeleteExecutionJob(contextValue, app.DeleteExecutionJob{
		ID:      request.GetId(),
		ActorID: request.GetActorId(),
		Reason:  request.GetReason(),
	}); err != nil {
		return nil, toStatusError(err)
	}
	return &judgev1.DeleteExecutionJobResponse{}, nil
}
```

- [ ] **Step 7: Run to verify tests pass**

Run: `cd services/judge && go test ./... -v`
Expected: PASS.

- [ ] **Step 8: Full verification and commit**

```bash
cd /home/shreesh/Documents/AlgoQX && make build && make test && make vet && make fmt-check && make lint
git add libs/proto/ services/judge/internal/adapters/grpc/
git commit -m "feat: expose judge's soft/hard delete execution job RPCs"
```

Update `services/judge/README.md`'s API surface section to list the two new RPCs.

---

## Task 5: Exam section/item removal

**Files:**
- Create: `services/assessment/migrations/000017_remove_exam_section_item.up.sql`
- Create: `services/assessment/migrations/000017_remove_exam_section_item.down.sql`
- Modify: `services/assessment/internal/app/service.go`
- Modify: `services/assessment/internal/adapters/repo/postgres.go`
- Modify: `services/assessment/internal/adapters/http/handler.go`
- Modify: `services/assessment/internal/adapters/http/handler_test.go`

**Interfaces:**
- Consumes: nothing from other sub-projects
- Produces: `assessment.remove_exam_section(p_id uuid, p_tenant_id uuid, p_exam_version_id uuid, p_expected_content_version bigint) RETURNS void`, `assessment.remove_exam_item(p_id uuid, p_tenant_id uuid, p_exam_version_id uuid, p_expected_content_version bigint) RETURNS void`, `Service.RemoveExamSection`/`RemoveExamItem`, `DELETE /v1/tenants/{tenant_id}/exam-versions/{exam_version_id}/sections/{section_id}` and `.../items/{item_id}`

- [ ] **Step 1: Confirm the next migration number and read the templates**

Run: `ls services/assessment/migrations/ | grep -oE '^[0-9]+' | sort -u | tail -3` — expect the highest to be `000016`, so this task uses `000017`.

```bash
sed -n '195,250p' services/assessment/migrations/000005_authoring_workflows.up.sql
sed -n '1,90p' services/assessment/migrations/000006_candidate_assignment_snapshot.up.sql
grep -n "add_exam_section\|add_exam_item" services/assessment/migrations/000005_authoring_workflows.up.sql services/assessment/migrations/000006_candidate_assignment_snapshot.up.sql
```

Confirm the live `add_exam_item` definition is the one in `000006` (the `000005` version is superseded — a later `REVOKE`/`CREATE OR REPLACE` in `000006` is what makes `000006`'s the active one; verify this by checking whether `000006` uses `CREATE OR REPLACE FUNCTION` or drops-and-recreates).

- [ ] **Step 2: Write the up migration**

Create `services/assessment/migrations/000017_remove_exam_section_item.up.sql`. Both procedures follow `add_exam_section`/`add_exam_item`'s exact validation shape (draft-only, optimistic-concurrency `content_version` check, authz check) but delete instead of insert, and must reject removing a section that still has items (referential safety — a section with items must have its items removed first, or the removal must cascade; choose **reject with an error** to match the platform's soft-delete-by-default, no-silent-cascade posture from CLAUDE.md's ADR-0013, unless `services/assessment` already has an existing ON DELETE CASCADE for `exam_items.section_id` that makes rejection redundant — check with `grep -n "exam_items" services/assessment/migrations/*.up.sql | grep -i "references\|foreign key\|cascade"` first):

```sql
SET ROLE aether_assessment_owner;

CREATE FUNCTION assessment.remove_exam_section(
    p_id uuid,
    p_tenant_id uuid,
    p_exam_version_id uuid,
    p_expected_content_version bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, assessment, authz
AS $function$
DECLARE version_row assessment.exam_versions%ROWTYPE;
BEGIN
    IF p_id IS NULL OR p_tenant_id IS NULL OR p_exam_version_id IS NULL
       OR p_expected_content_version IS NULL OR p_expected_content_version <= 0 THEN
        RAISE EXCEPTION 'invalid exam section removal command' USING ERRCODE = '22023';
    END IF;
    IF NOT authz.current_context_allows(p_tenant_id, 'assessment.write', 'assessment.exam_sections') THEN
        RAISE EXCEPTION 'authorization denied' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO version_row
    FROM assessment.exam_versions
    WHERE id = p_exam_version_id AND tenant_id = p_tenant_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'exam version was not found' USING ERRCODE = 'P0002';
    END IF;
    IF version_row.status <> 'draft' THEN
        RAISE EXCEPTION 'published exam version is immutable' USING ERRCODE = '40001';
    END IF;
    IF version_row.content_version <> p_expected_content_version THEN
        RAISE EXCEPTION 'exam content version is stale' USING ERRCODE = '40001';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM assessment.exam_sections
        WHERE id = p_id AND tenant_id = p_tenant_id AND exam_version_id = p_exam_version_id
    ) THEN
        RAISE EXCEPTION 'exam section was not found' USING ERRCODE = 'P0002';
    END IF;
    IF EXISTS (
        SELECT 1 FROM assessment.exam_items
        WHERE section_id = p_id AND tenant_id = p_tenant_id
    ) THEN
        RAISE EXCEPTION 'exam section still has items; remove them first' USING ERRCODE = '23503';
    END IF;

    DELETE FROM assessment.exam_sections WHERE id = p_id AND tenant_id = p_tenant_id;
    UPDATE assessment.exam_versions
    SET content_version = content_version + 1
    WHERE id = p_exam_version_id AND tenant_id = p_tenant_id;
END
$function$;

CREATE FUNCTION assessment.remove_exam_item(
    p_id uuid,
    p_tenant_id uuid,
    p_exam_version_id uuid,
    p_expected_content_version bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, assessment, authz
AS $function$
DECLARE version_row assessment.exam_versions%ROWTYPE;
BEGIN
    IF p_id IS NULL OR p_tenant_id IS NULL OR p_exam_version_id IS NULL
       OR p_expected_content_version IS NULL OR p_expected_content_version <= 0 THEN
        RAISE EXCEPTION 'invalid exam item removal command' USING ERRCODE = '22023';
    END IF;
    IF NOT authz.current_context_allows(p_tenant_id, 'assessment.write', 'assessment.exam_items') THEN
        RAISE EXCEPTION 'authorization denied' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO version_row
    FROM assessment.exam_versions
    WHERE id = p_exam_version_id AND tenant_id = p_tenant_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'exam version was not found' USING ERRCODE = 'P0002';
    END IF;
    IF version_row.status <> 'draft' THEN
        RAISE EXCEPTION 'published exam version is immutable' USING ERRCODE = '40001';
    END IF;
    IF version_row.content_version <> p_expected_content_version THEN
        RAISE EXCEPTION 'exam content version is stale' USING ERRCODE = '40001';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM assessment.exam_items
        WHERE id = p_id AND tenant_id = p_tenant_id AND exam_version_id = p_exam_version_id
    ) THEN
        RAISE EXCEPTION 'exam item was not found' USING ERRCODE = 'P0002';
    END IF;

    DELETE FROM assessment.exam_items WHERE id = p_id AND tenant_id = p_tenant_id;
    UPDATE assessment.exam_versions
    SET content_version = content_version + 1
    WHERE id = p_exam_version_id AND tenant_id = p_tenant_id;
END
$function$;

REVOKE ALL ON FUNCTION assessment.remove_exam_section(uuid, uuid, uuid, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION assessment.remove_exam_item(uuid, uuid, uuid, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION assessment.remove_exam_section(uuid, uuid, uuid, bigint) TO aether_assessment_app;
GRANT EXECUTE ON FUNCTION assessment.remove_exam_item(uuid, uuid, uuid, bigint) TO aether_assessment_app;

RESET ROLE;
```

- [ ] **Step 3: Write the down migration**

```sql
SET ROLE aether_assessment_owner;

DROP FUNCTION IF EXISTS assessment.remove_exam_section(uuid, uuid, uuid, bigint);
DROP FUNCTION IF EXISTS assessment.remove_exam_item(uuid, uuid, uuid, bigint);

RESET ROLE;
```

- [ ] **Step 4: Verify the migration**

Run: `make test-migrations`
Expected: PASS.

- [ ] **Step 5: Write the failing app-layer test**

Read `services/assessment/internal/app/service.go`'s `AddExamSection`/`AddExamItem` (lines ~491-538) and their existing tests in `services/assessment/internal/app/service_test.go` first. Add `TestRemoveExamSection`/`TestRemoveExamItem` table-driven test cases mirroring the Add-variant tests' structure (valid command succeeds, invalid IDs rejected, etc.) against a fake store.

Run: `cd services/assessment && go test ./internal/app/... -v -run TestRemoveExam`
Expected: FAIL — methods don't exist yet.

- [ ] **Step 6: Add `RemoveExamSection`/`RemoveExamItem` to the app service**

In `services/assessment/internal/app/service.go`, add command structs and methods mirroring `AddExamSection`/`AddExamItem`'s normalization-then-`runWrite` shape:

```go
type RemoveExamSection struct {
	ID                      string
	TenantID                string
	ExamVersionID           string
	ExpectedContentVersion  int64
	IdempotencyKey          string
}

func (service *Service) RemoveExamSection(ctx context.Context, capability centralauthz.Capability, command RemoveExamSection) error {
	command.ID, command.TenantID, command.ExamVersionID = normalizeID(command.ID), normalizeID(command.TenantID), normalizeID(command.ExamVersionID)
	if !validID(command.ID) || !validID(command.TenantID) || !validID(command.ExamVersionID) || command.ExpectedContentVersion <= 0 {
		return invalid("exam section removal fields are invalid")
	}
	_, err := runWrite(service, ctx, capability, command.TenantID, "assessment.exam_section.remove", command.IdempotencyKey,
		struct {
			ID                     string `json:"id"`
			ExamVersionID          string `json:"exam_version_id"`
			ExpectedContentVersion int64  `json:"expected_content_version"`
		}{command.ID, command.ExamVersionID, command.ExpectedContentVersion}, httpStatusOK,
		func(transaction pgx.Tx) (struct{}, error) {
			return struct{}{}, service.store.RemoveExamSection(ctx, transaction, command)
		},
	)
	return err
}
```

Add the equivalent `RemoveExamItem`/`app.RemoveExamItem` following the same shape, and add both method signatures to the `Store` interface in the same file. Read the exact `runWrite` generic signature first (`grep -n "func runWrite" services/assessment/internal/app/service.go`) to get the type parameters right — it may not directly support a `struct{}` success type if it was written assuming a non-empty return; if so, follow whatever pattern this codebase already uses for write-only stored-procedure calls that return no row (check if any other `Service` method already has this shape, e.g. a delete/hard-delete method for a different resource in this same service, and mirror that exactly instead of inventing a new return convention).

- [ ] **Step 7: Run to verify tests pass**

Run: `cd services/assessment && go test ./internal/app/... -v`
Expected: PASS.

- [ ] **Step 8: Add repo methods**

In `services/assessment/internal/adapters/repo/postgres.go`, add `RemoveExamSection`/`RemoveExamItem` mirroring `AddExamSection`/`AddExamItem` (lines 237-282) — call the new stored procedures, and enqueue `assessment.exam_section.removed.v1`/`assessment.exam_item.removed.v1` outbox events (mirroring the `"assessment.exam_section.created.v1"` enqueue shape) instead of selecting the row back (there's nothing to select — it's deleted).

- [ ] **Step 9: Add HTTP routes and handlers**

In `services/assessment/internal/adapters/http/handler.go`, add to the `UseCases` interface (near lines 37-38):
```go
RemoveExamSection(context.Context, centralauthz.Capability, app.RemoveExamSection) error
RemoveExamItem(context.Context, centralauthz.Capability, app.RemoveExamItem) error
```

Register routes near the existing `addExamSection`/`addExamItem` registrations (handler.go:80-81):
```go
mux.HandleFunc("DELETE /v1/tenants/{tenant_id}/exam-versions/{exam_version_id}/sections/{section_id}", handler.removeExamSection)
mux.HandleFunc("DELETE /v1/tenants/{tenant_id}/exam-versions/{exam_version_id}/sections/{section_id}/items/{item_id}", handler.removeExamItem)
```

Write `removeExamSection`/`removeExamItem` handler functions mirroring `addExamSection`/`addExamItem`'s structure (parse path values, call `handler.authorizer.AuthorizeHTTP(request.Context(), request, "write", "exam_sections"|"exam_items", id, tenantID)`, parse the expected-content-version from the request body or a query parameter — check how `AddExamSection` receives `ExpectedContentVersion` in its request body shape and mirror it exactly for consistency), call the service method, write a `204 No Content` on success (no body to return, unlike the Add variants which return the created resource).

- [ ] **Step 10: Write and run handler tests**

Add tests to `services/assessment/internal/adapters/http/handler_test.go` mirroring the existing `addExamSection`/`addExamItem` handler tests, covering: success (204), stale content version (409/conflict per the `40001` error code mapping), published version rejected, not-found, and — specific to removal — a section with existing items rejected.

Run: `cd services/assessment && go test ./... -v`
Expected: PASS.

- [ ] **Step 11: Full verification and commit**

```bash
cd /home/shreesh/Documents/AlgoQX && make build && make test && make vet && make fmt-check && make lint && make test-migrations
git add services/assessment/
git commit -m "feat: add exam section and item removal endpoints"
```

Update `services/assessment/README.md`'s API surface section with the two new `DELETE` routes.

---

## Task 6: Integration test coverage for six remaining services

**Files:**
- Create: `services/assessment/internal/adapters/repo/postgres_integration_test.go`
- Create: `services/tenant/internal/adapters/repo/postgres_integration_test.go`
- Create: `services/question-bank/internal/adapters/repo/postgres_integration_test.go`
- Create: `services/identity/internal/adapters/repo/postgres_integration_test.go`
- Create: `services/submission/internal/adapters/repo/postgres_integration_test.go`
- Create: `services/judge/internal/adapters/repo/postgres_integration_test.go`

**Interfaces:**
- Consumes: `libs/pkg/testutil/integration.StartPostgres(ctx, t) *pgxpool.Pool` and `integration.ApplyMigrations(ctx, t, pool, migrationsDir)` (already used by `services/user/internal/adapters/repo/postgres_integration_test.go`)
- Produces: nothing consumed by other tasks

This task adds one RLS-isolation Testcontainers test per service, all the same shape as the existing `user` service test. Per this plan's Global Constraints and the subagent-driven-development skill's batching guidance, dispatch this as **one** task covering all six services — they are the same kind of edit repeated six times, not six independently-judgeable pieces of design.

- [ ] **Step 1: Read the exact template in full**

```bash
cat services/user/internal/adapters/repo/postgres_integration_test.go
cat libs/pkg/testutil/integration/*.go
```

The template's five phases, to reproduce for each service: (1) `integration.StartPostgres(ctx, t)`, (2) pre-create that service's roles as superuser and transfer schema/database ownership (the exact role names and count vary per service — see Step 2), (3) `integration.ApplyMigrations`, (4) insert one row for tenant A directly as superuser into a real tenant-scoped table, (5) for two sub-tests (tenant A context sees the row, tenant B context sees zero rows), open a transaction, seed `authz.request_contexts` directly, `SET LOCAL ROLE <service>_app`, and assert `SELECT count(*)`.

- [ ] **Step 2: For each of the six services, find its role names, one tenant-scoped table, and its authz action/resource strings**

For each service, run:
```bash
grep -n "CREATE ROLE" services/<svc>/migrations/000001_bootstrap.up.sql
grep -n "CREATE TABLE" services/<svc>/migrations/000001_bootstrap.up.sql | head -5
grep -n "tenant_id" services/<svc>/migrations/000001_bootstrap.up.sql | grep "CREATE TABLE\|ALTER TABLE" 
```

Pick, per service, one straightforward tenant-scoped table with a simple required-column INSERT (avoid tables with many required foreign keys — prefer the smallest one that has RLS enabled and a `tenant_id` column, matching `users.students`' role in the template). Record: the owner role name (`aether_<svc>_owner`), the app role name (`aether_<svc>_app`) or equivalent, the migrator role, and any other roles this service's `000001_bootstrap.up.sql` requires to exist before migrations run (the `user` service needs five; other services may need fewer or differently-named roles — read each service's own bootstrap migration, do not assume the `user` service's five roles apply unchanged).

- [ ] **Step 3: Write `services/assessment/internal/adapters/repo/postgres_integration_test.go`**

Following the template exactly, substituting: assessment's roles (from Step 2), assessment's migrations directory path (`filepath.Join(filepath.Dir(file), "../../..")` relative to this new file's location — confirm the directory depth matches, since `postgres_integration_test.go` lives at the same relative depth in every service: `services/<svc>/internal/adapters/repo/`), one assessment tenant-scoped table for the insert/count assertions (e.g. `assessment.exams` or another table Step 2 identifies), and an `action`/`resource` string pair that makes sense for that table (mirror the pattern `'user.read'`/`'users.students'` used in the template — e.g. `'assessment.read'`/`'assessment.exams'`).

Name the test `TestRLSIsolateTenants` in `package repo_test`, with the `//go:build integration` tag, matching the template exactly.

- [ ] **Step 4: Run it**

Run: `cd services/assessment && go test -tags=integration ./internal/adapters/repo/... -v`
Expected: PASS (both sub-tests: tenant A sees its row, tenant B sees none).

- [ ] **Step 5: Repeat Steps 3-4 for `tenant`, `question-bank`, `identity`, `submission`, `judge`**

Same process, one file per service, each run individually to confirm PASS before moving to the next. For `judge` specifically: confirm during Step 2 whether `judge` even has RLS-protected tenant-scoped tables in the traditional sense (the earlier audit noted `judge`'s schema is comparatively thin) — if `judge`'s tables are not tenant-partitioned the same way (e.g. if job records reference tenancy only indirectly via `tenant_fairness_key` rather than a `tenant_id` RLS column), adapt the test to prove whatever isolation mechanism `judge` actually implements, rather than forcing the tenant-A/tenant-B RLS shape onto a schema that doesn't have it. If `judge` truly has no per-tenant row isolation to test, write a test proving whatever access boundary it does enforce (e.g. that the app role cannot read another consumer's leased job), and note this deviation in the task's commit message.

- [ ] **Step 6: Run the full integration suite together**

Run: `make test-integration`
Expected: PASS for all seven services now (the original `user` test plus the six new ones).

- [ ] **Step 7: Full verification and commit**

```bash
cd /home/shreesh/Documents/AlgoQX && make build && make test && make test-integration && make vet && make fmt-check
git add services/assessment/internal/adapters/repo/postgres_integration_test.go \
        services/tenant/internal/adapters/repo/postgres_integration_test.go \
        services/question-bank/internal/adapters/repo/postgres_integration_test.go \
        services/identity/internal/adapters/repo/postgres_integration_test.go \
        services/submission/internal/adapters/repo/postgres_integration_test.go \
        services/judge/internal/adapters/repo/postgres_integration_test.go
git commit -m "test: add RLS tenant-isolation integration tests to six services"
```

---

## Task 7: HMAC capability key rotation CLI

**Files:**
- Create: `libs/pkg/cmd/rotate-authz-key/main.go`
- Create: `libs/pkg/cmd/rotate-authz-key/main_test.go`
- Modify: `Makefile`
- Modify: root `README.md`

**Interfaces:**
- Consumes: `libs/pkg/database.NewUUIDv7() (string, error)` (`libs/pkg/database/uuidv7.go:11`)
- Produces: `make rotate-authz-key ACTION=publish|retire ...`

This CLI operationalizes rotation the schema already supports: `authz.context_keys` (present in 9 of 11 service databases — `analytics, assessment, identity, notification, question-bank, seb, submission, tenant, user`; **not** `gateway` or `judge`, which have no such table) is keyed by `key_id` with `not_before`/`not_after`/`retired_at` windows, and `authz.set_context` already looks up by `key_id` + `audience`, so two keys can be simultaneously valid during a rotation window. No application code changes to `libs/pkg/authz` are needed — only tooling to publish and later retire rows.

- [ ] **Step 1: Read the templates**

```bash
cat libs/pkg/cmd/bootstrap/main.go
cat libs/pkg/database/uuidv7.go
sed -n '1,60p' libs/pkg/authz/capability.go
```

Confirm `SigningKey.Validate()` (`capability.go:120-131`) requirements: audience matches `^[a-z][a-z0-9_]{0,62}$`, key_id is a UUID, secret is at least 32 bytes (`sha256.Size`).

- [ ] **Step 2: Write the failing CLI test**

Create `libs/pkg/cmd/rotate-authz-key/main_test.go`, testing pure argument validation with no database (mirroring `libs/pkg/cmd/bootstrap/main_test.go`'s `TestValidateArgumentsRejectsBadInput` structure):

```go
package main

import "testing"

func TestValidateArgumentsRejectsBadInput(t *testing.T) {
	t.Parallel()
	testCases := []struct {
		name      string
		action    string
		audience  string
		wantError bool
	}{
		{name: "valid publish", action: "publish", audience: "aether_submission", wantError: false},
		{name: "valid retire", action: "retire", audience: "aether_user", wantError: false},
		{name: "invalid action", action: "delete", audience: "aether_user", wantError: true},
		{name: "empty action", action: "", audience: "aether_user", wantError: true},
		{name: "empty audience", action: "publish", audience: "", wantError: true},
		{name: "uppercase audience", action: "publish", audience: "Aether_User", wantError: true},
	}
	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			err := validateArguments(testCase.action, testCase.audience)
			if (err != nil) != testCase.wantError {
				t.Fatalf("validateArguments(%q, %q) error = %v, wantError = %t",
					testCase.action, testCase.audience, err, testCase.wantError)
			}
		})
	}
}
```

The audience validation mirrors `libs/pkg/authz/capability.go`'s `audiencePattern = regexp.MustCompile(`^[a-z][a-z0-9_]{0,62}$`)` — import and reuse `authz.SigningKey{Audience: audience}.Validate()`'s audience check if it's exported for this purpose, or reproduce the same regex locally if not (check whether `audiencePattern` itself is exported from `libs/pkg/authz` — if it's unexported, define an equivalent local regex rather than trying to reach into the package).

- [ ] **Step 3: Run to verify failure**

Run: `cd libs/pkg && go test ./cmd/rotate-authz-key/... -v`
Expected: FAIL — package does not exist.

- [ ] **Step 4: Write the CLI**

Create `libs/pkg/cmd/rotate-authz-key/main.go`. Flags: `--action` (`publish` or `retire`), `--audience`, `--database-url` (one target database at a time, run once per service database being rotated — mirroring `libs/pkg/cmd/migrate/main.go`'s single-database-per-invocation shape rather than bootstrap's two-database shape, since rotation targets one of nine independent databases per invocation), `--key-id` (required for `retire`; for `publish`, generate a new UUIDv7 via `database.NewUUIDv7()` if not supplied), `--not-before` (RFC3339, defaults to 5 minutes from now if unset, giving deployed services time to pick up new config before the key becomes valid), `--not-after` (RFC3339, required for `publish`).

For `publish`: generate a random 32-byte secret via `crypto/rand.Read` (mirror `libs/pkg/database/uuidv7.go`'s error-wrapping style: `fmt.Errorf("read key material randomness: %w", err)`), `INSERT INTO authz.context_keys (key_id, audience, key_material, not_before, not_after) VALUES ($1, $2, $3, $4, $5)`, and print the key_id and the base64-encoded secret **to stderr only, once** with a clear warning that this is the only time the secret is displayed and it must be placed into the target service's `AUTHZ_CAPABILITY_KEYS` configuration out-of-band (never write it to a file, log, or stdout that might be captured/persisted).

For `retire`: `UPDATE authz.context_keys SET retired_at = clock_timestamp() WHERE key_id = $1 AND audience = $2 AND retired_at IS NULL`, and error if zero rows were affected (already retired or doesn't exist).

Model connection handling on `libs/pkg/cmd/bootstrap/main.go`'s `pgx.Connect(ctx, url)` usage.

- [ ] **Step 5: Run the tests**

Run: `cd libs/pkg && go test ./cmd/rotate-authz-key/... -v`
Expected: PASS.

- [ ] **Step 6: Add the make target**

In `Makefile`, add `rotate-authz-key` to `.PHONY` and the help line, then:

```make
rotate-authz-key:
	@test -n "$(ACTION)" || { echo "ACTION is required (publish|retire)"; exit 1; }
	@test -n "$(AUDIENCE)" || { echo "AUDIENCE is required"; exit 1; }
	@test -n "$$DATABASE_URL" || { echo "DATABASE_URL is required"; exit 1; }
	@(cd libs/pkg && go run ./cmd/rotate-authz-key \
		--action "$(ACTION)" --audience "$(AUDIENCE)" --database-url "$$DATABASE_URL" \
		$(if $(KEY_ID),--key-id "$(KEY_ID)") $(if $(NOT_BEFORE),--not-before "$(NOT_BEFORE)") $(if $(NOT_AFTER),--not-after "$(NOT_AFTER)"))
```

- [ ] **Step 7: Full verification and commit**

```bash
cd /home/shreesh/Documents/AlgoQX && make build && make test && make vet && make fmt-check
git add libs/pkg/cmd/rotate-authz-key/ Makefile
git commit -m "feat: add HMAC capability key rotation CLI"
```

Document the full rotation procedure in root `README.md`: publish a new key with a `not-before` in the near future against all nine target databases, wait until `not-before` has passed and confirm the new key works, update `AUTHZ_CAPABILITY_KEYS` in the signing service's (User service, per `libs/pkg/authz`) configuration to the new key, then once confident no in-flight capability signed with the old key remains unconsumed (capabilities have a 5-second TTL per `capabilityTTL` in `capability.go` — the safe window is generous), retire the old key on all nine databases.

---

## Completion checklist

- [ ] CI runs `make test-integration` as its own job
- [ ] No test in `services/user/test/integration` self-skips with "not implemented yet"
- [ ] `libs/pkg/ratelimit` exists; gateway and identity's duplicate limiter code is gone; login, both password-reset endpoints, submission's attempt creation, and judge's `SubmitExecution` are all rate-limited
- [ ] Judge's `DeleteExecutionJob`/`HardDeleteExecutionJob` are reachable via gRPC
- [ ] Draft exam sections and items can be removed via `DELETE` endpoints, rejecting stale/published/non-empty cases
- [ ] `assessment`, `tenant`, `question-bank`, `identity`, `submission`, `judge` each have a passing RLS-isolation Testcontainers test
- [ ] A `rotate-authz-key` CLI can publish a new overlapping key and retire an old one against any of the nine `authz.context_keys`-bearing databases
- [ ] `make build`, `test`, `test-integration`, `vet`, `fmt-check`, `lint`, `test-migrations` all pass at the end of every task
- [ ] Every touched service's README reflects the new surface

## Notes for the executor

**On Task 6's batching.** This is one task with six near-identical sub-deliverables, dispatched to a single implementer per subagent-driven-development's batching guidance — do not split it into six separate task reviews.

**On Task 3's scope.** The rate-limiter extraction (Steps 1-8) is a pure refactor with a checkpoint before any new limiter is added (Step 8) — if that checkpoint fails, stop and fix the extraction before proceeding to Steps 9-15, since every subsequent step builds on the extracted package behaving identically to the two originals.

**On Task 5's cascade decision.** Step 2 asks the implementer to check for an existing `ON DELETE CASCADE` before deciding to reject non-empty section removal. If one exists, the "reject" branch becomes unreachable dead code — in that case, adapt the procedure to either work with the cascade or add the missing application-level guard the cascade's absence would otherwise require. Do not leave an unreachable branch in either the SQL or its tests.
