# Test-Case Fan-Out Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unpack a submission's evaluation bundle into individual `judge.execution_units` rows at job-admission time, so the dispatcher (which already fans out per-unit and records per-unit verdicts) has real per-test-case work to do instead of an empty unit list.

**Architecture:** Define a JSON bundle format (none exists today — the bundle has always been treated as one opaque blob by every consumer in this codebase) and a fan-out step, invoked from the same transaction that creates a `judge.execution_jobs` row, that decrypts the bundle, parses N test cases, re-encrypts each one individually, uploads each as its own object, and inserts N `judge.execution_units` rows referencing them.

**Tech Stack:** Go 1.26.7, pgx/v5, existing `libs/pkg/storage`/`libs/pkg/kms` ports.

**Spec:** `docs/superpowers/specs/2026-08-24-judge0-execution-and-run-code-design.md` (Phase B)

## Global Constraints

- Go module path for shared code is `github.com/aethercode/aethercode/libs/pkg`.
- No placeholders, stub bodies, `TODO` comments, or fake data may be committed.
- Every new SQL function is `REVOKE ALL ... FROM PUBLIC` then granted only to its intended role.
- Every migration ships a paired `.down.sql`. `make test-migrations` verifies fresh-apply, rollback, reapply.
- Tests are table-driven and call `t.Parallel()`.
- Commits use Conventional Commits.
- **Environment (mandatory on every Go command):**
  `export PATH="$HOME/.local/go/bin:$HOME/go/bin:$PATH"`,
  `export TMPDIR="$HOME/.cache/aethercode-tmp"`, `export GOTMPDIR="$HOME/.cache/aethercode-tmp"`.

---

## Design

### The bundle format (newly defined by this plan)

No format exists anywhere in this codebase today — `evaluation_bundle_object_key` has always been an opaque reference nothing parses. This plan establishes:

```json
{
  "schema_version": 1,
  "test_cases": [
    { "stdin": "5\n3\n", "expected_output": "8\n" },
    { "stdin": "10\n-2\n", "expected_output": "8\n" }
  ]
}
```

The whole bundle is encrypted as one object (same KMS mechanism as everything else in this platform), consistent with how it's referenced today (`evaluation_bundle_object_key` + `evaluation_bundle_sha256` — one key, one checksum, one encrypted blob). `schema_version` allows the format to evolve later without breaking old bundles mid-flight. This plan's fan-out step is the **first and only** consumer of this format — whatever produces bundles (exam authoring tooling, entirely outside this backend today per the earlier audit finding that no bundle-assembler code exists anywhere) needs to be told to emit this shape, but that's a documentation/coordination concern, not code this plan can enforce from the consuming side beyond validating the shape strictly and failing clearly on anything else.

### Why re-encrypt per test case rather than store plaintext

`judge.execution_units.test_case_ciphertext_ref` (existing column, already read by the dispatcher's `FetchQueuedJob`) is a ciphertext reference, not plaintext — the schema was already built assuming each unit's test-case content is independently encrypted and stored. This plan honors that: after decrypting the bundle once, each individual test case gets re-encrypted (via the existing `kms.KeyManager.Encrypt`) and uploaded as its own object (via `storage.Object.Put`) before its `execution_units` row is inserted. This keeps a leaked/compromised single test case's ciphertext from exposing any other test case, and matches the "narrowest blast radius" posture the rest of this platform's encryption boundaries already follow.

### Where this runs

`services/judge/internal/adapters/repo/postgres.go`'s `Postgres.Submit` currently inserts one `judge.execution_jobs` row and returns — no `execution_units` are created. This plan adds the fan-out as a step in that same method, inside the same transaction, so a job is never left in a state where it exists but has zero units (which would make it un-dispatchable and stuck forever).

---

## Task 1: Bundle parsing and validation

**Files:**
- Create: `services/judge/internal/bundle/bundle.go`
- Test: `services/judge/internal/bundle/bundle_test.go`

**Interfaces:**
- Consumes: nothing
- Produces: `type TestCase struct { Stdin, ExpectedOutput string }`, `func Parse(plaintext []byte) ([]TestCase, error)`

- [ ] **Step 1: Write the failing test**

Create `services/judge/internal/bundle/bundle_test.go`:

```go
package bundle

import "testing"

func TestParseValidBundle(t *testing.T) {
	t.Parallel()
	input := []byte(`{
		"schema_version": 1,
		"test_cases": [
			{"stdin": "5\n3\n", "expected_output": "8\n"},
			{"stdin": "10\n-2\n", "expected_output": "8\n"}
		]
	}`)
	testCases, err := Parse(input)
	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}
	if len(testCases) != 2 {
		t.Fatalf("Parse() returned %d test cases, want 2", len(testCases))
	}
	if testCases[0].Stdin != "5\n3\n" || testCases[0].ExpectedOutput != "8\n" {
		t.Fatalf("Parse()[0] = %+v, want stdin=%q expected_output=%q", testCases[0], "5\n3\n", "8\n")
	}
}

func TestParseRejectsUnsupportedSchemaVersion(t *testing.T) {
	t.Parallel()
	input := []byte(`{"schema_version": 99, "test_cases": [{"stdin": "1", "expected_output": "1"}]}`)
	if _, err := Parse(input); err == nil {
		t.Fatal("Parse() with schema_version 99 error = nil, want an error")
	}
}

func TestParseRejectsEmptyTestCases(t *testing.T) {
	t.Parallel()
	input := []byte(`{"schema_version": 1, "test_cases": []}`)
	if _, err := Parse(input); err == nil {
		t.Fatal("Parse() with zero test cases error = nil, want an error")
	}
}

func TestParseRejectsMalformedJSON(t *testing.T) {
	t.Parallel()
	if _, err := Parse([]byte("not json")); err == nil {
		t.Fatal("Parse() with malformed JSON error = nil, want an error")
	}
}

func TestParseRejectsExcessiveTestCaseCount(t *testing.T) {
	t.Parallel()
	testCases := make([]map[string]string, 501)
	for i := range testCases {
		testCases[i] = map[string]string{"stdin": "x", "expected_output": "x"}
	}
	encoded, err := json.Marshal(map[string]any{"schema_version": 1, "test_cases": testCases})
	if err != nil {
		t.Fatalf("marshal fixture: %v", err)
	}
	if _, err := Parse(encoded); err == nil {
		t.Fatal("Parse() with 501 test cases error = nil, want an error (bound against runaway resource use)")
	}
}
```

Add `"encoding/json"` to the test file's imports for the last test case.

- [ ] **Step 2: Run to verify it fails**

Run: `cd services/judge && go test ./internal/bundle/... -v`
Expected: FAIL — package does not exist.

- [ ] **Step 3: Write the parser**

Create `services/judge/internal/bundle/bundle.go`:

```go
// Package bundle parses the evaluation bundle format: one JSON document
// listing the test cases for a question, encrypted as a single object and
// referenced by evaluation_bundle_object_key. This is the only consumer of
// this format in the codebase; anything that assembles a bundle for upload
// must emit exactly this shape.
package bundle

import (
	"encoding/json"
	"fmt"
)

// maxTestCases bounds resource use during fan-out — an author authoring a
// pathologically large bundle should not be able to make one submission
// dispatch thousands of Judge0 units.
const maxTestCases = 500

const supportedSchemaVersion = 1

// TestCase is one stdin/expected-output pair from a parsed bundle.
type TestCase struct {
	Stdin          string
	ExpectedOutput string
}

type rawBundle struct {
	SchemaVersion int `json:"schema_version"`
	TestCases     []struct {
		Stdin          string `json:"stdin"`
		ExpectedOutput string `json:"expected_output"`
	} `json:"test_cases"`
}

// Parse decodes and validates a decrypted evaluation bundle. plaintext must
// already be decrypted — this package has no knowledge of encryption.
func Parse(plaintext []byte) ([]TestCase, error) {
	var raw rawBundle
	if err := json.Unmarshal(plaintext, &raw); err != nil {
		return nil, fmt.Errorf("bundle: decode: %w", err)
	}
	if raw.SchemaVersion != supportedSchemaVersion {
		return nil, fmt.Errorf("bundle: unsupported schema_version %d, want %d", raw.SchemaVersion, supportedSchemaVersion)
	}
	if len(raw.TestCases) == 0 {
		return nil, fmt.Errorf("bundle: must contain at least one test case")
	}
	if len(raw.TestCases) > maxTestCases {
		return nil, fmt.Errorf("bundle: contains %d test cases, exceeds the limit of %d", len(raw.TestCases), maxTestCases)
	}
	testCases := make([]TestCase, len(raw.TestCases))
	for i, rawCase := range raw.TestCases {
		testCases[i] = TestCase{Stdin: rawCase.Stdin, ExpectedOutput: rawCase.ExpectedOutput}
	}
	return testCases, nil
}
```

- [ ] **Step 4: Run to verify tests pass**

Run: `cd services/judge && go test ./internal/bundle/... -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/judge/internal/bundle/
git commit -m "feat: define and parse the evaluation bundle format"
```

---

## Task 2: Fan-out into execution_units

**Files:**
- Modify: `services/judge/internal/adapters/repo/postgres.go`
- Test: `services/judge/internal/adapters/repo/postgres_fanout_test.go`

**Interfaces:**
- Consumes: `bundle.Parse([]byte) ([]bundle.TestCase, error)` from Task 1; `storage.Object.Get`/`Put`, `kms.KeyManager.Decrypt`/`Encrypt` (existing ports, already wired into `Postgres` per question-bank's identical pattern — confirm `Postgres` in judge's repo package already has `storage`/`kms` fields; if not, this task adds them to its constructor, matching how `services/question-bank/internal/app/service.go`'s `Service` struct already holds `storage storage.Object` and `kms kms.KeyManager` fields)
- Produces: fan-out logic invoked from `Postgres.Submit`, inserting rows into `judge.execution_units`

- [ ] **Step 1: Read the current Submit method and confirm storage/KMS wiring**

```bash
sed -n '1,140p' services/judge/internal/adapters/repo/postgres.go
grep -n "storage.Object\|kms.KeyManager\|NewPostgres" services/judge/internal/adapters/repo/postgres.go services/judge/cmd/server/main.go
```

If `Postgres` does not already have `storage`/`kms` fields, this step also requires adding them to its struct and `NewPostgres` constructor, and updating the one call site in `services/judge/cmd/server/main.go` to pass the already-constructed storage/KMS adapters (judge's `main.go` should already construct these somewhere for other purposes — search for `storage.` and `kms.` construction in that file; if judge's `main.go` doesn't construct them at all yet, this task adds that construction too, mirroring exactly how `services/question-bank/cmd/server/main.go` does it).

- [ ] **Step 2: Write the failing test**

Create `services/judge/internal/adapters/repo/postgres_fanout_test.go`. This tests the fan-out logic in isolation against fake storage/KMS implementations (not a real Testcontainers Postgres — that's covered by Task 3's integration test):

```go
package repo

import (
	"bytes"
	"context"
	"errors"
	"io"
	"testing"
)

type fakeStorage struct {
	objects map[string][]byte
	putErr  error
}

func newFakeStorage() *fakeStorage { return &fakeStorage{objects: make(map[string][]byte)} }

func (s *fakeStorage) Get(_ context.Context, key string) (io.ReadCloser, int64, error) {
	data, ok := s.objects[key]
	if !ok {
		return nil, 0, errors.New("object not found")
	}
	return io.NopCloser(bytes.NewReader(data)), int64(len(data)), nil
}

func (s *fakeStorage) Put(_ context.Context, key string, r io.Reader, _ int64, _ string) error {
	if s.putErr != nil {
		return s.putErr
	}
	data, err := io.ReadAll(r)
	if err != nil {
		return err
	}
	s.objects[key] = data
	return nil
}

func (s *fakeStorage) Delete(context.Context, string) error             { return nil }
func (s *fakeStorage) Exists(context.Context, string) (bool, error)     { return false, nil }
func (s *fakeStorage) PresignGet(context.Context, string, any) (string, error) { return "", nil }

type fakeKMS struct{}

// fakeKMS "encrypts" by reversing bytes and "decrypts" by reversing back —
// deterministic, reversible, and obviously not real encryption; sufficient
// for testing that plaintext survives an encrypt-then-decrypt round trip
// through the fan-out logic without depending on a real KMS.
func (fakeKMS) Encrypt(_ context.Context, plaintext []byte) ([]byte, string, error) {
	reversed := make([]byte, len(plaintext))
	for i, b := range plaintext {
		reversed[len(plaintext)-1-i] = b
	}
	return reversed, "fake-key-ref", nil
}

func (fakeKMS) Decrypt(_ context.Context, ciphertext []byte, _ string) ([]byte, error) {
	reversed := make([]byte, len(ciphertext))
	for i, b := range ciphertext {
		reversed[len(ciphertext)-1-i] = b
	}
	return reversed, nil
}

func TestFanOutTestCasesCreatesOneObjectPerTestCase(t *testing.T) {
	t.Parallel()
	storage := newFakeStorage()
	bundlePlaintext := []byte(`{"schema_version": 1, "test_cases": [
		{"stdin": "1\n", "expected_output": "1\n"},
		{"stdin": "2\n", "expected_output": "4\n"},
		{"stdin": "3\n", "expected_output": "9\n"}
	]}`)
	bundleCiphertext, _, err := fakeKMS{}.Encrypt(context.Background(), bundlePlaintext)
	if err != nil {
		t.Fatalf("encrypt fixture bundle: %v", err)
	}
	storage.objects["bundle-key"] = bundleCiphertext

	refs, err := fanOutTestCases(context.Background(), storage, fakeKMS{}, "bundle-key", "bundle-key-ref", "job-123")
	if err != nil {
		t.Fatalf("fanOutTestCases() error = %v", err)
	}
	if len(refs) != 3 {
		t.Fatalf("fanOutTestCases() returned %d refs, want 3", len(refs))
	}
	// Every ref must point at a distinct, independently stored object.
	seen := make(map[string]bool)
	for _, ref := range refs {
		if seen[ref.ObjectKey] {
			t.Fatalf("duplicate object key %q across units", ref.ObjectKey)
		}
		seen[ref.ObjectKey] = true
		if _, ok := storage.objects[ref.ObjectKey]; !ok {
			t.Fatalf("ref %q does not correspond to a stored object", ref.ObjectKey)
		}
	}
}

func TestFanOutTestCasesPropagatesStorageError(t *testing.T) {
	t.Parallel()
	storage := newFakeStorage()
	storage.putErr = errors.New("storage unavailable")
	bundlePlaintext := []byte(`{"schema_version": 1, "test_cases": [{"stdin": "1", "expected_output": "1"}]}`)
	bundleCiphertext, _, _ := fakeKMS{}.Encrypt(context.Background(), bundlePlaintext)
	storage.objects["bundle-key"] = bundleCiphertext

	if _, err := fanOutTestCases(context.Background(), storage, fakeKMS{}, "bundle-key", "ref", "job-123"); err == nil {
		t.Fatal("fanOutTestCases() error = nil, want the storage error propagated")
	}
}
```

Read `libs/pkg/storage/storage.go`'s exact `PresignGet` signature before finalizing `fakeStorage` — its return type in the interface must match exactly (`(string, error)` with an `expiry time.Duration` parameter, not `any`; fix the stub above to match the real signature once you've read it).

- [ ] **Step 3: Run to verify it fails**

Run: `cd services/judge && go test ./internal/adapters/repo/... -run TestFanOut -v`
Expected: FAIL — `fanOutTestCases` is not defined.

- [ ] **Step 4: Write the fan-out function**

Add to `services/judge/internal/adapters/repo/postgres.go` (or a new file `services/judge/internal/adapters/repo/fanout.go` if that keeps `postgres.go` from growing unwieldy — check its current line count with `wc -l services/judge/internal/adapters/repo/postgres.go` first; if it's already large, prefer the new file):

```go
// unitObjectRef identifies one test case's independently encrypted storage
// object, produced by fanOutTestCases and consumed when inserting
// judge.execution_units rows.
type unitObjectRef struct {
	UnitNumber int
	ObjectKey  string
	KeyRef     string
}

// fanOutTestCases decrypts one evaluation bundle and re-encrypts each test
// case it contains as its own independently stored object, so a single
// leaked ciphertext exposes only one test case rather than the whole bundle.
// jobID scopes the generated object keys so concurrent jobs never collide.
func fanOutTestCases(
	ctx context.Context,
	objectStorage storage.Object,
	keyManager kms.KeyManager,
	bundleObjectKey, bundleKeyRef, jobID string,
) ([]unitObjectRef, error) {
	reader, _, err := objectStorage.Get(ctx, bundleObjectKey)
	if err != nil {
		return nil, fmt.Errorf("fan-out: fetch bundle: %w", err)
	}
	defer func() { _ = reader.Close() }()
	ciphertext, err := io.ReadAll(reader)
	if err != nil {
		return nil, fmt.Errorf("fan-out: read bundle: %w", err)
	}
	plaintext, err := keyManager.Decrypt(ctx, ciphertext, bundleKeyRef)
	if err != nil {
		return nil, fmt.Errorf("fan-out: decrypt bundle: %w", err)
	}
	testCases, err := bundle.Parse(plaintext)
	if err != nil {
		return nil, fmt.Errorf("fan-out: parse bundle: %w", err)
	}

	refs := make([]unitObjectRef, 0, len(testCases))
	for i, testCase := range testCases {
		unitPlaintext, err := json.Marshal(struct {
			Stdin          string `json:"stdin"`
			ExpectedOutput string `json:"expected_output"`
		}{Stdin: testCase.Stdin, ExpectedOutput: testCase.ExpectedOutput})
		if err != nil {
			return nil, fmt.Errorf("fan-out: encode unit %d: %w", i, err)
		}
		unitCiphertext, keyRef, err := keyManager.Encrypt(ctx, unitPlaintext)
		if err != nil {
			return nil, fmt.Errorf("fan-out: encrypt unit %d: %w", i, err)
		}
		objectKey := fmt.Sprintf("judge/execution-units/%s/%d", jobID, i)
		if err := objectStorage.Put(ctx, objectKey, bytes.NewReader(unitCiphertext), int64(len(unitCiphertext)), "application/json"); err != nil {
			return nil, fmt.Errorf("fan-out: store unit %d: %w", i, err)
		}
		refs = append(refs, unitObjectRef{UnitNumber: i, ObjectKey: objectKey, KeyRef: keyRef})
	}
	return refs, nil
}
```

Add `"bytes"`, `"encoding/json"`, `"io"`, and the `bundle`/`storage`/`kms` package imports as needed.

- [ ] **Step 5: Run to verify tests pass**

Run: `cd services/judge && go test ./internal/adapters/repo/... -run TestFanOut -v`
Expected: PASS.

- [ ] **Step 6: Wire fan-out into Submit and insert execution_units rows**

In `Postgres.Submit`, after the existing `INSERT INTO judge.execution_jobs` succeeds within the same transaction: call `fanOutTestCases`, then for each returned ref, `INSERT INTO judge.execution_units (id, job_id, unit_number, test_case_ciphertext_ref, state) VALUES ($1, $2, $3, $4, 'pending')` (generate each unit's `id` via `database.NewUUIDv7()`; confirm `state`'s exact allowed values by reading the `judge.execution_units` CHECK constraint in `services/judge/migrations/000001_judge_control_schema.up.sql` first — use whatever the schema's initial-state value actually is, don't assume `'pending'` is correct without checking). If fan-out fails, the whole transaction must roll back — no job should ever exist with a partially-populated or zero unit list.

Note: `unitObjectRef.KeyRef` (the per-unit encryption key reference) needs somewhere to live — check whether `judge.execution_units` has an `encryption_key_reference`-shaped column already (re-read the table's full column list from the migration); if it doesn't, this is a gap this task must also close with a small migration adding one nullable-until-populated column, following the exact style of every other `encryption_key_reference` column elsewhere in this codebase (`char` type, non-null check pattern matching `qbank.test_case_manifests.encryption_key_reference`).

- [ ] **Step 7: Full verification and commit**

```bash
cd services/judge && go build ./... && go test ./... -v
cd /home/shreesh/Documents/AlgoQX && make build && make test && make vet && make fmt-check && make lint && make test-migrations
git add services/judge/
git commit -m "feat: fan out evaluation bundles into per-test-case execution units"
```

---

## Task 3: Integration test proving the full fan-out path

**Files:**
- Test: `services/judge/internal/adapters/repo/postgres_integration_test.go` (already exists from Wave 1 — add to it, don't replace it)

**Interfaces:**
- Consumes: everything from Tasks 1-2
- Produces: nothing consumed by later work

- [ ] **Step 1: Read the existing integration test file**

```bash
cat services/judge/internal/adapters/repo/postgres_integration_test.go
```

This file already exists from an earlier plan (Wave 1's Task 6) and proves an access-boundary property against a real Testcontainers Postgres. Add a new test function to it — do not replace the existing one.

- [ ] **Step 2: Write the integration test**

Add `TestSubmitFansOutBundleIntoExecutionUnits` to the same file: seed a real (fake in-memory storage + fake KMS, or a MinIO Testcontainer if one is easily available in this repo's `libs/pkg/testutil` — check first) evaluation bundle with 3 test cases, call `Postgres.Submit`, then query `judge.execution_units WHERE job_id = $1` directly and assert exactly 3 rows exist with `unit_number` 0, 1, 2 and distinct `test_case_ciphertext_ref` values.

- [ ] **Step 3: Run and verify**

Run: `cd services/judge && go test -tags=integration ./internal/adapters/repo/... -v -run TestSubmitFansOutBundleIntoExecutionUnits`
Expected: PASS.

- [ ] **Step 4: Full verification and commit**

```bash
cd /home/shreesh/Documents/AlgoQX && make test-integration
git add services/judge/internal/adapters/repo/postgres_integration_test.go
git commit -m "test: prove bundle fan-out creates one execution unit per test case"
```

---

## Completion checklist

- [ ] `bundle.Parse` validates schema version, non-empty, and bounded test-case count
- [ ] `fanOutTestCases` decrypts a bundle once, re-encrypts each test case independently, uploads each as its own object
- [ ] `Postgres.Submit` inserts one `judge.execution_units` row per test case, in the same transaction as the job row — no job is ever created with zero units
- [ ] Fan-out failure rolls back the whole submission, not leaving a half-created job
- [ ] `make build`, `test`, `test-integration`, `vet`, `fmt-check`, `lint`, `test-migrations` all pass

## Notes for the executor

**On the bundle format being new.** This is the first time this format is specified anywhere. If Task 1's read of `services/question-bank/internal/app/service.go` or its migrations turns up ANY existing bundle-assembly logic that contradicts this plan's assumed format (the earlier audit found none, but re-verify — code changes), stop and report the discrepancy rather than proceeding with two incompatible formats.

**On `execution_units.state`'s initial value.** Do not guess this — read the actual CHECK constraint. Getting it wrong means every fanned-out unit fails its first `UPDATE` in `RecordToken`/`RecordVerdict`.
