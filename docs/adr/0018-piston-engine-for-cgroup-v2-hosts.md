# ADR-0018: Piston engine for cgroup v2 hosts

- Status: accepted
- Date: 2026-10-03

## Context

The campus server runs Ubuntu 24.04 with cgroup v2 and is shared with other
services. Judge0 1.13.1's isolate sandbox requires cgroup v1, which needs a
kernel parameter and a reboot of the whole machine. The exam app already used
Piston as its fallback engine on cgroup v2 hosts; Piston ran C, C++, Java and
Python correctly on this server.

## Decision

1. The judge gets a second engine adapter, `internal/adapters/piston`, behind
   the same `dispatcher.Engine` port and the same compatibility gate
   (`JUDGE_ENGINE_COMPATIBILITY_APPROVED`). `JUDGE_ENGINE=piston` selects it.
2. Piston has no submission queue, so `Submit` runs the unit synchronously and
   `Poll` returns the verdict kept in memory. A verdict lost to a restart
   between the two resolves to `internal_error`, the same as an engine outage.
3. The adapter compares output itself with the exam app's rule (normalized line
   endings, trailing whitespace and trailing blank lines).
4. The single-server stack runs Piston by default; Judge0 stays available with
   `--profile judge0` and `JUDGE_ENGINE=judge0` on cgroup v1 hosts.

## Consequences

- Exams can run on the shared server without a reboot.
- Piston's container is privileged, like Judge0's. Its network must stay
  internal to the stack.
- Piston has no compile-once batching; each test case compiles again. The
  load test (M8) decides whether batching is needed before a 1000-student exam.
