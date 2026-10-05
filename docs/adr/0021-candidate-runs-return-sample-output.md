# ADR-0021: Candidate runs return sample-test output

- Status: accepted
- Date: 2026-10-05

## Context

Milestone M3 needs **Run**: during an exam a student runs their code against
the question's sample tests and sees, per test, the input, the expected
output, their program's output, and any compile or runtime error. The exam
app (ADR-0016) does this, and its rule is that full input/output is shown for
sample tests only; hidden tests expose a verdict and nothing else.

The platform already pins a sample bundle (only the sample tests) next to the
evaluation bundle (every test) on each exam item, projects both into
Submission, and has a `code_runs`/`code_run_units` schema (Submission 000019).
What it lacked was a way for output to come back: the engines return stdout,
stderr and compile output, but Judge discards them, and its completion
carries per-test verdicts only. Judge's `execution_units` table has had
`raw_result_ciphertext_ref`/`raw_result_sha256` columns from the start for an
encrypted per-test result object, never populated.

## Decision

1. **The bundle declares its visibility.** `evalbundle.BuildSample` writes
   `"visibility": "sample"`; Question Bank builds every sample bundle with it.
   `evalbundle.Parse` reports it. A bundle without the field is not a sample
   bundle.
2. **Judge returns output only for sample bundles.** Fan-out records the
   bundle's visibility on the job (`execution_jobs.returns_output`). For such
   a job, as each test's verdict is recorded, Judge encrypts one
   `evalbundle.UnitOutput` (stdin, expected output, stdout, stderr, compile
   output; each truncated to 64 KiB) with KMS, stores it in object storage,
   and keeps the reference, checksum and key reference on the unit row. Pull
   returns the three per unit. No plaintext reaches Judge's database, and a
   job on an evaluation or hidden bundle produces no output object at all, so
   a caller mistake that pointed a run at the wrong bundle still cannot leak
   hidden output.
3. **Submission runs.** A candidate starts a run on an item of their own
   active attempt with `{language, source}`, up to the deadline plus the
   answer grace. Submission encrypts and stores the source as it does for
   answers, records a queued `code_run`, and its dispatcher submits it to
   Judge with the item's sample bundle. Runs are claimed like evaluation
   requests (leases with backoff) and are rate limited per candidate.
4. **Completions are routed by job.** The completion bridge asks whether a
   completion's job belongs to a code run. If so, it fetches and decrypts
   each unit's output object and records the run's units (with their output)
   in one routine; otherwise the existing grading path applies. A run never
   writes evaluation requests, Judge receipts or score summaries.

## Consequences

- Students get the exam app's Run: per-test input, expected and actual
  output, and compile errors, for sample tests only.
- Sample bundles built before this change have no visibility marker, so a run
  on them reports verdicts without output until the question's tests are
  saved again.
- Run output is stored in plaintext in Submission's `code_run_units`. Sample
  tests are not confidential, and the rows are bounded by the 64 KiB
  truncation. Purging old runs (`code_runs.purge_after`) is not implemented
  yet.
- Custom input (running against stdin the student types) is not part of this
  decision; it would need a single-test bundle built per run.
