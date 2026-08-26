# Judge Dispatcher — Implementation Plan (Sub-project J)

> **Spec:** `docs/superpowers/specs/2026-08-20-judge-dispatcher-design.md`
> **Schema:** `services/judge/migrations/000001_judge_control_schema.up.sql`

**Goal:** Implement the RabbitMQ consumer + dispatcher worker that reads admission pointers,
fetches execution jobs, submits each unit to the engine (Judge0 or stub), polls for verdicts,
and writes completion records. Enable with `JUDGE_ENGINE=stub` by default.

## Understanding the existing architecture (read before writing)

The judge control plane already has:
- `judge.execution_jobs` — one row per submission, with `state` field
- `judge.execution_units` — one row per test case within a job, each gets a `judge0_token`
- `judge.admission_outbox` — written by `app.Submit`; read by `admission_publisher.go` and published to RabbitMQ
- The `Publisher` in `adapters/amqp/admission_publisher.go` publishes `{"job_id": "<uuid>"}` messages

The publisher writes messages; the dispatcher (this sub-project) consumes them.

## Global Constraints
- Default: `JUDGE_ENGINE=stub` (no Judge0 needed to test)
- Stub engine returns "accepted" verdict after 100ms simulated delay
- Judge0 engine only activates when `JUDGE_ENGINE=judge0` (gVisor-gated)
- Tests use a stub engine and fake store — no DB or RabbitMQ required
- `make build`, `make test`, `make lint` all pass
- Server starts normally with dispatcher disabled (`JUDGE_DISPATCHER_ENABLED=false`)

---

## Task 1: Engine port and stub

**Files:**
- Create: `services/judge/internal/dispatcher/engine.go`
- Create: `services/judge/internal/adapters/judge0/stub.go`

### Step 1: Read the execution unit schema

```bash
sed -n '/CREATE TABLE judge.execution_units/,/^);/p' services/judge/migrations/000001_judge_control_schema.up.sql
grep -n "type.*struct\|SubmitExecution\|Execution\b" services/judge/internal/app/service.go | head -20
```

### Step 2: Write engine.go

```go
package dispatcher

import "context"

// Engine is the evaluation engine port. The stub is used by default; the Judge0
// adapter is enabled when JUDGE_ENGINE=judge0 (gVisor gate required).
type Engine interface {
    // Submit sends one evaluation unit to the engine. Returns an opaque token.
    Submit(ctx context.Context, req UnitRequest) (token string, err error)
    // Poll returns the verdict for a token. Returns nil verdict if not yet ready.
    Poll(ctx context.Context, token string) (*UnitVerdict, error)
}

type UnitRequest struct {
    Language      string
    SourceCode    string
    Stdin         string
    TimeLimitMS   int
    MemLimitKB    int
    ExpectedOutput string
}

type UnitVerdict struct {
    Status        string // "accepted", "wrong_answer", "time_limit_exceeded", etc.
    Stdout        string
    Stderr        string
    CompileOutput string
    TimeMS        int
    MemoryKB      int
}
```

### Step 3: Write stub.go

```go
package judge0

import (
    "context"
    "fmt"
    "sync"
    "time"

    "github.com/aethercode/aethercode/services/judge/internal/dispatcher"
)

// Stub is a fake evaluation engine that returns "accepted" after a short delay.
// Safe for concurrent use.
type Stub struct {
    mu      sync.Mutex
    counter int
}

func NewStub() *Stub { return &Stub{} }

func (s *Stub) Submit(_ context.Context, _ dispatcher.UnitRequest) (string, error) {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.counter++
    return fmt.Sprintf("stub-token-%d", s.counter), nil
}

func (s *Stub) Poll(_ context.Context, token string) (*dispatcher.UnitVerdict, error) {
    // Stub immediately returns accepted — no polling needed
    return &dispatcher.UnitVerdict{
        Status: "accepted",
        TimeMS: 42,
        MemoryKB: 1024,
    }, nil
}
```

### Step 4: Commit

```bash
git add services/judge/internal/dispatcher/ services/judge/internal/adapters/judge0/
git commit -m "feat: add judge engine port interface and stub implementation"
```

---

## Task 2: Dispatcher worker

**Files:**
- Create: `services/judge/internal/dispatcher/store.go`
- Create: `services/judge/internal/dispatcher/worker.go`
- Create: `services/judge/internal/dispatcher/runtime.go`
- Create: `services/judge/internal/dispatcher/worker_test.go`

### Step 1: Read what repo methods exist

```bash
grep -n "func.*Postgres\|func (p " services/judge/internal/adapters/repo/postgres.go | head -30
```

### Step 2: Write store.go

The store interface wraps the repo operations the dispatcher needs:

```go
package dispatcher

import "context"

// Store is the dispatcher's database port.
type Store interface {
    // FetchQueuedJob loads a queued job and its units, claiming it for dispatch
    // with FOR UPDATE SKIP LOCKED so two workers never double-dispatch.
    FetchQueuedJob(ctx context.Context, jobID string) (*DispatchJob, error)
    // RecordToken persists the engine token for a unit so polling survives a crash.
    RecordToken(ctx context.Context, unitID, token string) error
    // RecordVerdict writes the final verdict for one unit.
    RecordVerdict(ctx context.Context, unitID string, verdict UnitVerdict) error
    // MarkJobComplete transitions the job to terminal state after all units complete.
    MarkJobComplete(ctx context.Context, jobID, overallStatus string) error
    // FetchIncompleteTokens returns units that have a token but no verdict —
    // these need polling resumed after a crash.
    FetchIncompleteTokens(ctx context.Context) ([]PendingUnit, error)
}

type DispatchJob struct {
    ID    string
    Units []DispatchUnit
}

type DispatchUnit struct {
    ID         string
    SourceCode string
    Language   string
    Stdin      string
    TimeLimitMS int
    MemLimitKB  int
    ExpectedOutput string
    Token      string // non-empty if already submitted before a crash
}

type PendingUnit struct {
    ID    string
    JobID string
    Token string
}
```

### Step 3: Write runtime.go

```go
package dispatcher

import (
    "fmt"
    "os"
    "strconv"
    "strings"
    "time"
)

type Runtime struct {
    Enabled         bool
    EngineType      string // "stub" or "judge0"
    Concurrency     int
    PollIntervalMS  int
    MaxPollAttempts int
}

func LoadRuntime() (Runtime, error) {
    env := func(name, def string) string {
        if v := os.Getenv(name); v != "" { return v }
        return def
    }
    intEnv := func(name string, def int) (int, error) {
        s := os.Getenv(name)
        if s == "" { return def, nil }
        v, err := strconv.Atoi(s)
        if err != nil {
            return 0, fmt.Errorf("dispatcher: %s must be an integer: %w", name, err)
        }
        return v, nil
    }

    r := Runtime{
        Enabled:    strings.EqualFold(env("JUDGE_DISPATCHER_ENABLED", "false"), "true"),
        EngineType: env("JUDGE_ENGINE", "stub"),
    }
    var err error
    if r.Concurrency, err = intEnv("JUDGE_WORKER_CONCURRENCY", 4); err != nil { return Runtime{}, err }
    if r.PollIntervalMS, err = intEnv("JUDGE_POLL_INTERVAL_MS", 2000); err != nil { return Runtime{}, err }
    if r.MaxPollAttempts, err = intEnv("JUDGE_MAX_POLL_ATTEMPTS", 30); err != nil { return Runtime{}, err }

    if r.Enabled {
        if r.EngineType != "stub" && r.EngineType != "judge0" {
            return Runtime{}, fmt.Errorf("dispatcher: JUDGE_ENGINE must be stub or judge0, got %q", r.EngineType)
        }
        if r.Concurrency < 1 || r.Concurrency > 32 {
            return Runtime{}, fmt.Errorf("dispatcher: JUDGE_WORKER_CONCURRENCY must be 1-32")
        }
        if r.MaxPollAttempts < 1 {
            return Runtime{}, fmt.Errorf("dispatcher: JUDGE_MAX_POLL_ATTEMPTS must be >= 1")
        }
    }
    return r, nil
}
```

### Step 4: Write worker.go

```go
package dispatcher

import (
    "context"
    "fmt"
    "log/slog"
    "time"
)

type Worker struct {
    store   Store
    engine  Engine
    runtime Runtime
    logger  *slog.Logger
}

func NewWorker(store Store, engine Engine, runtime Runtime, logger *slog.Logger) (*Worker, error) {
    if !runtime.Enabled {
        return nil, fmt.Errorf("dispatcher: cannot create worker with disabled runtime")
    }
    return &Worker{store: store, engine: engine, runtime: runtime, logger: logger}, nil
}

// DispatchJob fetches a queued job by ID and dispatches all its units to the engine.
func (w *Worker) DispatchJob(ctx context.Context, jobID string) error {
    job, err := w.store.FetchQueuedJob(ctx, jobID)
    if err != nil {
        return fmt.Errorf("fetch job %s: %w", jobID, err)
    }
    if job == nil {
        // Already dispatched or doesn't exist
        return nil
    }

    overallStatus := "accepted"
    for _, unit := range job.Units {
        token := unit.Token
        if token == "" {
            req := UnitRequest{
                Language:       unit.Language,
                SourceCode:     unit.SourceCode,
                Stdin:          unit.Stdin,
                TimeLimitMS:    unit.TimeLimitMS,
                MemLimitKB:     unit.MemLimitKB,
                ExpectedOutput: unit.ExpectedOutput,
            }
            token, err = w.engine.Submit(ctx, req)
            if err != nil {
                return fmt.Errorf("submit unit %s: %w", unit.ID, err)
            }
            if err := w.store.RecordToken(ctx, unit.ID, token); err != nil {
                return fmt.Errorf("record token for unit %s: %w", unit.ID, err)
            }
        }

        verdict, err := w.pollUntilDone(ctx, token)
        if err != nil {
            return fmt.Errorf("poll unit %s: %w", unit.ID, err)
        }

        if err := w.store.RecordVerdict(ctx, unit.ID, *verdict); err != nil {
            return fmt.Errorf("record verdict for unit %s: %w", unit.ID, err)
        }

        if verdict.Status != "accepted" {
            overallStatus = verdict.Status
        }
    }

    return w.store.MarkJobComplete(ctx, job.ID, overallStatus)
}

func (w *Worker) pollUntilDone(ctx context.Context, token string) (*UnitVerdict, error) {
    for attempt := 0; attempt < w.runtime.MaxPollAttempts; attempt++ {
        verdict, err := w.engine.Poll(ctx, token)
        if err != nil {
            return nil, err
        }
        if verdict != nil {
            return verdict, nil
        }
        select {
        case <-ctx.Done():
            return nil, ctx.Err()
        case <-time.After(time.Duration(w.runtime.PollIntervalMS) * time.Millisecond):
        }
    }
    return &UnitVerdict{Status: "time_limit_exceeded"}, nil
}
```

### Step 5: Write worker_test.go

```go
package dispatcher

import (
    "context"
    "errors"
    "testing"
)

type fakeStore struct {
    job     *DispatchJob
    tokens  map[string]string
    verdicts map[string]UnitVerdict
    completed map[string]string
    err     error
}

func (s *fakeStore) FetchQueuedJob(_ context.Context, jobID string) (*DispatchJob, error) {
    if s.err != nil { return nil, s.err }
    if s.job != nil && s.job.ID == jobID { return s.job, nil }
    return nil, nil
}
func (s *fakeStore) RecordToken(_ context.Context, unitID, token string) error {
    if s.tokens == nil { s.tokens = make(map[string]string) }
    s.tokens[unitID] = token; return nil
}
func (s *fakeStore) RecordVerdict(_ context.Context, unitID string, v UnitVerdict) error {
    if s.verdicts == nil { s.verdicts = make(map[string]UnitVerdict) }
    s.verdicts[unitID] = v; return nil
}
func (s *fakeStore) MarkJobComplete(_ context.Context, jobID, status string) error {
    if s.completed == nil { s.completed = make(map[string]string) }
    s.completed[jobID] = status; return nil
}
func (s *fakeStore) FetchIncompleteTokens(_ context.Context) ([]PendingUnit, error) { return nil, nil }

type fakeEngine struct{}
func (e *fakeEngine) Submit(_ context.Context, _ UnitRequest) (string, error) { return "tok-1", nil }
func (e *fakeEngine) Poll(_ context.Context, _ string) (*UnitVerdict, error) {
    return &UnitVerdict{Status: "accepted", TimeMS: 50, MemoryKB: 512}, nil
}

func testRuntime() Runtime {
    return Runtime{Enabled: true, EngineType: "stub", Concurrency: 2, PollIntervalMS: 0, MaxPollAttempts: 3}
}

func TestWorkerDispatchesJob(t *testing.T) {
    t.Parallel()
    store := &fakeStore{job: &DispatchJob{
        ID: "job-1",
        Units: []DispatchUnit{{ID: "unit-1", Language: "go", SourceCode: "package main", TimeLimitMS: 2000, MemLimitKB: 65536}},
    }}
    worker, err := NewWorker(store, &fakeEngine{}, testRuntime(), slog.New(slog.NewTextHandler(io.Discard, nil)))
    if err != nil { t.Fatal(err) }
    if err := worker.DispatchJob(context.Background(), "job-1"); err != nil {
        t.Fatalf("DispatchJob() error = %v", err)
    }
    if store.completed["job-1"] != "accepted" {
        t.Fatalf("job status = %q, want accepted", store.completed["job-1"])
    }
}

func TestNewWorkerRejectsDisabledRuntime(t *testing.T) {
    t.Parallel()
    r := testRuntime()
    r.Enabled = false
    if _, err := NewWorker(&fakeStore{}, &fakeEngine{}, r, slog.Default()); err == nil {
        t.Fatal("NewWorker accepted disabled runtime")
    }
}

func TestWorkerStoreError(t *testing.T) {
    t.Parallel()
    store := &fakeStore{err: errors.New("db down")}
    worker, _ := NewWorker(store, &fakeEngine{}, testRuntime(), slog.Default())
    if err := worker.DispatchJob(context.Background(), "job-x"); err == nil {
        t.Fatal("DispatchJob() error = nil, want store error")
    }
}
```

Add `"io"`, `"log/slog"`, `"errors"` imports.

### Step 6: Build and test

```bash
cd services/judge && go test ./internal/dispatcher/ -v
```

### Step 7: Wire into the consumer

The RabbitMQ consumer reads `{"job_id": "<uuid>"}` messages. Add an AMQP consumer that:
1. Declares the same `judge-admissions` queue
2. Consumes messages
3. Calls `worker.DispatchJob(ctx, jobID)`
4. ACKs on success, NACKs with requeue on transient error

Create `services/judge/internal/adapters/amqp/dispatcher_consumer.go` modeled on the existing `admission_publisher.go`.

### Step 8: Wire the consumer into main.go

In `services/judge/cmd/server/main.go`, conditionally start the dispatcher consumer when `JUDGE_DISPATCHER_ENABLED=true`.

### Step 9: Full build + lint + commit

```bash
cd /home/shreesh/Documents/AlgoQX
export PATH="$HOME/.local/go/bin:$HOME/go/bin:$PATH"
mkdir -p ~/.cache/aethercode-tmp && export TMPDIR=$HOME/.cache/aethercode-tmp GOTMPDIR=$HOME/.cache/aethercode-tmp
make build && make test && make lint
git add services/judge/
git commit -m "feat: add judge dispatcher worker with stub engine support"
```

---

## Completion checklist

- [ ] `JUDGE_DISPATCHER_ENABLED=false` (default): server starts normally, no dispatcher
- [ ] `JUDGE_DISPATCHER_ENABLED=true JUDGE_ENGINE=stub`: dispatcher runs, processes a job
- [ ] Worker tests pass without RabbitMQ or DB
- [ ] `make build`, `make test`, `make lint` pass
- [ ] `services/judge/README.md` documents the new config vars
