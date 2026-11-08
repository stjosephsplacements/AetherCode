# Execution Engine Bottlenecks & Lessons for Rust Rewrite

Documented from 22 production readiness runs on a 256-core / 512GB campus
server, loadtesting with 200–1000 concurrent students, and engine-check
verification across C, C++, Python and Java.

---

## Architecture (current Go engine, v95dec85)

```
Redis queue (ac:submissions:run/submit)
  → N worker goroutines (AC_WORKER_COUNT)
    → sandbox (go-judge v1.13.0, nsjail/cgroup)
      → compile + execute per test case
```

- **Queue**: Redis streams with consumer groups. One stream per submission type
  (run = sample tests, submit = full hidden tests, bulk = batch re-grade).
- **Workers**: fixed pool of goroutines, each pops one job from Redis and runs
  it synchronously through the sandbox.
- **Sandbox**: nsjail-based process isolation, cgroups for CPU/memory limits.
  Each test case is a separate sandbox invocation.

---

## Measured Bottlenecks

### 1. Worker count too low (was 8 on 256 cores)

**Problem**: `AC_WORKER_COUNT=8` meant only 8 programs execute at a time.
With 200 students submitting 2 runs each (400 judge calls), and each run
taking ~1.5s in the sandbox, the queue backed up.

**Impact**: p95 verdict time was 3s at 200 students. At 1000, the queue
depth hit 8000+ and students waited minutes.

**Fix applied**: bumped to 64 workers. The Rust engine should auto-detect
available cores and default to `num_cpus / 4` (each worker uses ~2-4 threads
for compile + execution).

**Rust lesson**: use `num_cpus::get()` for default worker count, expose
`--workers` flag, never hardcode a small default. Consider a work-stealing
scheduler (tokio, rayon) instead of a fixed pool.

### 2. Stale queue entries not expired

**Problem**: when the engine restarts, Redis queue entries from before the
restart remain. The engine re-processes them even if the caller timed out.
With `AC_ADMISSION_MAX_QUEUE_DEPTH=10000`, the queue accumulated thousands
of stale entries across restarts.

**Impact**: 8361 stale entries in `ac:submissions:run` queue. New submissions
wait behind stale ones, causing verdicts to be slow even when the engine is
idle.

**Fix needed**: on startup, purge queue entries older than `AC_JOB_TIMEOUT`
(90s). Or use Redis TTL on queue entries.

**Rust lesson**: use Redis `XTRIM` with MINID on startup to evict entries
older than the job timeout. Add a startup log line: "purged N stale entries
from queue."

### 3. No per-test parallelism within a job

**Problem**: `AC_TEST_PARALLELISM=4` limits how many test cases of one
submission run simultaneously. A question with 10 hidden tests runs them
4-at-a-time, taking 3× longer than if all 10 ran in parallel.

**Impact**: verdict time is proportional to ceil(test_count / parallelism).
With 10 tests at 2s each and parallelism 4: 6s vs 2s if fully parallel.

**Fix applied**: bumped to 8. But the real fix is per-language parallelism
based on the language's resource footprint (C/C++ is cheap, Java is heavy).

**Rust lesson**: run all test cases for one submission in parallel (bounded
by a per-job semaphore). Use language-specific concurrency hints:
- C/C++/Rust: unlimited (cheap processes)
- Python/JS: 8× (GIL doesn't apply across processes)
- Java/C#: 4× (JVM startup is memory-heavy, ~200MB per sandbox)

### 4. Compile-once-run-many not implemented

**Problem**: each test case in a submission triggers a separate compile +
execute. For compiled languages (C, C++, Java, Rust), the same source is
compiled N times.

**Impact**: a 10-test submission compiles 10 times. Compile takes 200-500ms
per test for C++, so 2-5s wasted on redundant compilation.

**Fix needed**: compile once, cache the binary, run it against each test
case. The cache key is `sha256(source + language + compiler_flags)`.

**Rust lesson**: first-class compile cache with `AC_COMPILE_CACHE_TTL` (was
60s in the Go engine but not effectively used for multi-test submissions).
Store compiled binaries in a tmpfs-backed LRU cache. For the same source,
skip compilation and execute the cached binary directly.

### 5. Java JDK not installed in sandbox image

**Problem**: the engine reports Java as `available: true` in its language
catalogue, but the JDK is not installed in the sandbox filesystem.

**Impact**: every Java submission fails with `compile_error`. engine-check
skips Java.

**Fix**: include JDK in the sandbox image. For the Rust engine, ship language
runtimes as separate overlay filesystems that mount on demand.

**Rust lesson**: make language support pluggable. Each language is a config
entry with: compiler binary path, compile command template, execute command
template, and required filesystem overlays. Missing binaries → language
marked `unavailable` at startup (not `available: true` with runtime errors).

### 6. SEB validation as a gateway-level synchronous HTTP call

**Problem**: the gateway validates every `/api/submission/*` request against
the SEB service via a synchronous HTTP call. Under 1000 concurrent students,
the SEB service becomes the bottleneck (not the engine).

**Impact**: 539 out of 1000 students hit SEB validation timeouts at load.
The SEB check takes ~5ms normally but p99 goes to 6+ seconds under load.

**This is NOT an engine issue** but affects engine throughput indirectly
because students can't submit code to the engine fast enough.

**Fix**: move SEB validation into the submission service (in-process check,
no HTTP hop) or cache the SEB-required status per exam in the gateway.

### 7. Redis single-consumer bottleneck

**Problem**: all workers in one engine instance compete for the same Redis
consumer group. Redis XREADGROUP with COUNT=1 per worker creates contention.

**Impact**: at 64 workers, the Redis consumer becomes a serialization point.
Workers spend time waiting for their turn to pop from the queue instead of
executing code.

**Rust lesson**: use batch reads (`XREADGROUP COUNT=N` where N is the worker
count) and distribute in-process via a bounded channel. This amortizes the
Redis round-trip across N jobs.

### 8. No graceful degradation under overload

**Problem**: when the queue depth exceeds capacity, the engine accepts all
jobs. Callers see increasing latency with no backpressure signal.

**Impact**: at 1000 students, queue depth was 8000+. No admission control
means the first students get fast verdicts and later students wait indefinitely.

**Rust lesson**: implement admission control:
- Reject new jobs when queue depth > 2× worker count (return 503 immediately)
- The caller (judge service) retries with backoff
- Expose queue depth as a Prometheus metric for autoscaling triggers

### 9. No warm-up or connection pooling

**Problem**: first submissions after a restart are slower because sandbox
cgroups and mount namespaces are created from scratch.

**Impact**: cold-start penalty of ~200ms on the first execution.

**Rust lesson**: pre-warm N sandbox environments at startup. Create cgroup
hierarchies and mount points during initialization, not on first use.

---

## Performance targets for Rust rewrite

Based on the 256-core / 512GB server and 1000-student exam:

| Metric | Current (Go, 64 workers) | Target (Rust) |
|--------|--------------------------|---------------|
| p50 verdict (200 students) | 1.5s | < 500ms |
| p95 verdict (200 students) | 3.0s | < 1s |
| p50 verdict (1000 students) | 3.1s | < 1s |
| p95 verdict (1000 students) | 5.0s | < 2s |
| p50 API latency | 10ms | < 5ms |
| Max concurrent students | ~400 clean | 5000+ |
| Worker auto-scaling | manual env var | automatic based on cores |
| Compile cache hit rate | 0% (no cache) | > 90% for multi-test |

## Configuration the Rust engine should expose

```toml
[engine]
workers = 0          # 0 = auto (num_cpus / 4)
queue_max_depth = 0  # 0 = auto (workers * 4)
job_timeout = "90s"
compile_cache_ttl = "5m"
compile_cache_max_mb = 1024

[sandbox]
type = "nsjail"      # or "firecracker" for microVM isolation
pre_warm = 16        # warm sandbox slots at startup
cgroup_version = "v2"

[languages.c]
compiler = "/usr/bin/gcc"
compile_cmd = "gcc -O2 -o {output} {source}"
execute_cmd = "./{output}"
parallelism = 0      # 0 = unlimited (per-job, bounded by workers)

[languages.java]
compiler = "/usr/bin/javac"
compile_cmd = "javac {source}"
execute_cmd = "java -Xmx256m Main"
parallelism = 4      # JVM is memory-heavy
overlay = "jdk-21"   # filesystem overlay for the sandbox
```
