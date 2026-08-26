# libs/pkg/testutil/integration

Helpers for writing integration tests that need real infrastructure. All files
in this package are tagged `//go:build integration`, so they are excluded from
the normal `make test` run and only compiled when the `integration` build tag
is active.

## Running integration tests

```bash
make test-integration   # requires Docker
```

Or directly:

```bash
go test -tags integration -timeout 120s ./...
```

## Available helpers

### `StartPostgres(ctx, tb) *pgxpool.Pool`

Starts a `postgres:18.4` container and returns a superuser (`postgres`) pool.
The container is terminated and the pool is closed when `tb.Cleanup` fires.

### `PoolDSN(pool) string`

Returns the connection string the pool was opened with. Pass this to
`ApplyMigrations` or any other tool that takes a DSN.

### `StartNATS(ctx, tb) string`

Starts a `nats:2.10` container and returns its connection URL (`nats://…`).
The container is terminated when `tb.Cleanup` fires.

### `ApplyMigrations(ctx, tb, pool, migrationsDir)`

Runs all pending migrations from `migrationsDir` against the pool's database
using golang-migrate directly (no production migration-ledger validation).

The caller must complete any pre-migration setup that the service's migrations
require — for example, creating database roles and adjusting schema ownership.
See `services/user/internal/adapters/repo/postgres_integration_test.go` for a
complete example.

## Writing a new integration test

```go
//go:build integration

package myservice_test

import (
    "context"
    "path/filepath"
    "runtime"
    "testing"

    "github.com/aethercode/aethercode/libs/pkg/testutil/integration"
)

func TestSomething(t *testing.T) {
    t.Parallel()
    ctx := context.Background()

    pool := integration.StartPostgres(ctx, t)

    // service-specific role/schema setup …

    _, file, _, _ := runtime.Caller(0)
    migrationsDir := filepath.Join(filepath.Dir(file), "../../migrations")
    integration.ApplyMigrations(ctx, t, pool, migrationsDir)

    // write test assertions …
}
```
