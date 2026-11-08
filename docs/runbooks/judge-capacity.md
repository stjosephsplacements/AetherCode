# Judge capacity sizing

How to size the code execution engine for the number of students taking exams
at the same time.

## Current numbers

From `make loadtest --students 1000` on the campus server (single engine
instance):

| Students | p50 verdict | p95 verdict | Max verdict | API steps |
|----------|-------------|-------------|-------------|-----------|
| 200      | ~4 s        | ~8 s        | ~15 s       | < 100 ms  |
| 1,000    | ~12 s       | 33 s        | 93 s        | < 100 ms  |

API steps (start attempt, save code, run, submit) are milliseconds regardless
of load. The bottleneck is the engine: how many programs it can compile and
run at once.

## What affects verdict time

1. **Engine concurrency**: how many containers or workers run in parallel. Each
   student submission compiles and runs once per test case; a question with 10
   hidden tests makes 10 engine calls.
2. **Time limit per test**: set per question (typically 1-2 s). A 2 s limit on
   10 tests is 20 s of wall clock per submission if they run sequentially.
3. **Judge fairness key**: each college gets a `TenantFairnessKey` that limits
   its share of engine capacity. One college cannot starve another.
4. **Model check vs exam runs**: `practiceFairnessKey` and model checks use
   separate admission keys, so practice and authoring do not compete with exams.

## Sizing for an exam slot

Estimate the peak concurrent submissions:

```
peak = students × submissions_per_student × overlap
```

A 2-hour exam with 5 questions: most students submit each question once,
with a burst at the end (overlap ~ 0.3 for the last 15 minutes). For 500
students: `500 × 1 × 0.3 = 150` concurrent submissions.

Each submission fans out into `hidden_test_count` engine units. At 10 tests
per question: 1,500 engine units in the burst.

If the engine runs 50 programs at a time with a 2 s time limit each, it
processes `50 / 2 = 25` units per second, clearing 1,500 units in 60 s
(p95 ~60 s verdict). Double the engine to 100 workers: p95 ~30 s.

## Recommendations

| Slot size | Engine workers | Expected p95 |
|-----------|---------------|--------------|
| 200       | 30            | < 10 s       |
| 500       | 50            | < 30 s       |
| 1,000     | 100           | < 30 s       |
| 2,000     | 200           | < 30 s       |

Workers scale linearly. The campus server's single engine instance handles
1,000 at p95 33 s. A second engine instance (or more CPU) halves that.

## How to scale

The engine runs outside the Kubernetes cluster (ADR-0028). To add capacity:

1. Run another engine instance on the same or a different machine.
2. Point the judge at both: the judge's dispatcher distributes jobs across all
   configured engine URLs.
3. Monitor from `/admin/incidents` (grading queue depth) and the loadtest
   (`make loadtest --students N`).

## Monitoring

- **Staff status page** (`/staff/status`): shows grading queue depth and
  verdicts per hour for each college.
- **Admin incidents** (`/admin/incidents`): warns when the oldest waiting job
  exceeds 2 minutes (warning) or 10 minutes (critical).
- **Loadtest**: `STUDENTS=1000 RAMP=60 make loadtest` — never during a real exam.
