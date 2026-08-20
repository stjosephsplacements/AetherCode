# Integration Test Harness — Implementation Plan

> **Spec:** `docs/superpowers/specs/2026-08-20-integration-harness-design.md`

**Goal:** Add a `libs/pkg/testutil/integration` package and the first RLS isolation test for the user service.

## Global Constraints
- Integration tests tagged `//go:build integration` — excluded from `make test`
- `make test-integration` runs them with Docker available
- Normal `make test` is unaffected
- Tests are table-driven and call `t.Parallel()` where safe
- `make build`, `make lint` still pass

---

## Task 1: Core integration harness

**Files:**
- Create: `libs/pkg/testutil/integration/postgres.go`
- Create: `libs/pkg/testutil/integration/nats.go`
- Create: `libs/pkg/testutil/integration/migrate.go`
- Modify: `libs/pkg/go.mod` (add testcontainers dependency)

### Step 1: Add testcontainers dependency

```bash
cd libs/pkg
go get github.com/testcontainers/testcontainers-go@latest
go get github.com/testcontainers/testcontainers-go/modules/postgres@latest
go get github.com/testcontainers/testcontainers-go/modules/nats@latest
go mod tidy
```

Check the versions with `go list -m github.com/testcontainers/testcontainers-go`.

### Step 2: Write postgres.go

```go
//go:build integration

package integration

import (
    "context"
    "fmt"
    "testing"

    "github.com/jackc/pgx/v5/pgxpool"
    "github.com/testcontainers/testcontainers-go"
    tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"
    "github.com/testcontainers/testcontainers-go/wait"
)

// StartPostgres starts a real PostgreSQL 18.4 container and returns a
// pgxpool.Pool connected to it. The container is stopped when tb.Cleanup fires.
func StartPostgres(ctx context.Context, tb testing.TB) *pgxpool.Pool {
    tb.Helper()

    container, err := tcpostgres.Run(ctx,
        "postgres:18.4",
        tcpostgres.WithDatabase("testdb"),
        tcpostgres.WithUsername("postgres"),
        tcpostgres.WithPassword("postgres"),
        testcontainers.WithWaitStrategy(
            wait.ForLog("database system is ready to accept connections").
                WithOccurrence(2),
        ),
    )
    if err != nil {
        tb.Fatalf("StartPostgres: failed to start container: %v", err)
    }
    tb.Cleanup(func() { _ = container.Terminate(ctx) })

    connStr, err := container.ConnectionString(ctx, "sslmode=disable")
    if err != nil {
        tb.Fatalf("StartPostgres: failed to get connection string: %v", err)
    }

    pool, err := pgxpool.New(ctx, connStr)
    if err != nil {
        tb.Fatalf("StartPostgres: failed to open pool: %v", err)
    }
    tb.Cleanup(pool.Close)

    return pool
}

// DSN returns the connection string for the container.
func DSN(ctx context.Context, container *tcpostgres.PostgresContainer, tb testing.TB) string {
    tb.Helper()
    dsn, err := container.ConnectionString(ctx, "sslmode=disable")
    if err != nil {
        tb.Fatalf("DSN: %v", err)
    }
    return dsn
}
```

### Step 3: Write migrate.go

```go
//go:build integration

package integration

import (
    "context"
    "fmt"
    "testing"

    "github.com/jackc/pgx/v5/pgxpool"
    "github.com/aethercode/aethercode/libs/pkg/migrate"
)

// ApplyMigrations runs all migrations from the given directory against the pool.
func ApplyMigrations(ctx context.Context, tb testing.TB, pool *pgxpool.Pool, migrationsDir string) {
    tb.Helper()
    if err := migrate.Up(ctx, pool, migrationsDir); err != nil {
        tb.Fatalf("ApplyMigrations(%s): %v", migrationsDir, err)
    }
}
```

(Check the actual `libs/pkg/migrate` API first — the function names may differ.)

### Step 4: Commit the harness

```bash
cd /path/to/repo
export PATH="$HOME/.local/go/bin:$HOME/go/bin:$PATH"
mkdir -p ~/.cache/aethercode-tmp && export TMPDIR=$HOME/.cache/aethercode-tmp GOTMPDIR=$HOME/.cache/aethercode-tmp
make build  # verify compiles
git add libs/pkg/testutil/ libs/pkg/go.mod libs/pkg/go.sum
git commit -m "feat: add integration test harness (Testcontainers + migrate)"
```

---

## Task 2: First integration test — user service RLS isolation

**File:**
- Create: `services/user/internal/adapters/repo/postgres_integration_test.go`

### Step 1: Write the test

```go
//go:build integration

package repo_test

import (
    "context"
    "testing"

    "github.com/aethercode/aethercode/libs/pkg/testutil/integration"
)

func TestRLSIsolateTenants(t *testing.T) {
    t.Parallel()
    ctx := context.Background()

    pool := integration.StartPostgres(ctx, t)
    integration.ApplyMigrations(ctx, t, pool, "../../../../migrations")

    tenantA := "018f4b0d-08f8-7c09-9ba7-efdf9c330001"
    tenantB := "018f4b0d-08f8-7c09-9ba7-efdf9c330002"

    // Insert a student for tenant A
    _, err := pool.Exec(ctx, `
        SET LOCAL rls.tenant_id = $1;
        SET LOCAL rls.principal_id = $1;
        INSERT INTO users.students (id, principal_id, tenant_id, enrollment_number, status)
        VALUES (gen_random_uuid(), gen_random_uuid(), $1, 'A001', 'active')
    `, tenantA)
    if err != nil {
        t.Fatalf("insert tenant A student: %v", err)
    }

    // Query as tenant B — must see zero rows
    var count int
    err = pool.QueryRow(ctx, `
        SET LOCAL rls.tenant_id = $1;
        SELECT count(*) FROM users.students WHERE deleted_at IS NULL
    `, tenantB).Scan(&count)
    if err != nil {
        t.Fatalf("query tenant B: %v", err)
    }
    if count != 0 {
        t.Fatalf("RLS isolation failure: tenant B can see %d rows belonging to tenant A", count)
    }
}
```

(Adjust the RLS context-setting mechanism to match what the actual RLS triggers use — check `libs/pkg/database/context.go` for the real GUC names.)

### Step 2: Run the integration test

```bash
export PATH="$HOME/.local/go/bin:$HOME/go/bin:$PATH"
mkdir -p ~/.cache/aethercode-tmp && export TMPDIR=$HOME/.cache/aethercode-tmp
cd services/user && go test -tags integration -v ./internal/adapters/repo/ -run TestRLSIsolateTenants
```

Expected: PASS.

### Step 3: Add make target

In `Makefile`:

```make
test-integration:
	@echo "Running integration tests (requires Docker)..."
	@export PATH="$$HOME/.local/go/bin:$$HOME/go/bin:$$PATH"; \
	 mkdir -p ~/.cache/aethercode-tmp && export TMPDIR=$$HOME/.cache/aethercode-tmp; \
	 cd libs/pkg && go test -tags integration -timeout 120s ./testutil/integration/... && \
	 cd $(CURDIR)/services/user && go test -tags integration -timeout 120s ./...
```

### Step 4: Commit

```bash
git add services/user/internal/adapters/repo/ Makefile
git commit -m "feat: add RLS isolation integration test for user service"
```

---

## Completion checklist

- [ ] `make test` still passes (integration tests excluded by build tag)
- [ ] `make test-integration` passes with Docker available
- [ ] The RLS isolation test proves cross-tenant data isolation
- [ ] `libs/pkg/testutil/integration/README.md` documents how to write integration tests
