# Integration Test Harness — Design Spec (Sub-project F)

Date: 2026-08-20
Sub-project: F
Status: active

## Problem

All 56 test files are unit tests against in-process mocks. RLS isolation,
migration correctness, and cross-service event flows are completely untested as
a system. No test can prove that a tenant's data cannot be read by another tenant,
or that a submitted event actually results in a completed evaluation.

## Approach

Add a `libs/pkg/testutil/integration` package that starts real PostgreSQL and NATS
containers via Testcontainers Go. Each service gets an integration test file
`services/<svc>/internal/integration_test.go` that:

1. Spins up a real DB container with the service's migrations applied.
2. Runs its tests.
3. Tears down.

Integration tests are tagged `//go:build integration` and run via `make test-integration`.
They are excluded from the normal `make test` target.

## Core harness package

```
libs/pkg/testutil/
  integration/
    postgres.go    — StartPostgres() → *pgxpool.Pool + cleanup func
    nats.go        — StartNATS() → *nats.Conn + cleanup func
    migrate.go     — ApplyMigrations(pool, migrationsPath) error
```

### postgres.go

```go
// StartPostgres starts a real PostgreSQL container, applies migrations
// from the given path, and returns a connection pool and cleanup function.
// The container is removed when cleanup() is called.
func StartPostgres(ctx context.Context, migrationsPath string) (*pgxpool.Pool, func(), error)
```

Uses `github.com/testcontainers/testcontainers-go/modules/postgres`.
The container image is `postgres:18.4` to match the compose file.

### Per-service integration tests

The first integration tests to write are the highest-value ones:

**user service**: RLS isolation — a query run as tenant A's role cannot read tenant B's rows.
**assessment service**: Assignment materialization — publishing a `tenant.batch_created.v1`
  event eventually results in candidate_assignments being created.
**submission service**: Attempt expiry — an attempt past its deadline is transitioned to
  `expired` by the worker (requires the expiry worker from Sub-project D).

## Makefile

```make
test-integration:
    @cd libs/pkg && go test -tags integration ./testutil/integration/...
    @for svc in gateway identity tenant user question-bank assessment \
                submission judge seb notification analytics; do \
        (cd services/$$svc && go test -tags integration -timeout 120s ./...) || exit 1; \
    done
```

## CI integration

Add to `.github/workflows/ci.yml`, after the existing `test` job and before
`build-images`:

```yaml
test-integration:
  needs: [test]
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-go@v5
      with: { go-version: '1.26.7' }
    - name: Run integration tests
      run: make test-integration
```

## Definition of done

- `make test-integration` runs without Docker errors on a machine with Docker.
- The RLS isolation test proves cross-tenant data isolation for the user service.
- The existing `make test` still passes and does not require Docker.
- `libs/pkg/testutil/integration/README.md` documents how to write new
  integration tests.
