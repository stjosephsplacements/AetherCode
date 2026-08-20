# Judge Dispatcher — Design Spec (Sub-project J)

Date: 2026-08-20
Sub-project: J
Status: active

## Problem

`services/judge/internal/adapters/amqp/admission_publisher.go` publishes pointer-only
wake-ups to RabbitMQ, but there is no consumer. Evaluation requests are durably
persisted in the judge control-plane DB but never sent to Judge0. Code submissions
queue forever.

This sub-project writes the dispatcher/worker that reads from RabbitMQ, submits
code to Judge0, polls for the verdict, and publishes a terminal completion event.
The gVisor gate blocks enabling the real Judge0 engine; the dispatcher is written
against a port interface and tested against a stub engine.

## Architecture

### The admission pointer queue

`admission_publisher.go` publishes messages of the form:
```json
{"evaluation_request_id": "<uuid>"}
```
to a RabbitMQ exchange. The dispatcher consumes from it.

### Worker structure (mirrors notification retention worker)

```
services/judge/internal/dispatcher/
  port.go          — Engine port interface + stub
  store.go         — Store wrapping judge control-plane DB
  worker.go        — Worker: consume pointer, fetch request, submit, poll, complete
  runtime.go       — Runtime config loaded from env
  worker_test.go   — Tests against stub Engine + fake Store
```

### Engine port interface

```go
type Engine interface {
    // Submit sends one evaluation request to the engine and returns an opaque
    // token the caller uses to poll for the result.
    Submit(ctx context.Context, req EvaluationRequest) (token string, err error)

    // Poll returns the current verdict for a previously submitted token.
    // Returns (nil, nil) if the verdict is not yet available.
    Poll(ctx context.Context, token string) (*Verdict, error)
}

type EvaluationRequest struct {
    Language   string
    SourceCode string
    Stdin      string
    TimeLimitMS  int
    MemLimitKB   int
}

type Verdict struct {
    Status      string // "accepted", "wrong_answer", "tle", "mle", "re", "ce"
    Stdout      string
    Stderr      string
    CompileOutput string
    TimeMS      int
    MemoryKB    int
}
```

### Judge0 adapter (gVisor-gated)

`services/judge/internal/adapters/judge0/client.go` implements `Engine` against
the Judge0 HTTP API. It is compiled but not enabled until the gVisor gate passes.
The worker reads `JUDGE_ENGINE=stub` (default) or `JUDGE_ENGINE=judge0` from env.
`stub` uses a test double that returns "accepted" after 100ms.

### Completion flow

```
RabbitMQ pointer message
  → dispatcher.Worker reads pointer
  → store.FetchRequest(ctx, id) — load evaluation_request from judge DB
  → engine.Submit(ctx, req) — send to stub or Judge0
  → store.RecordToken(ctx, id, token) — persist so a crash can resume polling
  → poll loop: engine.Poll(ctx, token) every 2s, up to configured timeout
  → store.Complete(ctx, id, verdict) — write terminal state in judge DB
  → completion bridge in submission picks up the terminal event via outbox
  → RabbitMQ ack
```

Crash recovery: on startup, the worker queries `store.FetchIncompleteTokens()`
and resumes polling for any requests that have a token but no terminal state.

### Retry and fairness

- `FOR UPDATE SKIP LOCKED` in `FetchRequest` prevents two workers double-processing.
- If Submit fails transiently, the RabbitMQ message is NACKed and re-queued.
- If Poll times out (code took longer than the allowed wall-clock limit), the
  worker writes a "timed_out" verdict and ACKs.
- Dead-letter queue captures messages that fail 5 times.

## Configuration

```
JUDGE_ENGINE=stub                          # stub | judge0
JUDGE_WORKER_CONCURRENCY=4                 # parallel submissions
JUDGE_POLL_INTERVAL_MS=2000
JUDGE_MAX_POLL_ATTEMPTS=30                 # 30 × 2s = 60s wall-clock timeout
JUDGE0_ENDPOINT=http://localhost:2358      # only used when ENGINE=judge0
JUDGE0_AUTH_TOKEN=                         # only used when ENGINE=judge0
```

## Files created/modified

| Path | Action |
|---|---|
| `services/judge/internal/dispatcher/port.go` | Create |
| `services/judge/internal/dispatcher/store.go` | Create |
| `services/judge/internal/dispatcher/worker.go` | Create |
| `services/judge/internal/dispatcher/runtime.go` | Create |
| `services/judge/internal/dispatcher/worker_test.go` | Create |
| `services/judge/internal/adapters/judge0/client.go` | Create (gVisor-gated) |
| `services/judge/cmd/server/main.go` | Wire dispatcher into server |
| `services/judge/README.md` | Document dispatcher config |

## Definition of done

- `make build`, `make test`, `make lint` pass.
- With `JUDGE_ENGINE=stub`, submitting an evaluation request results in a
  "accepted" terminal verdict written to the judge DB within 5 seconds.
- The completion bridge in submission picks up the verdict event.
- The dispatcher survives a worker crash mid-poll (token is persisted; restarted
  worker resumes polling without re-submitting).
