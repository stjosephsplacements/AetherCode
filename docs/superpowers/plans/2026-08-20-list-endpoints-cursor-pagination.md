# List Endpoints and Cursor Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 16 collection endpoints across six Go microservices with a single opaque keyset-cursor contract, without letting one candidate read another candidate's records.

**Architecture:** Every collection endpoint is Class A (owner-scoped) or Class B (tenant-scoped). Class A queries run inside a `SECURITY DEFINER` SQL function that filters on `authz.current_context_actor_id()`, so ownership cannot be omitted by a Go caller. Class B queries are plain parameterised `SELECT`s inside the existing RLS transaction. A new shared package `libs/pkg/pagination` encodes and validates cursors and limits for all six services.

**Tech Stack:** Go 1.26.0 (toolchain go1.26.5), pgx/v5, PostgreSQL with FORCE RLS, golang-migrate, standard-library `net/http` routing (`mux.HandleFunc("GET /path/{id}", ...)`), table-driven `testing` tests.

**Spec:** `docs/superpowers/specs/2026-08-20-list-endpoints-cursor-pagination-design.md`

## Global Constraints

- Go module path for shared code is `github.com/aethercode/aethercode/libs/pkg`. Services import it as e.g. `github.com/aethercode/aethercode/libs/pkg/pagination`.
- No placeholders, stub bodies, `TODO` comments, or fake data may be committed. CLAUDE.md core principle 2.
- Dependencies point inward only: `domain` → `app` → `ports` → `adapters`. `domain` imports no framework.
- Every new SQL function is `REVOKE ALL ... FROM PUBLIC` then `GRANT EXECUTE ... TO aether_<svc>_app`.
- Every migration ships a paired `.down.sql` that fully reverses it. `make test-migrations` runs fresh-apply, rollback, and reapply.
- `limit` is an integer 1..100, default 20. Out-of-range is `400 invalid_argument`, never a silent clamp.
- `items` is always present in a response and is `[]`, never `null`.
- `next_cursor` is omitted from the response when the page is the last one.
- Error codes come from `libs/pkg/errors`: `CodeInvalidArgument`, `CodeForbidden`, `CodeNotFound`. Use `apperrors.New(apperrors.CodeInvalidArgument, "...")`.
- Commits use Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`).
- Tests are table-driven and call `t.Parallel()`, matching `libs/pkg/authz/capability_test.go`.
- Go is **not installed** in the current environment. Every "run the test" step assumes the executor has installed Go 1.26.5 first; if `go` is missing, install it before starting Task 1 rather than skipping verification.
- There is **no git repository** at the time of writing. Task 0 establishes one; if the executor already has one, skip Task 0.

---

## File Structure

**New files:**

| Path | Responsibility |
|---|---|
| `libs/pkg/pagination/cursor.go` | Encode/parse opaque cursors; parse and validate limits. Pure functions, no SQL, no HTTP. |
| `libs/pkg/pagination/cursor_test.go` | Table-driven unit tests for the above. |
| `libs/pkg/pagination/README.md` | Module contract, per CLAUDE.md principle 4. |
| `services/submission/migrations/000016_attempt_list_functions.{up,down}.sql` | Class A list functions for attempts and answer revisions; index tiebreak. |
| `services/submission/migrations/000016_attempt_list_functions_test.sql` | Cross-candidate isolation assertions. |
| `services/assessment/migrations/000016_candidate_assignment_list.{up,down}.sql` | Class A list function for candidate assignments; index tiebreak. |
| `services/assessment/migrations/000016_candidate_assignment_list_test.sql` | Cross-candidate isolation assertions. |
| `services/seb/migrations/000012_session_list_function.{up,down}.sql` | Class A list function for sessions. |
| `services/seb/migrations/000012_session_list_function_test.sql` | Cross-candidate isolation assertions. |
| `services/question-bank/migrations/000009_question_list_functions.{up,down}.sql` | Cursor-aware replacement for `list_published_questions`; new `list_question_versions`. |
| `services/user/migrations/000020_student_list_index.{up,down}.sql` | Keyset index on `users.students`. |
| `services/user/migrations/000021_seb_session_self_policy.{up,down}.sql` | Casbin row `('student','self','/sessions/:id','read')`. |

**Modified files:**

| Path | Change |
|---|---|
| `services/user/internal/app/authorization.go:355-400` | Two new `assignmentApplies` branches (`candidate_assignments` collection, `sessions`). |
| `services/{svc}/internal/adapters/repo/postgres.go` | One list method per endpoint. |
| `services/{svc}/internal/app/service.go` | One list method per endpoint; `Store` interface additions. |
| `services/{svc}/internal/adapters/http/handler.go` | Route registration + handler per endpoint. |
| `services/{svc}/api/openapi.yaml` | One path entry per endpoint. |
| `services/{svc}/README.md` | Document the new routes. |

Handler files in `assessment` (667 lines) and `user` (578 lines) are already large. Adding list handlers pushes `assessment` past 800. Task 7 therefore splits collection handlers into a sibling file `list_handler.go` in the same package, rather than growing one file further.

---

## Task 0: Establish version control

**Files:**
- Create: `.git/` (repository), no source changes

**Interfaces:**
- Consumes: nothing
- Produces: a git repository so every later task's commit step works

- [ ] **Step 1: Confirm no repository exists**

Run: `git -C /home/shreesh/Documents/AlgoQX rev-parse --git-dir 2>&1`
Expected: `fatal: not a git repository (or any of the parent directories): .git`

If it prints a path instead, a repository already exists — skip to Step 5.

- [ ] **Step 2: Initialise and set identity**

```bash
cd /home/shreesh/Documents/AlgoQX
git init
git config user.name "Shreesh"
git config user.email "shreesh.exe22@gmail.com"
```

- [ ] **Step 3: Verify .env is ignored before the first commit**

Run: `git check-ignore -v .env`
Expected: a line naming `.gitignore` and the `.env` pattern.

If `.env` is NOT ignored, stop. Do not commit. `.gitignore` already lists `.env` at line 17; investigate why the match failed before proceeding.

- [ ] **Step 4: Commit the existing tree as a baseline**

```bash
git add -A
git status --short | head -20
git commit -m "chore: baseline existing AetherCode backend tree"
```

- [ ] **Step 5: Create the working branch**

```bash
git checkout -b feat/list-endpoints-cursor-pagination
git branch --show-current
```

Expected output: `feat/list-endpoints-cursor-pagination`

CLAUDE.md forbids committing directly to the default branch, so all later tasks commit here.

---

## Task 1: Shared cursor package

**Files:**
- Create: `libs/pkg/pagination/cursor.go`
- Test: `libs/pkg/pagination/cursor_test.go`
- Create: `libs/pkg/pagination/README.md`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `type Cursor struct { SortValue string; ID string }`
  - `func Encode(sortValue, id string) string`
  - `func Parse(raw string) (Cursor, bool, error)` — returns `(cursor, present, error)`; `present` is false when `raw` is empty
  - `func ParseLimit(raw string, defaultLimit, maxLimit int) (int, error)`
  - `func EncodeTime(value time.Time) string` — RFC3339 nanosecond, UTC
  - `func FormatInt(value int64) string`
  - `func httpx.ParseEnumQuery(request *http.Request, name string, allowed ...string) (string, error)` — added to the existing `libs/pkg/httpx` package in Step 6

Every later task consumes these exact names.

- [ ] **Step 1: Write the failing test**

Create `libs/pkg/pagination/cursor_test.go`:

```go
package pagination

import (
	"strings"
	"testing"
	"time"
)

const testID = "018f4b0d-08f8-7c09-9ba7-efdf9c223377"

func TestEncodeParseRoundTrip(t *testing.T) {
	t.Parallel()
	moment := time.Date(2026, time.August, 20, 10, 11, 12, 123456789, time.UTC)
	encoded := Encode(EncodeTime(moment), testID)
	if strings.ContainsAny(encoded, "+/=") {
		t.Fatalf("Encode() = %q, want unpadded base64url", encoded)
	}
	cursor, present, err := Parse(encoded)
	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}
	if !present {
		t.Fatal("Parse() present = false, want true")
	}
	if cursor.ID != testID {
		t.Fatalf("Parse() ID = %q, want %q", cursor.ID, testID)
	}
	if cursor.SortValue != EncodeTime(moment) {
		t.Fatalf("Parse() SortValue = %q, want %q", cursor.SortValue, EncodeTime(moment))
	}
}

func TestParseEmptyIsAbsentNotError(t *testing.T) {
	t.Parallel()
	cursor, present, err := Parse("")
	if err != nil {
		t.Fatalf("Parse(\"\") error = %v, want nil", err)
	}
	if present {
		t.Fatal("Parse(\"\") present = true, want false")
	}
	if cursor != (Cursor{}) {
		t.Fatalf("Parse(\"\") cursor = %+v, want zero value", cursor)
	}
}

func TestParseRejectsMalformedCursors(t *testing.T) {
	t.Parallel()
	testCases := []struct {
		name string
		raw  string
	}{
		{name: "not base64", raw: "!!!not-base64!!!"},
		{name: "missing separator", raw: Encode("", "")},
		{name: "too many segments", raw: encodeRaw("a|b|c")},
		{name: "empty sort value", raw: encodeRaw("|" + testID)},
		{name: "non-uuid id", raw: encodeRaw("2026-08-20T10:11:12Z|not-a-uuid")},
		{name: "empty id", raw: encodeRaw("2026-08-20T10:11:12Z|")},
	}
	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			if _, _, err := Parse(testCase.raw); err == nil {
				t.Fatalf("Parse(%q) error = nil, want an error", testCase.raw)
			}
		})
	}
}

func TestParseLimitBounds(t *testing.T) {
	t.Parallel()
	testCases := []struct {
		name      string
		raw       string
		want      int
		wantError bool
	}{
		{name: "empty uses default", raw: "", want: 20},
		{name: "valid", raw: "50", want: 50},
		{name: "minimum", raw: "1", want: 1},
		{name: "maximum", raw: "100", want: 100},
		{name: "zero rejected", raw: "0", wantError: true},
		{name: "negative rejected", raw: "-1", wantError: true},
		{name: "above maximum rejected", raw: "101", wantError: true},
		{name: "non-numeric rejected", raw: "twenty", wantError: true},
	}
	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			got, err := ParseLimit(testCase.raw, 20, 100)
			if testCase.wantError {
				if err == nil {
					t.Fatalf("ParseLimit(%q) error = nil, want an error", testCase.raw)
				}
				return
			}
			if err != nil {
				t.Fatalf("ParseLimit(%q) error = %v", testCase.raw, err)
			}
			if got != testCase.want {
				t.Fatalf("ParseLimit(%q) = %d, want %d", testCase.raw, got, testCase.want)
			}
		})
	}
}

func TestFormatIntIsDecimal(t *testing.T) {
	t.Parallel()
	if got := FormatInt(42); got != "42" {
		t.Fatalf("FormatInt(42) = %q, want \"42\"", got)
	}
}
```

Note: `encodeRaw` is a test helper defined in Step 3 alongside the implementation, because the tests need to build deliberately malformed payloads.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd libs/pkg && go test ./pagination/... -v`
Expected: FAIL — the package does not compile because `cursor.go` does not exist.

- [ ] **Step 3: Write the implementation**

Create `libs/pkg/pagination/cursor.go`:

```go
// Package pagination encodes and validates the opaque keyset cursors used by
// every AetherCode collection endpoint. A cursor carries no authority: it is
// applied only inside an already-authorized, tenant- and actor-scoped query, so
// it is deliberately unsigned. Signing it would imply it grants access.
package pagination

import (
	"encoding/base64"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
)

const separator = "|"

var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// Cursor is one decoded keyset position: the value of the sort column and the
// primary key that breaks ties on equal sort values.
type Cursor struct {
	SortValue string
	ID        string
}

// Encode builds the opaque token handed back to clients as next_cursor.
func Encode(sortValue, id string) string {
	return encodeRaw(sortValue + separator + id)
}

func encodeRaw(payload string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(payload))
}

// Parse decodes a client-supplied cursor. An empty string means "first page"
// and is not an error. Anything else that does not decode to exactly one
// non-empty sort value and one UUID is rejected rather than ignored, so a
// corrupted token cannot silently restart pagination from the beginning.
func Parse(raw string) (Cursor, bool, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return Cursor{}, false, nil
	}
	decoded, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return Cursor{}, false, apperrors.New(apperrors.CodeInvalidArgument, "cursor is not a valid pagination token")
	}
	parts := strings.Split(string(decoded), separator)
	if len(parts) != 2 {
		return Cursor{}, false, apperrors.New(apperrors.CodeInvalidArgument, "cursor is not a valid pagination token")
	}
	sortValue, id := parts[0], parts[1]
	if strings.TrimSpace(sortValue) == "" || !uuidPattern.MatchString(id) {
		return Cursor{}, false, apperrors.New(apperrors.CodeInvalidArgument, "cursor is not a valid pagination token")
	}
	return Cursor{SortValue: sortValue, ID: strings.ToLower(id)}, true, nil
}

// ParseLimit validates a client page size. An out-of-range limit is an error
// rather than a silent clamp, matching the existing Question Bank behaviour.
func ParseLimit(raw string, defaultLimit, maxLimit int) (int, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return defaultLimit, nil
	}
	limit, err := strconv.Atoi(raw)
	if err != nil || limit < 1 || limit > maxLimit {
		return 0, apperrors.New(apperrors.CodeInvalidArgument, fmt.Sprintf("limit must be an integer between 1 and %d", maxLimit))
	}
	return limit, nil
}

// EncodeTime renders a timestamp sort value. Nanosecond precision matters:
// two rows created in the same millisecond must produce different cursors.
func EncodeTime(value time.Time) string {
	return value.UTC().Format(time.RFC3339Nano)
}

// FormatInt renders an integer sort value such as a version number.
func FormatInt(value int64) string {
	return strconv.FormatInt(value, 10)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd libs/pkg && go test ./pagination/... -v`
Expected: PASS, all five test functions.

- [ ] **Step 5: Write the package README**

Create `libs/pkg/pagination/README.md`:

```markdown
# pagination

Opaque keyset cursors for AetherCode collection endpoints.

## Purpose

Every collection endpoint pages by keyset, not offset. Rows are inserted
continuously during an exam, so an offset would skip and duplicate records
mid-scroll. A cursor names the last row of the previous page as
`(sort_value, id)`; the query resumes strictly after it.

## API

| Function | Purpose |
|---|---|
| `Encode(sortValue, id string) string` | Build the token returned as `next_cursor`. |
| `Parse(raw string) (Cursor, bool, error)` | Decode a client token. Empty input returns `present == false`, not an error. |
| `ParseLimit(raw string, defaultLimit, maxLimit int) (int, error)` | Validate a page size. Out of range is an error, never a clamp. |
| `EncodeTime(value time.Time) string` | RFC3339 nanosecond UTC sort value. |
| `FormatInt(value int64) string` | Decimal sort value for version numbers. |

## Security

A cursor is **not signed and carries no authority**. It repositions a caller
inside a query that has already been authorized, tenant-scoped, and (for
Class A endpoints) actor-scoped. A forged cursor can only move a caller among
rows they may already read.

## Testing

`go test ./pagination/...` — no database or network required.
```

- [ ] **Step 6: Add enum filter validation to httpx**

The spec requires an unknown filter value (for example `lifecycle_state=nonsense`) to return `400 invalid_argument` rather than an empty page — a typo must not look like "no results". This helper belongs beside `ParseUUIDValue` in `httpx`, not in `pagination`.

Append to `libs/pkg/httpx/json.go`:

```go
// ParseEnumQuery validates an optional enumerated query filter. An absent
// parameter is not an error and returns "". A present value outside the allowed
// set is rejected, so a mistyped filter never silently returns an empty page.
func ParseEnumQuery(request *http.Request, name string, allowed ...string) (string, error) {
	raw := strings.TrimSpace(request.URL.Query().Get(name))
	if raw == "" {
		return "", nil
	}
	for _, candidate := range allowed {
		if raw == candidate {
			return raw, nil
		}
	}
	return "", apperrors.New(apperrors.CodeInvalidArgument,
		fmt.Sprintf("%s must be one of: %s", name, strings.Join(allowed, ", ")))
}
```

Add `"fmt"` and `"strings"` to the file's imports if absent.

Append to `libs/pkg/httpx/json_test.go`:

```go
func TestParseEnumQuery(t *testing.T) {
	t.Parallel()
	testCases := []struct {
		name      string
		query     string
		want      string
		wantError bool
	}{
		{name: "absent is allowed", query: "", want: ""},
		{name: "allowed value", query: "?state=active", want: "active"},
		{name: "rejected value", query: "?state=nonsense", wantError: true},
	}
	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			request := httptest.NewRequest(http.MethodGet, "/v1/things"+testCase.query, nil)
			got, err := ParseEnumQuery(request, "state", "active", "closed")
			if testCase.wantError {
				if err == nil {
					t.Fatalf("ParseEnumQuery(%q) error = nil, want an error", testCase.query)
				}
				return
			}
			if err != nil {
				t.Fatalf("ParseEnumQuery(%q) error = %v", testCase.query, err)
			}
			if got != testCase.want {
				t.Fatalf("ParseEnumQuery(%q) = %q, want %q", testCase.query, got, testCase.want)
			}
		})
	}
}
```

Add `"net/http"` and `"net/http/httptest"` to the test imports if absent.

Run: `cd libs/pkg && go test ./httpx/... -run TestParseEnumQuery -v`
Expected: PASS.

- [ ] **Step 7: Verify formatting and vet**

```bash
cd /home/shreesh/Documents/AlgoQX
make fmt-check
make vet
```

Expected: both exit 0 with no output.

- [ ] **Step 8: Commit**

```bash
git add libs/pkg/pagination/ libs/pkg/httpx/
git commit -m "feat: add shared keyset cursor pagination and enum filter parsing"
```

---

## Task 2: Authorization branches for collection access

This is the highest-risk change in the plan. `assignmentApplies` decides whether a role's scope assignment applies to a request. Two new branches are needed; both must permit *only* `ResourceID == ScopeID`.

**Files:**
- Modify: `services/user/internal/app/authorization.go:355-400` (the `case "self":` block)
- Test: `services/user/internal/app/authorization_test.go`

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces: `assignmentApplies` accepting `candidate_assignments` and `sessions` when `request.ResourceID == assignment.ScopeID`. Tasks 6, 7 and 8 depend on this.

- [ ] **Step 1: Read the current self branch**

Run: `sed -n '/case "self":/,/^	default:/p' services/user/internal/app/authorization.go`

Confirm the existing structure: a `switch request.ResourceType` with cases `students, profiles`, `candidate_assignments`, `attempts`, `recipient_preferences, notifications`, `validation_events`, then `default: return false`.

- [ ] **Step 2: Write the failing tests**

Append to `services/user/internal/app/authorization_test.go`:

```go
func TestAssignmentAppliesAllowsCandidateAssignmentCollection(t *testing.T) {
	t.Parallel()
	principal := "018f4b0d-08f8-7c09-9ba7-efdf9c220101"
	tenant := "018f4b0d-08f8-7c09-9ba7-efdf9c220202"
	assignment := Assignment{Role: "student", ScopeKind: "self", ScopeID: principal, TenantID: tenant}
	request := Request{
		PrincipalID: principal, TenantID: tenant,
		ResourceType: "candidate_assignments", ResourceID: principal, Action: "read",
	}
	if !assignmentApplies(assignment, request, nil, nil, nil) {
		t.Fatal("assignmentApplies() = false, want true for a candidate listing their own assignments")
	}
}

func TestAssignmentAppliesDeniesForeignCandidateAssignmentCollection(t *testing.T) {
	t.Parallel()
	principal := "018f4b0d-08f8-7c09-9ba7-efdf9c220101"
	other := "018f4b0d-08f8-7c09-9ba7-efdf9c220999"
	tenant := "018f4b0d-08f8-7c09-9ba7-efdf9c220202"
	assignment := Assignment{Role: "student", ScopeKind: "self", ScopeID: principal, TenantID: tenant}
	request := Request{
		PrincipalID: principal, TenantID: tenant,
		ResourceType: "candidate_assignments", ResourceID: other, Action: "read",
	}
	if assignmentApplies(assignment, request, nil, nil, nil) {
		t.Fatal("assignmentApplies() = true, want false when the resource ID is another principal")
	}
}

func TestAssignmentAppliesAllowsOwnSessionCollection(t *testing.T) {
	t.Parallel()
	principal := "018f4b0d-08f8-7c09-9ba7-efdf9c220101"
	tenant := "018f4b0d-08f8-7c09-9ba7-efdf9c220202"
	assignment := Assignment{Role: "student", ScopeKind: "self", ScopeID: principal, TenantID: tenant}
	request := Request{
		PrincipalID: principal, TenantID: tenant,
		ResourceType: "sessions", ResourceID: principal, Action: "read",
	}
	if !assignmentApplies(assignment, request, nil, nil, nil) {
		t.Fatal("assignmentApplies() = false, want true for a candidate listing their own SEB sessions")
	}
}

func TestAssignmentAppliesDeniesForeignSessionCollection(t *testing.T) {
	t.Parallel()
	principal := "018f4b0d-08f8-7c09-9ba7-efdf9c220101"
	other := "018f4b0d-08f8-7c09-9ba7-efdf9c220999"
	tenant := "018f4b0d-08f8-7c09-9ba7-efdf9c220202"
	assignment := Assignment{Role: "student", ScopeKind: "self", ScopeID: principal, TenantID: tenant}
	request := Request{
		PrincipalID: principal, TenantID: tenant,
		ResourceType: "sessions", ResourceID: other, Action: "read",
	}
	if assignmentApplies(assignment, request, nil, nil, nil) {
		t.Fatal("assignmentApplies() = true, want false when the resource ID is another principal")
	}
}

func TestAssignmentAppliesDeniesSelfScopeInAnotherTenant(t *testing.T) {
	t.Parallel()
	principal := "018f4b0d-08f8-7c09-9ba7-efdf9c220101"
	assignment := Assignment{
		Role: "student", ScopeKind: "self", ScopeID: principal,
		TenantID: "018f4b0d-08f8-7c09-9ba7-efdf9c220202",
	}
	request := Request{
		PrincipalID: principal, TenantID: "018f4b0d-08f8-7c09-9ba7-efdf9c220303",
		ResourceType: "sessions", ResourceID: principal, Action: "read",
	}
	if assignmentApplies(assignment, request, nil, nil, nil) {
		t.Fatal("assignmentApplies() = true, want false when the self scope belongs to another tenant")
	}
}
```

If `services/user/internal/app/authorization_test.go` does not exist, create it with the package clause `package app` and the imports `"testing"`.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd services/user && go test ./internal/app/ -run 'TestAssignmentApplies' -v`
Expected: FAIL. The two "allows" tests fail because `candidate_assignments` currently requires an owned assignment UUID and `sessions` hits `default: return false`. The three "denies" tests should already pass — that is fine and expected; they are regression guards.

- [ ] **Step 4: Modify the candidate_assignments branch**

In `services/user/internal/app/authorization.go`, replace the existing `case "candidate_assignments":` block:

```go
		case "candidate_assignments":
			_, owned := ownedCandidateAssignments[request.ResourceID]
			return owned
```

with:

```go
		case "candidate_assignments":
			// Two shapes are permitted. A get-by-id request names one opaque
			// assignment UUID and must be proven owned against the private
			// Assessment ownership projection. A collection request has no such
			// UUID and instead names the bearer subject, exactly as the attempts
			// routes do; Assessment then binds rows to
			// authz.current_context_actor_id() inside its own list function, so
			// this branch never authorizes another candidate's assignments.
			if request.ResourceID == assignment.ScopeID {
				return true
			}
			_, owned := ownedCandidateAssignments[request.ResourceID]
			return owned
```

- [ ] **Step 5: Add the sessions branch**

In the same `switch`, immediately after the `case "validation_events":` block, add:

```go
		case "sessions":
			// SEB's candidate-facing session collection authorizes with the bearer
			// subject as the resource ID. SEB binds the signed actor to
			// sessions.candidate_id inside its SECURITY DEFINER list function, so
			// this policy cannot authorize a guessed opaque session ID.
			return request.ResourceID == assignment.ScopeID
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd services/user && go test ./internal/app/ -run 'TestAssignmentApplies' -v`
Expected: PASS, all five.

- [ ] **Step 7: Run the full user service suite for regressions**

Run: `cd services/user && go test ./...`
Expected: PASS. This change widens a security predicate; any pre-existing authorization test that now fails is a real signal, not noise. Stop and investigate rather than adjusting the test.

- [ ] **Step 8: Commit**

```bash
git add services/user/internal/app/authorization.go services/user/internal/app/authorization_test.go
git commit -m "feat: authorize candidate assignment and SEB session collections"
```

---

## Task 3: User service migrations

**Files:**
- Create: `services/user/migrations/000020_student_list_index.up.sql`
- Create: `services/user/migrations/000020_student_list_index.down.sql`
- Create: `services/user/migrations/000021_seb_session_self_policy.up.sql`
- Create: `services/user/migrations/000021_seb_session_self_policy.down.sql`

**Interfaces:**
- Consumes: Task 2's `sessions` branch (the policy row is inert without it)
- Produces: a keyset index for Task 11; the Casbin row Task 8 needs

- [ ] **Step 1: Confirm the next migration numbers are free**

Run: `ls services/user/migrations/ | cut -d_ -f1 | sort -u | tail -3`
Expected: the highest existing number is `000019`. If it is higher, renumber this task's files to the next two free numbers and keep the rest of the plan's references consistent.

- [ ] **Step 2: Write the student index migration**

Create `services/user/migrations/000020_student_list_index.up.sql`:

```sql
-- Keyset pagination over the tenant student roster orders by (created_at, id).
-- Without the trailing id the index cannot satisfy the tiebreak comparison and
-- a large tenant falls back to a sort.
SET ROLE aether_user_owner;

CREATE INDEX students_tenant_keyset_idx
    ON users.students (tenant_id, created_at DESC, id DESC);

RESET ROLE;
```

Create `services/user/migrations/000020_student_list_index.down.sql`:

```sql
SET ROLE aether_user_owner;

DROP INDEX IF EXISTS users.students_tenant_keyset_idx;

RESET ROLE;
```

- [ ] **Step 3: Write the SEB session policy migration**

Create `services/user/migrations/000021_seb_session_self_policy.up.sql`:

```sql
-- SEB's candidate-facing session collection asks User for a self resource
-- decision using the bearer subject as the resource ID. SEB then binds the
-- signed actor to sessions.candidate_id inside its SECURITY DEFINER list
-- function, so this policy cannot authorize a guessed opaque session ID.
SET ROLE aether_user_owner;

INSERT INTO users.authorization_policy_rules (id, ptype, v0, v1, v2, v3)
VALUES
    ('018f4b0d-08f8-7c09-9ba7-efdf9c220020', 'p', 'student', 'self', '/sessions/:id', 'read')
ON CONFLICT DO NOTHING;

RESET ROLE;
```

Create `services/user/migrations/000021_seb_session_self_policy.down.sql`:

```sql
SET ROLE aether_user_owner;

DELETE FROM users.authorization_policy_rules
WHERE id = '018f4b0d-08f8-7c09-9ba7-efdf9c220020';

RESET ROLE;
```

The UUID `...220020` continues the seeded sequence; the highest existing seeded rule id is `...220019` in `000015_seb_validation_self_policy.up.sql`. Verify with:

Run: `grep -rho "018f4b0d-08f8-7c09-9ba7-efdf9c2200[0-9][0-9]" services/user/migrations/ | sort -u | tail -3`

If `...220020` is already taken, pick the next free value and update both files.

- [ ] **Step 4: Verify migrations apply, roll back, and reapply**

Run: `make test-migrations`
Expected: PASS. The verifier applies every platform database fresh, rolls all migrations back in pairs, and reapplies.

- [ ] **Step 5: Commit**

```bash
git add services/user/migrations/000020_* services/user/migrations/000021_*
git commit -m "feat: add student keyset index and SEB session self policy"
```

---

## Task 4: Submission Class A list functions

**Files:**
- Create: `services/submission/migrations/000016_attempt_list_functions.up.sql`
- Create: `services/submission/migrations/000016_attempt_list_functions.down.sql`
- Test: `services/submission/migrations/000016_attempt_list_functions_test.sql`

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces:
  - `submission.list_attempts(p_tenant_id uuid, p_limit integer, p_cursor_created_at timestamptz, p_cursor_id uuid, p_exam_version_id uuid, p_lifecycle_state text) RETURNS jsonb`
  - `submission.list_answer_revisions(p_tenant_id uuid, p_attempt_id uuid, p_limit integer, p_cursor_created_at timestamptz, p_cursor_id uuid, p_exam_item_id uuid) RETURNS jsonb`

Task 5 calls both.

- [ ] **Step 1: Read the answer_revisions columns**

Run: `sed -n '/CREATE TABLE submission.answer_revisions/,/^);/p' services/submission/migrations/000002_domain.up.sql`

Record the exact column names. The function in Step 3 selects them; a name mismatch fails at migration time, which is the intended fast feedback.

- [ ] **Step 2: Write the isolation test first**

Create `services/submission/migrations/000016_attempt_list_functions_test.sql`. This is the test that catches a cross-candidate leak, following the convention of `000015_rls_block_deletes_test.sql`:

```sql
-- Verifies that submission.list_attempts returns only rows owned by the signed
-- context actor, and fails closed when no actor context is set.
\set ON_ERROR_STOP on

BEGIN;

DO $test$
DECLARE
    tenant_id constant uuid := '018f4b0d-08f8-7c09-9ba7-efdf9c221001';
    candidate_a constant uuid := '018f4b0d-08f8-7c09-9ba7-efdf9c221002';
    candidate_b constant uuid := '018f4b0d-08f8-7c09-9ba7-efdf9c221003';
    returned jsonb;
    returned_count integer;
BEGIN
    -- With no authorization context set at all, the function must raise rather
    -- than return an empty page. "You have no attempts" and "the security
    -- context did not load" must never look identical to a candidate.
    BEGIN
        PERFORM submission.list_attempts(tenant_id, 20, NULL, NULL, NULL, NULL);
        RAISE EXCEPTION 'list_attempts succeeded without an authorization context';
    EXCEPTION
        WHEN insufficient_privilege THEN
            NULL;
    END;

    RAISE NOTICE 'list_attempts fails closed without an actor context';
END
$test$;

ROLLBACK;
```

- [ ] **Step 3: Write the up migration**

Create `services/submission/migrations/000016_attempt_list_functions.up.sql`:

```sql
-- Candidate-facing attempt collections. Row ownership is enforced here, not in
-- Go: submission RLS policies are tenant-scoped, so a plain SELECT over
-- submission.attempts would expose every candidate in the college. Binding to
-- authz.current_context_actor_id() inside a SECURITY DEFINER function makes the
-- ownership predicate impossible for a caller to omit.
SET ROLE aether_submission_owner;

-- Keyset pagination compares (created_at, id); without the trailing id the
-- existing index cannot satisfy the tiebreak.
DROP INDEX IF EXISTS submission.attempts_candidate_idx;
CREATE INDEX attempts_candidate_idx
    ON submission.attempts (tenant_id, candidate_id, created_at DESC, id DESC);

CREATE FUNCTION submission.list_attempts(
    p_tenant_id uuid,
    p_limit integer,
    p_cursor_created_at timestamptz,
    p_cursor_id uuid,
    p_exam_version_id uuid,
    p_lifecycle_state text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, submission, authz
AS $function$
DECLARE
    signed_actor_id uuid;
    response jsonb;
BEGIN
    signed_actor_id := authz.current_context_actor_id();
    IF signed_actor_id IS NULL THEN
        RAISE EXCEPTION 'current authorization context has no actor' USING ERRCODE = '42501';
    END IF;
    -- 101 accommodates the caller's limit+1 probe for next-page detection: the
    -- handler rejects a client limit above 100, then asks for one extra row.
    IF p_limit IS NULL OR p_limit < 1 OR p_limit > 101 THEN
        RAISE EXCEPTION 'attempt listing limit must be between 1 and 100' USING ERRCODE = '22023';
    END IF;
    IF (p_cursor_created_at IS NULL) <> (p_cursor_id IS NULL) THEN
        RAISE EXCEPTION 'attempt listing cursor must supply both parts' USING ERRCODE = '22023';
    END IF;

    SELECT COALESCE(jsonb_agg(row_to_json(item)::jsonb ORDER BY item.created_at DESC, item.id DESC), '[]'::jsonb)
    INTO response
    FROM (
        SELECT attempt.id,
               attempt.tenant_id,
               attempt.exam_id,
               attempt.exam_version_id,
               attempt.candidate_id,
               attempt.candidate_assignment_id,
               attempt.attempt_number,
               attempt.lifecycle_state,
               attempt.available_from,
               attempt.submission_deadline,
               attempt.started_at,
               attempt.submitted_at,
               attempt.completed_at,
               attempt.created_at,
               attempt.version
        FROM submission.attempts AS attempt
        WHERE attempt.tenant_id = p_tenant_id
          AND attempt.candidate_id = signed_actor_id
          AND attempt.deleted_at IS NULL
          AND (p_exam_version_id IS NULL OR attempt.exam_version_id = p_exam_version_id)
          AND (p_lifecycle_state IS NULL OR attempt.lifecycle_state = p_lifecycle_state)
          AND (
                p_cursor_created_at IS NULL
                OR (attempt.created_at, attempt.id) < (p_cursor_created_at, p_cursor_id)
              )
        ORDER BY attempt.created_at DESC, attempt.id DESC
        LIMIT p_limit
    ) AS item;

    RETURN response;
END
$function$;

CREATE FUNCTION submission.list_answer_revisions(
    p_tenant_id uuid,
    p_attempt_id uuid,
    p_limit integer,
    p_cursor_created_at timestamptz,
    p_cursor_id uuid,
    p_exam_item_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, submission, authz
AS $function$
DECLARE
    signed_actor_id uuid;
    owns_attempt boolean;
    response jsonb;
BEGIN
    signed_actor_id := authz.current_context_actor_id();
    IF signed_actor_id IS NULL THEN
        RAISE EXCEPTION 'current authorization context has no actor' USING ERRCODE = '42501';
    END IF;
    -- 101 accommodates the caller's limit+1 probe for next-page detection.
    IF p_limit IS NULL OR p_limit < 1 OR p_limit > 101 THEN
        RAISE EXCEPTION 'answer listing limit must be between 1 and 100' USING ERRCODE = '22023';
    END IF;
    IF (p_cursor_created_at IS NULL) <> (p_cursor_id IS NULL) THEN
        RAISE EXCEPTION 'answer listing cursor must supply both parts' USING ERRCODE = '22023';
    END IF;

    -- Ownership is proven against the parent attempt, so an opaque attempt UUID
    -- belonging to another candidate yields not-found rather than their answers.
    SELECT true INTO owns_attempt
    FROM submission.attempts AS attempt
    WHERE attempt.tenant_id = p_tenant_id
      AND attempt.id = p_attempt_id
      AND attempt.candidate_id = signed_actor_id
      AND attempt.deleted_at IS NULL;
    IF owns_attempt IS NOT TRUE THEN
        RAISE EXCEPTION 'attempt was not found' USING ERRCODE = 'no_data_found';
    END IF;

    SELECT COALESCE(jsonb_agg(row_to_json(item)::jsonb ORDER BY item.created_at DESC, item.id DESC), '[]'::jsonb)
    INTO response
    FROM (
        SELECT revision.id,
               revision.tenant_id,
               revision.attempt_id,
               revision.exam_item_id,
               revision.revision_number,
               revision.created_at
        FROM submission.answer_revisions AS revision
        WHERE revision.tenant_id = p_tenant_id
          AND revision.attempt_id = p_attempt_id
          AND (p_exam_item_id IS NULL OR revision.exam_item_id = p_exam_item_id)
          AND (
                p_cursor_created_at IS NULL
                OR (revision.created_at, revision.id) < (p_cursor_created_at, p_cursor_id)
              )
        ORDER BY revision.created_at DESC, revision.id DESC
        LIMIT p_limit
    ) AS item;

    RETURN response;
END
$function$;

REVOKE ALL ON FUNCTION submission.list_attempts(uuid, integer, timestamptz, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION submission.list_answer_revisions(uuid, uuid, integer, timestamptz, uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
    submission.list_attempts(uuid, integer, timestamptz, uuid, uuid, text),
    submission.list_answer_revisions(uuid, uuid, integer, timestamptz, uuid, uuid)
    TO aether_submission_app;

RESET ROLE;
```

Note the deliberate omission of answer *content* columns: the spec's list route returns revision metadata, not submitted source. Answer bodies are object references fetched individually.

- [ ] **Step 4: Write the down migration**

Create `services/submission/migrations/000016_attempt_list_functions.down.sql`:

```sql
SET ROLE aether_submission_owner;

DROP FUNCTION IF EXISTS submission.list_answer_revisions(uuid, uuid, integer, timestamptz, uuid, uuid);
DROP FUNCTION IF EXISTS submission.list_attempts(uuid, integer, timestamptz, uuid, uuid, text);

DROP INDEX IF EXISTS submission.attempts_candidate_idx;
CREATE INDEX attempts_candidate_idx
    ON submission.attempts (tenant_id, candidate_id, created_at DESC);

RESET ROLE;
```

The down migration restores the original three-column index verbatim from `000002_domain.up.sql:35`, so rollback-and-reapply is byte-stable.

- [ ] **Step 5: Verify the migration and isolation test**

```bash
make test-migrations
psql "$DATABASE_URL" -f services/submission/migrations/000016_attempt_list_functions_test.sql
```

Expected: `make test-migrations` passes; the test script prints `NOTICE: list_attempts fails closed without an actor context` and rolls back.

If `available_from` does not exist on `submission.attempts`, the function will fail to create. It is added by `000005_attempt_workflows.up.sql:7`; confirm with `grep -n available_from services/submission/migrations/000005_attempt_workflows.up.sql`.

- [ ] **Step 6: Commit**

```bash
git add services/submission/migrations/000016_*
git commit -m "feat: add actor-scoped attempt and answer list functions"
```

---

## Task 5: Submission Go wiring

**Files:**
- Modify: `services/submission/internal/adapters/repo/postgres.go`
- Modify: `services/submission/internal/app/service.go`
- Modify: `services/submission/internal/adapters/http/handler.go`
- Modify: `services/submission/api/openapi.yaml`
- Modify: `services/submission/README.md`
- Test: `services/submission/internal/adapters/http/handler_test.go`

**Interfaces:**
- Consumes: `pagination.Parse`, `pagination.ParseLimit`, `pagination.Encode`, `pagination.EncodeTime` from Task 1; `submission.list_attempts` and `submission.list_answer_revisions` from Task 4
- Produces:
  - `GET /v1/tenants/{tenant_id}/attempts`
  - `GET /v1/tenants/{tenant_id}/attempts/{attempt_id}/answers`
  - `app.ListAttempts(ctx, capability, ListAttempts) (Page[Attempt], error)`
  - `type Page[T any] struct { Items []T; NextCursor string }`

`Page[T]` is defined here and reused verbatim by Tasks 7, 8, 10, 11, 12.

- [ ] **Step 1: Add the page type and command structs to the app layer**

In `services/submission/internal/app/service.go`, above the existing command structs:

```go
// Page is one keyset page. NextCursor is empty on the final page.
type Page[T any] struct {
	Items      []T    `json:"items"`
	NextCursor string `json:"next_cursor,omitempty"`
}

// ListAttempts is a candidate-scoped attempt query. CandidateID is deliberately
// absent: the database binds rows to the signed context actor.
type ListAttempts struct {
	TenantID       string
	Limit          int
	CursorSort     string
	CursorID       string
	ExamVersionID  string
	LifecycleState string
}

// ListAnswerRevisions is a candidate-scoped answer-metadata query scoped to one
// attempt the caller must own.
type ListAnswerRevisions struct {
	TenantID   string
	AttemptID  string
	Limit      int
	CursorSort string
	CursorID   string
	ExamItemID string
}
```

- [ ] **Step 2: Extend the Store interface**

In the same file, add to the `Store` interface:

```go
	ListAttempts(context.Context, pgx.Tx, ListAttempts) ([]Attempt, error)
	ListAnswerRevisions(context.Context, pgx.Tx, ListAnswerRevisions) ([]AnswerRevision, error)
```

- [ ] **Step 3: Write the failing handler test**

Append to `services/submission/internal/adapters/http/handler_test.go`:

```go
func TestListAttemptsRejectsInvalidLimit(t *testing.T) {
	t.Parallel()
	handler := newTestHandler(t)
	request := httptest.NewRequest(http.MethodGet,
		"/v1/tenants/018f4b0d-08f8-7c09-9ba7-efdf9c221001/attempts?limit=0", nil)
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusBadRequest)
	}
}

func TestListAttemptsRejectsMalformedCursor(t *testing.T) {
	t.Parallel()
	handler := newTestHandler(t)
	request := httptest.NewRequest(http.MethodGet,
		"/v1/tenants/018f4b0d-08f8-7c09-9ba7-efdf9c221001/attempts?cursor=!!!", nil)
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusBadRequest)
	}
}
```

`newTestHandler` is the existing helper in that file. Run `grep -n "func newTestHandler" services/submission/internal/adapters/http/handler_test.go` to confirm its signature; if it does not exist, construct the handler the way the neighbouring tests in that file already do.

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd services/submission && go test ./internal/adapters/http/ -run 'TestListAttempts' -v`
Expected: FAIL with 404, because the route is not registered yet.

- [ ] **Step 5: Implement the repository methods**

Append to `services/submission/internal/adapters/repo/postgres.go`:

```go
func (repository *Postgres) ListAttempts(contextValue context.Context, transaction pgx.Tx, command app.ListAttempts) ([]app.Attempt, error) {
	var raw json.RawMessage
	err := transaction.QueryRow(contextValue, `
		SELECT submission.list_attempts($1, $2, $3, $4, $5, $6)
	`,
		command.TenantID, command.Limit,
		nullableTimestamp(command.CursorSort), nullableUUID(command.CursorID),
		nullableUUID(command.ExamVersionID), nullableText(command.LifecycleState),
	).Scan(&raw)
	if err != nil {
		return nil, mapCommandError(err, "list attempts")
	}
	var attempts []app.Attempt
	if err := json.Unmarshal(raw, &attempts); err != nil {
		return nil, fmt.Errorf("decode attempt list: %w", err)
	}
	return attempts, nil
}

func (repository *Postgres) ListAnswerRevisions(contextValue context.Context, transaction pgx.Tx, command app.ListAnswerRevisions) ([]app.AnswerRevision, error) {
	var raw json.RawMessage
	err := transaction.QueryRow(contextValue, `
		SELECT submission.list_answer_revisions($1, $2, $3, $4, $5, $6)
	`,
		command.TenantID, command.AttemptID, command.Limit,
		nullableTimestamp(command.CursorSort), nullableUUID(command.CursorID),
		nullableUUID(command.ExamItemID),
	).Scan(&raw)
	if err != nil {
		return nil, mapCommandError(err, "list answer revisions")
	}
	var revisions []app.AnswerRevision
	if err := json.Unmarshal(raw, &revisions); err != nil {
		return nil, fmt.Errorf("decode answer revision list: %w", err)
	}
	return revisions, nil
}

// nullableUUID converts an absent optional filter to a SQL NULL so one function
// signature serves both the filtered and unfiltered query.
func nullableUUID(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}

func nullableText(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}

// nullableTimestamp parses an RFC3339 nanosecond cursor sort value. The handler
// has already validated the cursor's shape, so a parse failure here is a
// programming error rather than user input.
func nullableTimestamp(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return nil
	}
	return parsed.UTC()
}
```

Add `"strings"` and `"time"` to the file's imports if absent.

- [ ] **Step 6: Implement the app-layer methods**

Append to `services/submission/internal/app/service.go`:

```go
func (service *Service) ListAttempts(contextValue context.Context, capability centralauthz.Capability, command ListAttempts) (Page[Attempt], error) {
	var page Page[Attempt]
	err := database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		// Fetch one extra row to learn whether a further page exists without a
		// second count query.
		probe := command
		probe.Limit = command.Limit + 1
		attempts, err := service.store.ListAttempts(contextValue, transaction, probe)
		if err != nil {
			return err
		}
		page = buildAttemptPage(attempts, command.Limit)
		return nil
	})
	if err != nil {
		return Page[Attempt]{}, err
	}
	return page, nil
}

func buildAttemptPage(attempts []Attempt, limit int) Page[Attempt] {
	page := Page[Attempt]{Items: []Attempt{}}
	if len(attempts) > limit {
		attempts = attempts[:limit]
		last := attempts[len(attempts)-1]
		page.NextCursor = pagination.Encode(pagination.EncodeTime(last.CreatedAt), last.ID)
	}
	page.Items = append(page.Items, attempts...)
	return page
}

func (service *Service) ListAnswerRevisions(contextValue context.Context, capability centralauthz.Capability, command ListAnswerRevisions) (Page[AnswerRevision], error) {
	var page Page[AnswerRevision]
	err := database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		probe := command
		probe.Limit = command.Limit + 1
		revisions, err := service.store.ListAnswerRevisions(contextValue, transaction, probe)
		if err != nil {
			return err
		}
		page = Page[AnswerRevision]{Items: []AnswerRevision{}}
		if len(revisions) > command.Limit {
			revisions = revisions[:command.Limit]
			last := revisions[len(revisions)-1]
			page.NextCursor = pagination.Encode(pagination.EncodeTime(last.CreatedAt), last.ID)
		}
		page.Items = append(page.Items, revisions...)
		return nil
	})
	if err != nil {
		return Page[AnswerRevision]{}, err
	}
	return page, nil
}
```

Add `"github.com/aethercode/aethercode/libs/pkg/pagination"` to the imports.

The `probe.Limit = command.Limit + 1` line is why Task 4's SQL functions bound at 101 rather than 100: the handler rejects a client limit above 100, then the app layer asks for one extra row to detect a further page. Both bounds move together if either changes.

- [ ] **Step 7: Implement the handlers**

Append to `services/submission/internal/adapters/http/handler.go`:

```go
func (handler *Handler) listAttempts(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	limit, err := pagination.ParseLimit(request.URL.Query().Get("limit"), 20, 100)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	cursor, _, err := pagination.Parse(request.URL.Query().Get("cursor"))
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	examVersionID, err := optionalUUIDQuery(request, "exam_version_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	lifecycleState, err := httpx.ParseEnumQuery(request, "lifecycle_state",
		"created", "active", "submitted", "grading", "graded", "expired", "cancelled")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	// The candidate collection authorizes with the bearer subject as the
	// resource; Submission binds rows to the signed actor in the database.
	decision, err := handler.authorizer.AuthorizeSelfHTTP(request.Context(), request, "read", "attempts", tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	page, err := handler.service.ListAttempts(request.Context(), decision.Capability, app.ListAttempts{
		TenantID: tenantID, Limit: limit,
		CursorSort: cursor.SortValue, CursorID: cursor.ID,
		ExamVersionID:  examVersionID,
		LifecycleState: lifecycleState,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, page)
}

func (handler *Handler) listAnswerRevisions(writer http.ResponseWriter, request *http.Request) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	attemptID, err := httpx.ParseUUIDPathValue(request, "attempt_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	limit, err := pagination.ParseLimit(request.URL.Query().Get("limit"), 20, 100)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	cursor, _, err := pagination.Parse(request.URL.Query().Get("cursor"))
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	examItemID, err := optionalUUIDQuery(request, "exam_item_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeSelfHTTP(request.Context(), request, "read", "attempts", tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	page, err := handler.service.ListAnswerRevisions(request.Context(), decision.Capability, app.ListAnswerRevisions{
		TenantID: tenantID, AttemptID: attemptID, Limit: limit,
		CursorSort: cursor.SortValue, CursorID: cursor.ID,
		ExamItemID: examItemID,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, page)
}

// optionalUUIDQuery validates an optional UUID filter. An absent parameter is
// not an error; a present but malformed one is, so a typo never silently widens
// the result set.
func optionalUUIDQuery(request *http.Request, name string) (string, error) {
	raw := strings.TrimSpace(request.URL.Query().Get(name))
	if raw == "" {
		return "", nil
	}
	return httpx.ParseUUIDValue(raw, name)
}
```

Add imports `"strings"` and `"github.com/aethercode/aethercode/libs/pkg/pagination"`.

- [ ] **Step 8: Register the routes**

In `NewHandler` in the same file, after the existing attempt routes:

```go
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/attempts", handler.listAttempts)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/attempts/{attempt_id}/answers", handler.listAnswerRevisions)
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `cd services/submission && go test ./... -v`
Expected: PASS, including the two new handler tests.

- [ ] **Step 10: Document the routes**

In `services/submission/README.md`, add to the API table:

```markdown
| `GET` | `/v1/tenants/{tenant_id}/attempts` | List the calling candidate's attempts. Keyset paged via `limit` (1-100, default 20) and `cursor`. Filters: `exam_version_id`, `lifecycle_state`. Rows are bound to the signed context actor by `submission.list_attempts`. |
| `GET` | `/v1/tenants/{tenant_id}/attempts/{attempt_id}/answers` | List answer-revision metadata for an attempt the caller owns. Filters: `exam_item_id`. |
```

- [ ] **Step 11: Update the OpenAPI contract**

In `services/submission/api/openapi.yaml`, add both paths with `limit` and `cursor` query parameters, a `200` response whose schema has a required `items` array and an optional `next_cursor` string, and `400`/`403` responses. Follow the shape of the existing `/v1/tenants/{tenant_id}/attempts/{attempt_id}` entry in the same file.

- [ ] **Step 12: Commit**

```bash
git add services/submission/
git commit -m "feat: add candidate attempt and answer list endpoints"
```

---

## Task 6: Assessment Class A list function

**Files:**
- Create: `services/assessment/migrations/000016_candidate_assignment_list.up.sql`
- Create: `services/assessment/migrations/000016_candidate_assignment_list.down.sql`
- Test: `services/assessment/migrations/000016_candidate_assignment_list_test.sql`

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces: `assessment.list_candidate_assignments(p_tenant_id uuid, p_limit integer, p_cursor_available_from timestamptz, p_cursor_id uuid, p_lifecycle_state text) RETURNS jsonb`

- [ ] **Step 1: Write the isolation test**

Create `services/assessment/migrations/000016_candidate_assignment_list_test.sql`:

```sql
-- Verifies that assessment.list_candidate_assignments fails closed when no
-- signed actor context is present.
\set ON_ERROR_STOP on

BEGIN;

DO $test$
DECLARE
    tenant_id constant uuid := '018f4b0d-08f8-7c09-9ba7-efdf9c222001';
BEGIN
    BEGIN
        PERFORM assessment.list_candidate_assignments(tenant_id, 20, NULL, NULL, NULL);
        RAISE EXCEPTION 'list_candidate_assignments succeeded without an authorization context';
    EXCEPTION
        WHEN insufficient_privilege THEN
            NULL;
    END;

    RAISE NOTICE 'list_candidate_assignments fails closed without an actor context';
END
$test$;

ROLLBACK;
```

- [ ] **Step 2: Write the up migration**

Create `services/assessment/migrations/000016_candidate_assignment_list.up.sql`:

```sql
-- Candidate-facing assignment collection. Assessment RLS is tenant-scoped, so
-- ownership is bound here to authz.current_context_actor_id() rather than in Go.
SET ROLE aether_assessment_owner;

DROP INDEX IF EXISTS assessment.candidate_assignments_candidate_idx;
CREATE INDEX candidate_assignments_candidate_idx
    ON assessment.candidate_assignments (tenant_id, candidate_id, available_from DESC, id DESC);

CREATE FUNCTION assessment.list_candidate_assignments(
    p_tenant_id uuid,
    p_limit integer,
    p_cursor_available_from timestamptz,
    p_cursor_id uuid,
    p_lifecycle_state text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, assessment, authz
AS $function$
DECLARE
    signed_actor_id uuid;
    response jsonb;
BEGIN
    signed_actor_id := authz.current_context_actor_id();
    IF signed_actor_id IS NULL THEN
        RAISE EXCEPTION 'current authorization context has no actor' USING ERRCODE = '42501';
    END IF;
    -- 101 accommodates the caller's limit+1 probe for next-page detection.
    IF p_limit IS NULL OR p_limit < 1 OR p_limit > 101 THEN
        RAISE EXCEPTION 'assignment listing limit must be between 1 and 100' USING ERRCODE = '22023';
    END IF;
    IF (p_cursor_available_from IS NULL) <> (p_cursor_id IS NULL) THEN
        RAISE EXCEPTION 'assignment listing cursor must supply both parts' USING ERRCODE = '22023';
    END IF;

    SELECT COALESCE(jsonb_agg(row_to_json(item)::jsonb ORDER BY item.available_from DESC, item.id DESC), '[]'::jsonb)
    INTO response
    FROM (
        SELECT assignment.id,
               assignment.tenant_id,
               assignment.assignment_rule_id,
               assignment.exam_version_id,
               assignment.candidate_id,
               assignment.available_from,
               assignment.available_until,
               assignment.lifecycle_state,
               assignment.assigned_at,
               assignment.revoked_at,
               assignment.completed_at,
               assignment.version
        FROM assessment.candidate_assignments AS assignment
        WHERE assignment.tenant_id = p_tenant_id
          AND assignment.candidate_id = signed_actor_id
          AND assignment.deleted_at IS NULL
          AND (p_lifecycle_state IS NULL OR assignment.lifecycle_state = p_lifecycle_state)
          AND (
                p_cursor_available_from IS NULL
                OR (assignment.available_from, assignment.id) < (p_cursor_available_from, p_cursor_id)
              )
        ORDER BY assignment.available_from DESC, assignment.id DESC
        LIMIT p_limit
    ) AS item;

    RETURN response;
END
$function$;

REVOKE ALL ON FUNCTION assessment.list_candidate_assignments(uuid, integer, timestamptz, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION assessment.list_candidate_assignments(uuid, integer, timestamptz, uuid, text)
    TO aether_assessment_app;

RESET ROLE;
```

- [ ] **Step 3: Write the down migration**

Create `services/assessment/migrations/000016_candidate_assignment_list.down.sql`:

```sql
SET ROLE aether_assessment_owner;

DROP FUNCTION IF EXISTS assessment.list_candidate_assignments(uuid, integer, timestamptz, uuid, text);

DROP INDEX IF EXISTS assessment.candidate_assignments_candidate_idx;
CREATE INDEX candidate_assignments_candidate_idx
    ON assessment.candidate_assignments (tenant_id, candidate_id, available_from, available_until);

RESET ROLE;
```

The restored index matches `000002_domain.up.sql:173` exactly.

- [ ] **Step 4: Verify**

```bash
make test-migrations
psql "$DATABASE_URL" -f services/assessment/migrations/000016_candidate_assignment_list_test.sql
```

Expected: pass, and the NOTICE prints.

- [ ] **Step 5: Commit**

```bash
git add services/assessment/migrations/000016_*
git commit -m "feat: add actor-scoped candidate assignment list function"
```

---

## Task 7: Assessment Go wiring

**Files:**
- Create: `services/assessment/internal/adapters/http/list_handler.go`
- Modify: `services/assessment/internal/adapters/http/handler.go` (route registration only)
- Modify: `services/assessment/internal/adapters/repo/postgres.go`
- Modify: `services/assessment/internal/app/service.go`
- Modify: `services/assessment/api/openapi.yaml`
- Modify: `services/assessment/README.md`
- Test: `services/assessment/internal/adapters/http/list_handler_test.go`

`handler.go` is 667 lines. Collection handlers go in a sibling file in the same package rather than growing it past 800.

**Interfaces:**
- Consumes: `Page[T]` shape from Task 5 (redeclared in this package — Go generics are per-package here, and the services do not share an app package), `pagination` from Task 1, `assessment.list_candidate_assignments` from Task 6, the `candidate_assignments` authorization branch from Task 2
- Produces: `GET .../candidate-assignments`, `GET .../exams`, `GET .../exams/{exam_id}/versions`

- [ ] **Step 1: Declare the page type and commands**

In `services/assessment/internal/app/service.go`:

```go
// Page is one keyset page. NextCursor is empty on the final page.
type Page[T any] struct {
	Items      []T    `json:"items"`
	NextCursor string `json:"next_cursor,omitempty"`
}

// ListCandidateAssignments is candidate-scoped; the database binds rows to the
// signed context actor.
type ListCandidateAssignments struct {
	TenantID       string
	Limit          int
	CursorSort     string
	CursorID       string
	LifecycleState string
}

// ListExams is staff-scoped and relies on tenant RLS.
type ListExams struct {
	TenantID       string
	Limit          int
	CursorSort     string
	CursorID       string
	LifecycleState string
}

// ListExamVersions is staff-scoped and relies on tenant RLS.
type ListExamVersions struct {
	TenantID   string
	ExamID     string
	Limit      int
	CursorSort string
	CursorID   string
	Status     string
}
```

Add to the `Store` interface:

```go
	ListCandidateAssignments(context.Context, pgx.Tx, ListCandidateAssignments) ([]CandidateAssignment, error)
	ListExams(context.Context, pgx.Tx, ListExams) ([]Exam, error)
	ListExamVersions(context.Context, pgx.Tx, ListExamVersions) ([]ExamVersion, error)
```

- [ ] **Step 2: Write the failing handler tests**

Create `services/assessment/internal/adapters/http/list_handler_test.go`:

```go
package httpadapter

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestListExamsRejectsInvalidLimit(t *testing.T) {
	t.Parallel()
	handler := newTestHandler(t)
	request := httptest.NewRequest(http.MethodGet,
		"/v1/tenants/018f4b0d-08f8-7c09-9ba7-efdf9c222001/exams?limit=101", nil)
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusBadRequest)
	}
}

func TestListCandidateAssignmentsRejectsMalformedCursor(t *testing.T) {
	t.Parallel()
	handler := newTestHandler(t)
	request := httptest.NewRequest(http.MethodGet,
		"/v1/tenants/018f4b0d-08f8-7c09-9ba7-efdf9c222001/candidate-assignments?cursor=zzz!!", nil)
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusBadRequest)
	}
}
```

Run `grep -n "func newTestHandler" services/assessment/internal/adapters/http/handler_test.go` to confirm the helper exists and is reachable from this file (same package). If it does not exist, build the handler as the neighbouring tests do.

- [ ] **Step 3: Run to verify failure**

Run: `cd services/assessment && go test ./internal/adapters/http/ -run 'TestList' -v`
Expected: FAIL with 404.

- [ ] **Step 4: Implement the repository methods**

Append to `services/assessment/internal/adapters/repo/postgres.go`:

```go
func (repository *Postgres) ListCandidateAssignments(ctx context.Context, transaction pgx.Tx, command app.ListCandidateAssignments) ([]app.CandidateAssignment, error) {
	var raw json.RawMessage
	err := transaction.QueryRow(ctx, `
		SELECT assessment.list_candidate_assignments($1, $2, $3, $4, $5)
	`,
		command.TenantID, command.Limit,
		nullableTimestamp(command.CursorSort), nullableUUID(command.CursorID),
		nullableText(command.LifecycleState),
	).Scan(&raw)
	if err != nil {
		return nil, mapCommandError(err, "list candidate assignments")
	}
	var assignments []app.CandidateAssignment
	if err := json.Unmarshal(raw, &assignments); err != nil {
		return nil, fmt.Errorf("decode candidate assignment list: %w", err)
	}
	return assignments, nil
}

func (repository *Postgres) ListExams(ctx context.Context, transaction pgx.Tx, command app.ListExams) ([]app.Exam, error) {
	rows, err := transaction.Query(ctx, `
		SELECT id::text, tenant_id::text, COALESCE(external_reference, ''), lifecycle_state,
		       version, created_at, updated_at
		FROM assessment.exams
		WHERE tenant_id = $1
		  AND deleted_at IS NULL
		  AND ($2::text IS NULL OR lifecycle_state = $2)
		  AND ($3::timestamptz IS NULL OR (created_at, id) < ($3, $4))
		ORDER BY created_at DESC, id DESC
		LIMIT $5
	`,
		command.TenantID, nullableText(command.LifecycleState),
		nullableTimestamp(command.CursorSort), nullableUUID(command.CursorID),
		command.Limit,
	)
	if err != nil {
		return nil, fmt.Errorf("list exams: %w", err)
	}
	defer rows.Close()

	exams := make([]app.Exam, 0, command.Limit)
	for rows.Next() {
		var exam app.Exam
		if err := rows.Scan(&exam.ID, &exam.TenantID, &exam.ExternalRef, &exam.LifecycleState,
			&exam.Version, &exam.CreatedAt, &exam.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan exam row: %w", err)
		}
		exams = append(exams, exam)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read exam rows: %w", err)
	}
	return exams, nil
}

func (repository *Postgres) ListExamVersions(ctx context.Context, transaction pgx.Tx, command app.ListExamVersions) ([]app.ExamVersion, error) {
	rows, err := transaction.Query(ctx, `
		SELECT id::text, tenant_id::text, exam_id::text, version_number, status,
		       published_at, created_at
		FROM assessment.exam_versions
		WHERE tenant_id = $1
		  AND exam_id = $2
		  AND deleted_at IS NULL
		  AND ($3::text IS NULL OR status = $3)
		  AND ($4::bigint IS NULL OR (version_number, id) < ($4, $5))
		ORDER BY version_number DESC, id DESC
		LIMIT $6
	`,
		command.TenantID, command.ExamID, nullableText(command.Status),
		nullableInt(command.CursorSort), nullableUUID(command.CursorID),
		command.Limit,
	)
	if err != nil {
		return nil, fmt.Errorf("list exam versions: %w", err)
	}
	defer rows.Close()

	versions := make([]app.ExamVersion, 0, command.Limit)
	for rows.Next() {
		var version app.ExamVersion
		if err := rows.Scan(&version.ID, &version.TenantID, &version.ExamID,
			&version.VersionNumber, &version.Status, &version.PublishedAt, &version.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan exam version row: %w", err)
		}
		versions = append(versions, version)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read exam version rows: %w", err)
	}
	return versions, nil
}

func nullableUUID(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}

func nullableText(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}

func nullableTimestamp(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return nil
	}
	return parsed.UTC()
}

func nullableInt(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return nil
	}
	return parsed
}
```

Add imports `"strconv"`, `"strings"`, `"time"` as needed. Before running, confirm the exact `assessment.exam_versions` column names with `sed -n '/CREATE TABLE assessment.exam_versions/,/^);/p' services/assessment/migrations/000002_domain.up.sql` and adjust the SELECT list to match.

- [ ] **Step 5: Implement the app-layer methods**

Append to `services/assessment/internal/app/service.go`:

```go
func (service *Service) ListCandidateAssignments(contextValue context.Context, capability centralauthz.Capability, command ListCandidateAssignments) (Page[CandidateAssignment], error) {
	var page Page[CandidateAssignment]
	err := database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		probe := command
		probe.Limit = command.Limit + 1
		assignments, err := service.store.ListCandidateAssignments(contextValue, transaction, probe)
		if err != nil {
			return err
		}
		page = Page[CandidateAssignment]{Items: []CandidateAssignment{}}
		if len(assignments) > command.Limit {
			assignments = assignments[:command.Limit]
			last := assignments[len(assignments)-1]
			page.NextCursor = pagination.Encode(pagination.EncodeTime(last.AvailableFrom), last.ID)
		}
		page.Items = append(page.Items, assignments...)
		return nil
	})
	if err != nil {
		return Page[CandidateAssignment]{}, err
	}
	return page, nil
}

func (service *Service) ListExams(contextValue context.Context, capability centralauthz.Capability, command ListExams) (Page[Exam], error) {
	var page Page[Exam]
	err := database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		probe := command
		probe.Limit = command.Limit + 1
		exams, err := service.store.ListExams(contextValue, transaction, probe)
		if err != nil {
			return err
		}
		page = Page[Exam]{Items: []Exam{}}
		if len(exams) > command.Limit {
			exams = exams[:command.Limit]
			last := exams[len(exams)-1]
			page.NextCursor = pagination.Encode(pagination.EncodeTime(last.CreatedAt), last.ID)
		}
		page.Items = append(page.Items, exams...)
		return nil
	})
	if err != nil {
		return Page[Exam]{}, err
	}
	return page, nil
}

func (service *Service) ListExamVersions(contextValue context.Context, capability centralauthz.Capability, command ListExamVersions) (Page[ExamVersion], error) {
	var page Page[ExamVersion]
	err := database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		probe := command
		probe.Limit = command.Limit + 1
		versions, err := service.store.ListExamVersions(contextValue, transaction, probe)
		if err != nil {
			return err
		}
		page = Page[ExamVersion]{Items: []ExamVersion{}}
		if len(versions) > command.Limit {
			versions = versions[:command.Limit]
			last := versions[len(versions)-1]
			page.NextCursor = pagination.Encode(pagination.FormatInt(last.VersionNumber), last.ID)
		}
		page.Items = append(page.Items, versions...)
		return nil
	})
	if err != nil {
		return Page[ExamVersion]{}, err
	}
	return page, nil
}
```

If `ExamVersion.VersionNumber` is not an `int64`, convert at the call site rather than changing the struct.

- [ ] **Step 6: Implement the handlers**

Create `services/assessment/internal/adapters/http/list_handler.go`:

```go
// Package httpadapter collection routes. Kept separate from handler.go so the
// mutation surface stays readable as the read surface grows.
package httpadapter

import (
	"net/http"
	"strings"

	"github.com/aethercode/aethercode/libs/pkg/httpx"
	"github.com/aethercode/aethercode/libs/pkg/pagination"
	"github.com/aethercode/aethercode/services/assessment/internal/app"
)

func (handler *Handler) listCandidateAssignments(writer http.ResponseWriter, request *http.Request) {
	tenantID, limit, cursor, err := listRequestParts(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	// Candidate collection: the bearer subject is the authorization resource and
	// Assessment binds rows to the signed actor in the database.
	decision, err := handler.authorizer.AuthorizeSelfHTTP(request.Context(), request, "read", "candidate_assignments", tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	page, err := handler.service.ListCandidateAssignments(request.Context(), decision.Capability, app.ListCandidateAssignments{
		TenantID: tenantID, Limit: limit,
		CursorSort: cursor.SortValue, CursorID: cursor.ID,
		LifecycleState: strings.TrimSpace(request.URL.Query().Get("lifecycle_state")),
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, page)
}

func (handler *Handler) listExams(writer http.ResponseWriter, request *http.Request) {
	tenantID, limit, cursor, err := listRequestParts(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "read", "exams", tenantID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	page, err := handler.service.ListExams(request.Context(), decision.Capability, app.ListExams{
		TenantID: tenantID, Limit: limit,
		CursorSort: cursor.SortValue, CursorID: cursor.ID,
		LifecycleState: strings.TrimSpace(request.URL.Query().Get("lifecycle_state")),
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, page)
}

func (handler *Handler) listExamVersions(writer http.ResponseWriter, request *http.Request) {
	tenantID, limit, cursor, err := listRequestParts(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	examID, err := httpx.ParseUUIDPathValue(request, "exam_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "read", "exam_versions", examID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	page, err := handler.service.ListExamVersions(request.Context(), decision.Capability, app.ListExamVersions{
		TenantID: tenantID, ExamID: examID, Limit: limit,
		CursorSort: cursor.SortValue, CursorID: cursor.ID,
		Status: strings.TrimSpace(request.URL.Query().Get("status")),
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, page)
}

// listRequestParts parses the tenant path value and the two pagination
// parameters shared by every collection route in this service.
func listRequestParts(request *http.Request) (string, int, pagination.Cursor, error) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		return "", 0, pagination.Cursor{}, err
	}
	limit, err := pagination.ParseLimit(request.URL.Query().Get("limit"), 20, 100)
	if err != nil {
		return "", 0, pagination.Cursor{}, err
	}
	cursor, _, err := pagination.Parse(request.URL.Query().Get("cursor"))
	if err != nil {
		return "", 0, pagination.Cursor{}, err
	}
	return tenantID, limit, cursor, nil
}
```

- [ ] **Step 7: Register the routes**

In `NewHandler` in `services/assessment/internal/adapters/http/handler.go`:

```go
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/candidate-assignments", handler.listCandidateAssignments)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/exams", handler.listExams)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/exams/{exam_id}/versions", handler.listExamVersions)
```

- [ ] **Step 8: Run the tests**

Run: `cd services/assessment && go test ./... -v`
Expected: PASS.

- [ ] **Step 9: Update README and OpenAPI**

Add the three paths to `services/assessment/api/openapi.yaml` following the existing entries' shape, and document them in `services/assessment/README.md` noting which is candidate-scoped.

- [ ] **Step 10: Commit**

```bash
git add services/assessment/
git commit -m "feat: add assessment exam and candidate assignment list endpoints"
```

---

## Task 8: SEB list endpoints

**Files:**
- Create: `services/seb/migrations/000012_session_list_function.up.sql`
- Create: `services/seb/migrations/000012_session_list_function.down.sql`
- Test: `services/seb/migrations/000012_session_list_function_test.sql`
- Create: `services/seb/internal/adapters/http/list_handler.go`
- Modify: `services/seb/internal/adapters/http/handler.go`, `internal/app/service.go`, `internal/adapters/repo/postgres.go`, `api/openapi.yaml`, `README.md`
- Test: `services/seb/internal/adapters/http/list_handler_test.go`

**Interfaces:**
- Consumes: Task 1 `pagination`; Task 2 `sessions` branch; Task 3 `/sessions/:id` policy row
- Produces: `GET /v1/tenants/{tenant_id}/sessions` (Class A), `GET /v1/tenants/{tenant_id}/configurations` (Class B)

- [ ] **Step 1: Write the isolation test**

Create `services/seb/migrations/000012_session_list_function_test.sql`:

```sql
-- Verifies that seb.list_sessions fails closed without a signed actor context.
\set ON_ERROR_STOP on

BEGIN;

DO $test$
DECLARE
    tenant_id constant uuid := '018f4b0d-08f8-7c09-9ba7-efdf9c223001';
BEGIN
    BEGIN
        PERFORM seb.list_sessions(tenant_id, 20, NULL, NULL, NULL);
        RAISE EXCEPTION 'list_sessions succeeded without an authorization context';
    EXCEPTION
        WHEN insufficient_privilege THEN
            NULL;
    END;

    RAISE NOTICE 'list_sessions fails closed without an actor context';
END
$test$;

ROLLBACK;
```

- [ ] **Step 2: Write the up migration**

Create `services/seb/migrations/000012_session_list_function.up.sql`:

```sql
-- Candidate-facing SEB session collection, bound to the signed actor exactly as
-- the self-session validation path in 000006 is.
SET ROLE aether_seb_owner;

CREATE INDEX sessions_candidate_keyset_idx
    ON seb.sessions (tenant_id, candidate_id, issued_at DESC, id DESC);

CREATE FUNCTION seb.list_sessions(
    p_tenant_id uuid,
    p_limit integer,
    p_cursor_issued_at timestamptz,
    p_cursor_id uuid,
    p_lifecycle_state text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, seb, authz
AS $function$
DECLARE
    signed_actor_id uuid;
    response jsonb;
BEGIN
    signed_actor_id := authz.current_context_actor_id();
    IF signed_actor_id IS NULL THEN
        RAISE EXCEPTION 'current authorization context has no actor' USING ERRCODE = '42501';
    END IF;
    -- 101 accommodates the caller's limit+1 probe for next-page detection.
    IF p_limit IS NULL OR p_limit < 1 OR p_limit > 101 THEN
        RAISE EXCEPTION 'session listing limit must be between 1 and 100' USING ERRCODE = '22023';
    END IF;
    IF (p_cursor_issued_at IS NULL) <> (p_cursor_id IS NULL) THEN
        RAISE EXCEPTION 'session listing cursor must supply both parts' USING ERRCODE = '22023';
    END IF;

    -- quit_token_hash is deliberately excluded: it is a credential, not
    -- listable session metadata.
    SELECT COALESCE(jsonb_agg(row_to_json(item)::jsonb ORDER BY item.issued_at DESC, item.id DESC), '[]'::jsonb)
    INTO response
    FROM (
        SELECT session_row.id,
               session_row.tenant_id,
               session_row.configuration_id,
               session_row.attempt_id,
               session_row.candidate_id,
               session_row.lifecycle_state,
               session_row.issued_at,
               session_row.activated_at,
               session_row.closed_at,
               session_row.expires_at,
               session_row.closed_reason,
               session_row.version
        FROM seb.sessions AS session_row
        WHERE session_row.tenant_id = p_tenant_id
          AND session_row.candidate_id = signed_actor_id
          AND (p_lifecycle_state IS NULL OR session_row.lifecycle_state = p_lifecycle_state)
          AND (
                p_cursor_issued_at IS NULL
                OR (session_row.issued_at, session_row.id) < (p_cursor_issued_at, p_cursor_id)
              )
        ORDER BY session_row.issued_at DESC, session_row.id DESC
        LIMIT p_limit
    ) AS item;

    RETURN response;
END
$function$;

REVOKE ALL ON FUNCTION seb.list_sessions(uuid, integer, timestamptz, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION seb.list_sessions(uuid, integer, timestamptz, uuid, text) TO aether_seb_app;

RESET ROLE;
```

Confirm whether `seb.sessions` gained a `deleted_at` column in `000010_soft_delete_schema.up.sql`; if it did, add `AND session_row.deleted_at IS NULL` to the WHERE clause.

- [ ] **Step 3: Write the down migration**

Create `services/seb/migrations/000012_session_list_function.down.sql`:

```sql
SET ROLE aether_seb_owner;

DROP FUNCTION IF EXISTS seb.list_sessions(uuid, integer, timestamptz, uuid, text);
DROP INDEX IF EXISTS seb.sessions_candidate_keyset_idx;

RESET ROLE;
```

- [ ] **Step 4: Verify migrations**

```bash
make test-migrations
psql "$DATABASE_URL" -f services/seb/migrations/000012_session_list_function_test.sql
```

- [ ] **Step 5: Write the failing handler test**

Create `services/seb/internal/adapters/http/list_handler_test.go`:

```go
package httpadapter

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestListSessionsRejectsInvalidLimit(t *testing.T) {
	t.Parallel()
	handler := newTestHandler(t)
	request := httptest.NewRequest(http.MethodGet,
		"/v1/tenants/018f4b0d-08f8-7c09-9ba7-efdf9c223001/sessions?limit=0", nil)
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusBadRequest)
	}
}

func TestListSessionsRejectsMalformedCursor(t *testing.T) {
	t.Parallel()
	handler := newTestHandler(t)
	request := httptest.NewRequest(http.MethodGet,
		"/v1/tenants/018f4b0d-08f8-7c09-9ba7-efdf9c223001/sessions?cursor=!!!", nil)
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusBadRequest)
	}
}
```

- [ ] **Step 6: Run to verify failure**

Run: `cd services/seb && go test ./internal/adapters/http/ -run 'TestList' -v`
Expected: FAIL with 404.

- [ ] **Step 7: Declare the page type and commands**

In `services/seb/internal/app/service.go`:

```go
// Page is one keyset page. NextCursor is empty on the final page.
type Page[T any] struct {
	Items      []T    `json:"items"`
	NextCursor string `json:"next_cursor,omitempty"`
}

// ListSessions is candidate-scoped; the database binds rows to the signed actor.
type ListSessions struct {
	TenantID       string
	Limit          int
	CursorSort     string
	CursorID       string
	LifecycleState string
}

// ListConfigurations is staff-scoped and relies on tenant RLS.
type ListConfigurations struct {
	TenantID       string
	Limit          int
	CursorSort     string
	CursorID       string
	LifecycleState string
}
```

Add to the `Store` interface:

```go
	ListSessions(context.Context, pgx.Tx, ListSessions) ([]Session, error)
	ListConfigurations(context.Context, pgx.Tx, ListConfigurations) ([]Configuration, error)
```

- [ ] **Step 8: Implement the repository methods**

Append to `services/seb/internal/adapters/repo/postgres.go`:

```go
func (repository *Postgres) ListSessions(contextValue context.Context, transaction pgx.Tx, command app.ListSessions) ([]app.Session, error) {
	var raw json.RawMessage
	err := transaction.QueryRow(contextValue, `
		SELECT seb.list_sessions($1, $2, $3, $4, $5)
	`,
		command.TenantID, command.Limit,
		nullableTimestamp(command.CursorSort), nullableUUID(command.CursorID),
		nullableText(command.LifecycleState),
	).Scan(&raw)
	if err != nil {
		return nil, mapCommandError(err, "list sessions")
	}
	var sessions []app.Session
	if err := json.Unmarshal(raw, &sessions); err != nil {
		return nil, fmt.Errorf("decode session list: %w", err)
	}
	return sessions, nil
}

func (repository *Postgres) ListConfigurations(contextValue context.Context, transaction pgx.Tx, command app.ListConfigurations) ([]app.Configuration, error) {
	rows, err := transaction.Query(contextValue, `
		SELECT id::text, tenant_id::text, lifecycle_state, version, created_at
		FROM seb.configurations
		WHERE tenant_id = $1
		  AND deleted_at IS NULL
		  AND ($2::text IS NULL OR lifecycle_state = $2)
		  AND ($3::timestamptz IS NULL OR (created_at, id) < ($3, $4))
		ORDER BY created_at DESC, id DESC
		LIMIT $5
	`,
		command.TenantID, nullableText(command.LifecycleState),
		nullableTimestamp(command.CursorSort), nullableUUID(command.CursorID),
		command.Limit,
	)
	if err != nil {
		return nil, fmt.Errorf("list configurations: %w", err)
	}
	defer rows.Close()

	configurations := make([]app.Configuration, 0, command.Limit)
	for rows.Next() {
		var configuration app.Configuration
		if err := rows.Scan(&configuration.ID, &configuration.TenantID,
			&configuration.LifecycleState, &configuration.Version, &configuration.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan configuration row: %w", err)
		}
		configurations = append(configurations, configuration)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read configuration rows: %w", err)
	}
	return configurations, nil
}

func nullableUUID(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}

func nullableText(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}

func nullableTimestamp(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return nil
	}
	return parsed.UTC()
}
```

Add `"encoding/json"`, `"strings"`, and `"time"` to the imports if absent. Confirm the real `seb.configurations` column list with `sed -n '/CREATE TABLE seb.configurations/,/^);/p' services/seb/migrations/000002_domain.up.sql` and adjust the SELECT to match — do not return any key, hash, or secret column.

- [ ] **Step 9: Implement the app methods**

Append to `services/seb/internal/app/service.go`:

```go
func (service *Service) ListSessions(contextValue context.Context, capability centralauthz.Capability, command ListSessions) (Page[Session], error) {
	var page Page[Session]
	err := database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		probe := command
		probe.Limit = command.Limit + 1
		sessions, err := service.store.ListSessions(contextValue, transaction, probe)
		if err != nil {
			return err
		}
		page = Page[Session]{Items: []Session{}}
		if len(sessions) > command.Limit {
			sessions = sessions[:command.Limit]
			last := sessions[len(sessions)-1]
			page.NextCursor = pagination.Encode(pagination.EncodeTime(last.IssuedAt), last.ID)
		}
		page.Items = append(page.Items, sessions...)
		return nil
	})
	if err != nil {
		return Page[Session]{}, err
	}
	return page, nil
}

func (service *Service) ListConfigurations(contextValue context.Context, capability centralauthz.Capability, command ListConfigurations) (Page[Configuration], error) {
	var page Page[Configuration]
	err := database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		probe := command
		probe.Limit = command.Limit + 1
		configurations, err := service.store.ListConfigurations(contextValue, transaction, probe)
		if err != nil {
			return err
		}
		page = Page[Configuration]{Items: []Configuration{}}
		if len(configurations) > command.Limit {
			configurations = configurations[:command.Limit]
			last := configurations[len(configurations)-1]
			page.NextCursor = pagination.Encode(pagination.EncodeTime(last.CreatedAt), last.ID)
		}
		page.Items = append(page.Items, configurations...)
		return nil
	})
	if err != nil {
		return Page[Configuration]{}, err
	}
	return page, nil
}
```

Add `"github.com/aethercode/aethercode/libs/pkg/pagination"` to the imports.

- [ ] **Step 10: Implement the handlers**

Create `services/seb/internal/adapters/http/list_handler.go`:

```go
// Package httpadapter collection routes, kept separate from the mutation
// surface in handler.go.
package httpadapter

import (
	"net/http"

	"github.com/aethercode/aethercode/libs/pkg/httpx"
	"github.com/aethercode/aethercode/libs/pkg/pagination"
	"github.com/aethercode/aethercode/services/seb/internal/app"
)

func (handler *Handler) listSessions(writer http.ResponseWriter, request *http.Request) {
	tenantID, limit, cursor, err := listRequestParts(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	lifecycleState, err := httpx.ParseEnumQuery(request, "lifecycle_state",
		"issued", "active", "closed", "revoked", "expired")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	// Candidate collection: the bearer subject is the authorization resource and
	// SEB binds rows to sessions.candidate_id in the database.
	decision, err := handler.authorizer.AuthorizeSelfHTTP(request.Context(), request, "read", "sessions", tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	page, err := handler.service.ListSessions(request.Context(), decision.Capability, app.ListSessions{
		TenantID: tenantID, Limit: limit,
		CursorSort: cursor.SortValue, CursorID: cursor.ID,
		LifecycleState: lifecycleState,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, page)
}

func (handler *Handler) listConfigurations(writer http.ResponseWriter, request *http.Request) {
	tenantID, limit, cursor, err := listRequestParts(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	lifecycleState, err := httpx.ParseEnumQuery(request, "lifecycle_state", "active", "revoked")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "read", "configurations", tenantID, tenantID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	page, err := handler.service.ListConfigurations(request.Context(), decision.Capability, app.ListConfigurations{
		TenantID: tenantID, Limit: limit,
		CursorSort: cursor.SortValue, CursorID: cursor.ID,
		LifecycleState: lifecycleState,
	})
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, page)
}

// listRequestParts parses the tenant path value and the two pagination
// parameters shared by every collection route in this service.
func listRequestParts(request *http.Request) (string, int, pagination.Cursor, error) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		return "", 0, pagination.Cursor{}, err
	}
	limit, err := pagination.ParseLimit(request.URL.Query().Get("limit"), 20, 100)
	if err != nil {
		return "", 0, pagination.Cursor{}, err
	}
	cursor, _, err := pagination.Parse(request.URL.Query().Get("cursor"))
	if err != nil {
		return "", 0, pagination.Cursor{}, err
	}
	return tenantID, limit, cursor, nil
}
```

Confirm the real `seb.configurations` lifecycle values before finalising the `ParseEnumQuery` allow-list: `grep -n "lifecycle_state text" -A 2 services/seb/migrations/000002_domain.up.sql`.

- [ ] **Step 11: Register the routes**

In `NewHandler` in `services/seb/internal/adapters/http/handler.go`:

```go
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/sessions", handler.listSessions)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/configurations", handler.listConfigurations)
```

- [ ] **Step 12: Run the tests**

Run: `cd services/seb && go test ./... -v`
Expected: PASS.

- [ ] **Step 13: Update README and OpenAPI, then commit**

```bash
git add services/seb/
git commit -m "feat: add SEB session and configuration list endpoints"
```

---

## Task 9: Question Bank cursor-aware list functions

**Files:**
- Create: `services/question-bank/migrations/000009_question_list_functions.up.sql`
- Create: `services/question-bank/migrations/000009_question_list_functions.down.sql`

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces:
  - `qbank.list_published_questions(p_limit integer, p_cursor_published_at timestamptz, p_cursor_id uuid, p_difficulty text, p_tag text, p_language text) RETURNS jsonb` — replaces the one-argument version
  - `qbank.list_question_versions(p_question_id uuid, p_limit integer, p_cursor_version_number bigint, p_cursor_id uuid, p_status text) RETURNS jsonb`

Question Bank is the one service whose reads already go through `SECURITY DEFINER` jsonb functions, so both stay in that idiom.

- [ ] **Step 1: Capture the existing function definition verbatim**

Run: `sed -n '798,860p' services/question-bank/migrations/000003_authoring_workflows_and_reliability.up.sql > /tmp/qbank_list_original.sql && cat /tmp/qbank_list_original.sql`

The down migration must restore this exact body. Keep the file until Step 3 is written.

- [ ] **Step 2: Write the up migration**

Create `services/question-bank/migrations/000009_question_list_functions.up.sql`:

```sql
-- Replace the limit-only question listing with a cursor-aware one and add
-- version listing. Question Bank content is tenant-global, so these are
-- Class B: require_read_context plus the existing RLS policies are sufficient
-- and there is no per-actor ownership to bind.
SET ROLE aether_qbank_owner;

DROP FUNCTION IF EXISTS qbank.list_published_questions(integer);

CREATE FUNCTION qbank.list_published_questions(
    p_limit integer,
    p_cursor_published_at timestamptz,
    p_cursor_id uuid,
    p_difficulty text,
    p_tag text,
    p_language text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, qbank
AS $function$
DECLARE
    response jsonb;
BEGIN
    PERFORM qbank.require_read_context('qbank.questions');
    -- 101 accommodates the caller's limit+1 probe for next-page detection.
    IF p_limit IS NULL OR p_limit < 1 OR p_limit > 101 THEN
        RAISE EXCEPTION 'question listing limit must be between 1 and 100' USING ERRCODE = '22023';
    END IF;
    IF (p_cursor_published_at IS NULL) <> (p_cursor_id IS NULL) THEN
        RAISE EXCEPTION 'question listing cursor must supply both parts' USING ERRCODE = '22023';
    END IF;

    SELECT COALESCE(jsonb_agg(qbank.question_response(item.question_id, item.question_version_id)
                              ORDER BY item.published_at DESC, item.question_version_id DESC), '[]'::jsonb)
    INTO response
    FROM (
        SELECT question.id AS question_id,
               question_version.id AS question_version_id,
               question_version.published_at
        FROM qbank.questions AS question
        JOIN LATERAL (
            SELECT version_item.id, version_item.published_at, version_item.difficulty,
                   version_item.supported_languages
            FROM qbank.question_versions AS version_item
            WHERE version_item.question_id = question.id
              AND version_item.status = 'published'
            ORDER BY version_item.version_number DESC
            LIMIT 1
        ) AS question_version ON true
        WHERE question.lifecycle_state <> 'archived'
          AND (p_difficulty IS NULL OR question_version.difficulty = p_difficulty)
          AND (p_language IS NULL OR question_version.supported_languages ? p_language)
          AND (
                p_tag IS NULL
                OR EXISTS (
                    SELECT 1
                    FROM qbank.question_version_tags AS version_tag
                    JOIN qbank.tags AS tag ON tag.id = version_tag.tag_id
                    WHERE version_tag.question_version_id = question_version.id
                      AND tag.name = p_tag
                )
              )
          AND (
                p_cursor_published_at IS NULL
                OR (question_version.published_at, question_version.id) < (p_cursor_published_at, p_cursor_id)
              )
        ORDER BY question_version.published_at DESC, question_version.id DESC
        LIMIT p_limit
    ) AS item;

    RETURN response;
END
$function$;

CREATE FUNCTION qbank.list_question_versions(
    p_question_id uuid,
    p_limit integer,
    p_cursor_version_number bigint,
    p_cursor_id uuid,
    p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, qbank
AS $function$
DECLARE
    response jsonb;
BEGIN
    PERFORM qbank.require_read_context('qbank.question_versions');
    IF p_limit IS NULL OR p_limit < 1 OR p_limit > 101 THEN
        RAISE EXCEPTION 'question version listing limit must be between 1 and 100' USING ERRCODE = '22023';
    END IF;
    IF (p_cursor_version_number IS NULL) <> (p_cursor_id IS NULL) THEN
        RAISE EXCEPTION 'question version listing cursor must supply both parts' USING ERRCODE = '22023';
    END IF;

    SELECT COALESCE(jsonb_agg(qbank.question_version_response(item.id)
                              ORDER BY item.version_number DESC, item.id DESC), '[]'::jsonb)
    INTO response
    FROM (
        SELECT version_item.id, version_item.version_number
        FROM qbank.question_versions AS version_item
        WHERE version_item.question_id = p_question_id
          AND version_item.deleted_at IS NULL
          AND (p_status IS NULL OR version_item.status = p_status)
          AND (
                p_cursor_version_number IS NULL
                OR (version_item.version_number, version_item.id) < (p_cursor_version_number, p_cursor_id)
              )
        ORDER BY version_item.version_number DESC, version_item.id DESC
        LIMIT p_limit
    ) AS item;

    RETURN response;
END
$function$;

REVOKE ALL ON FUNCTION
    qbank.list_published_questions(integer, timestamptz, uuid, text, text, text),
    qbank.list_question_versions(uuid, integer, bigint, uuid, text)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
    qbank.list_published_questions(integer, timestamptz, uuid, text, text, text),
    qbank.list_question_versions(uuid, integer, bigint, uuid, text)
    TO aether_qbank_app;

RESET ROLE;
```

Two assumptions to verify before running: that `qbank.question_version_response(uuid)` exists (run `grep -n "question_version_response" services/question-bank/migrations/*.up.sql`) and that `supported_languages` is `jsonb` so the `?` containment operator applies (check `sed -n '/CREATE TABLE qbank.question_versions/,/^);/p' services/question-bank/migrations/000002_domain.up.sql`). If `question_version_response` does not exist, select the columns inline as `list_question_versions` does not depend on the helper. If `supported_languages` is `text[]`, replace `? p_language` with `@> ARRAY[p_language]`.

- [ ] **Step 3: Write the down migration**

Create `services/question-bank/migrations/000009_question_list_functions.down.sql`, restoring the original from `/tmp/qbank_list_original.sql`:

```sql
SET ROLE aether_qbank_owner;

DROP FUNCTION IF EXISTS qbank.list_question_versions(uuid, integer, bigint, uuid, text);
DROP FUNCTION IF EXISTS qbank.list_published_questions(integer, timestamptz, uuid, text, text, text);
```

then paste the captured `CREATE FUNCTION qbank.list_published_questions(p_limit integer) ...` body verbatim, followed by:

```sql
REVOKE ALL ON FUNCTION qbank.list_published_questions(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION qbank.list_published_questions(integer) TO aether_qbank_app;

RESET ROLE;
```

- [ ] **Step 4: Verify rollback and reapply**

Run: `make test-migrations`
Expected: PASS. This is the migration most likely to fail the rollback leg, because it replaces a function signature. If it fails, the restored body in the down migration does not match the original.

- [ ] **Step 5: Commit**

```bash
git add services/question-bank/migrations/000009_*
git commit -m "feat: add cursor-aware question and version list functions"
```

---

## Task 10: Question Bank Go wiring

**Files:**
- Modify: `services/question-bank/internal/adapters/repo/postgres.go:237-247`
- Modify: `services/question-bank/internal/app/service.go:381-390`
- Modify: `services/question-bank/internal/adapters/http/handler.go:430-451`
- Modify: `services/question-bank/api/openapi.yaml`, `README.md`
- Test: `services/question-bank/internal/adapters/http/handler_test.go`

**Interfaces:**
- Consumes: Task 1 `pagination`; Task 9's two functions
- Produces: upgraded `GET /v1/questions`; new `GET /v1/questions/{question_id}/versions`

- [ ] **Step 1: Write the failing tests**

Append to `services/question-bank/internal/adapters/http/handler_test.go`:

```go
func TestListQuestionsRejectsMalformedCursor(t *testing.T) {
	t.Parallel()
	handler := newTestHandler(t)
	request := httptest.NewRequest(http.MethodGet, "/v1/questions?cursor=%%%", nil)
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusBadRequest)
	}
}

func TestListQuestionsStillAcceptsBareLimit(t *testing.T) {
	t.Parallel()
	handler := newTestHandler(t)
	request := httptest.NewRequest(http.MethodGet, "/v1/questions?limit=5", nil)
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, request)

	if recorder.Code == http.StatusBadRequest {
		t.Fatal("status = 400, want the pre-existing limit-only call to keep working")
	}
}
```

The second test guards the backward-compatibility promise in the spec.

- [ ] **Step 2: Run to verify the cursor test fails**

Run: `cd services/question-bank && go test ./internal/adapters/http/ -run 'TestListQuestions' -v`
Expected: `TestListQuestionsRejectsMalformedCursor` FAILs (the parameter is currently ignored); `TestListQuestionsStillAcceptsBareLimit` PASSes.

- [ ] **Step 3: Update the app-layer signature**

Replace `ListPublishedQuestions` in `services/question-bank/internal/app/service.go:381` with:

```go
// ListPublishedQuestions is Class B: Question Bank content is tenant-global, so
// require_read_context plus RLS is the whole authorization story.
type ListPublishedQuestions struct {
	Limit      int
	CursorSort string
	CursorID   string
	Difficulty string
	Tag        string
	Language   string
}

type ListQuestionVersions struct {
	QuestionID string
	Limit      int
	CursorSort string
	CursorID   string
	Status     string
}

func (service *Service) ListPublishedQuestions(contextValue context.Context, capability centralauthz.Capability, command ListPublishedQuestions) (Page[QuestionDetail], error) {
	if command.Limit < 1 || command.Limit > 100 {
		return Page[QuestionDetail]{}, apperrors.New(apperrors.CodeInvalidArgument, "question listing limit must be between 1 and 100")
	}
	var page Page[QuestionDetail]
	err := database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		probe := command
		probe.Limit = command.Limit + 1
		questions, err := service.store.ListPublishedQuestions(contextValue, transaction, probe)
		if err != nil {
			return err
		}
		page = Page[QuestionDetail]{Items: []QuestionDetail{}}
		if len(questions) > command.Limit {
			questions = questions[:command.Limit]
			last := questions[len(questions)-1]
			page.NextCursor = pagination.Encode(pagination.EncodeTime(last.PublishedAt), last.QuestionVersionID)
		}
		page.Items = append(page.Items, questions...)
		return nil
	})
	if err != nil {
		return Page[QuestionDetail]{}, err
	}
	return page, nil
}
```

Add the `Page[T]` declaration from Appendix A.1 to this package, and a `ListQuestionVersions` method following the probe idiom in Appendix A.2 but building its cursor with `pagination.FormatInt(last.VersionNumber)` instead of `EncodeTime`.

Confirm the field names `PublishedAt` and `QuestionVersionID` exist on `app.QuestionDetail` with `grep -n "type QuestionDetail" -A 15 services/question-bank/internal/app/service.go`; adjust to the real names if they differ.

- [ ] **Step 4: Update the repository and Store interface**

Change the `Store` interface line to:

```go
	ListPublishedQuestions(context.Context, pgx.Tx, ListPublishedQuestions) ([]QuestionDetail, error)
	ListQuestionVersions(context.Context, pgx.Tx, ListQuestionVersions) ([]QuestionVersion, error)
```

and rewrite `services/question-bank/internal/adapters/repo/postgres.go:237` to call the six-argument function, plus add `ListQuestionVersions`, following the unmarshal pattern already in that method.

- [ ] **Step 5: Update the handler**

Rewrite `listPublishedQuestions` at `services/question-bank/internal/adapters/http/handler.go:430` to use `pagination.ParseLimit(request.URL.Query().Get("limit"), 20, 100)` and `pagination.Parse(...)`, pass the three filters, and write the returned `Page` directly. Add a `listQuestionVersions` handler and register:

```go
	mux.HandleFunc("GET /v1/questions/{question_id}/versions", handler.listQuestionVersions)
```

- [ ] **Step 6: Run the tests**

Run: `cd services/question-bank && go test ./... -v`
Expected: PASS, both new tests included.

- [ ] **Step 7: Update README and OpenAPI, then commit**

```bash
git add services/question-bank/
git commit -m "feat: add cursor pagination and version listing to question bank"
```

---

## Task 11: User service list endpoints

**Files:**
- Create: `services/user/internal/adapters/http/list_handler.go`
- Modify: `services/user/internal/adapters/http/handler.go`, `internal/app/management.go`, `internal/adapters/repo/postgres.go`, `api/openapi.yaml`, `README.md`
- Test: `services/user/internal/adapters/http/list_handler_test.go`

**Interfaces:**
- Consumes: Task 1 `pagination`; Task 3's `students_tenant_keyset_idx`
- Produces: `GET /v1/tenants/{tenant_id}/students`, `GET /v1/tenants/{tenant_id}/batches/{batch_id}/mentors`, `GET /v1/role-assignments`

All three are Class B: staff roles hold `/*` scope and tenant RLS is sufficient.

- [ ] **Step 1: Write the failing tests**

Create `services/user/internal/adapters/http/list_handler_test.go`:

```go
package httpadapter

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestListStudentsRejectsInvalidLimit(t *testing.T) {
	t.Parallel()
	handler := newTestHandler(t)
	request := httptest.NewRequest(http.MethodGet,
		"/v1/tenants/018f4b0d-08f8-7c09-9ba7-efdf9c224001/students?limit=101", nil)
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusBadRequest)
	}
}

func TestListStudentsRejectsMalformedCursor(t *testing.T) {
	t.Parallel()
	handler := newTestHandler(t)
	request := httptest.NewRequest(http.MethodGet,
		"/v1/tenants/018f4b0d-08f8-7c09-9ba7-efdf9c224001/students?cursor=!!!", nil)
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusBadRequest)
	}
}
```

`newTestHandler` is the existing helper in this package; confirm with `grep -rn "func newTestHandler" services/user/internal/adapters/http/`.

- [ ] **Step 2: Run to verify failure**

Run: `cd services/user && go test ./internal/adapters/http/ -run 'TestList' -v`
Expected: FAIL with 404.

- [ ] **Step 3: Add commands and Store methods**

In `services/user/internal/app/management.go`, add the `Page[T]` type from Appendix A.1 and:

```go
type ListStudents struct {
	TenantID               string
	Limit                  int
	CursorSort             string
	CursorID               string
	Status                 string
	BatchID                string
	DepartmentID           string
	EnrollmentNumberPrefix string
}

type ListMentorBatchAssignments struct {
	TenantID   string
	BatchID    string
	Limit      int
	CursorSort string
	CursorID   string
}

type ListRoleAssignments struct {
	TenantID    string
	PrincipalID string
	RoleName    string
	ScopeKind   string
	Limit       int
	CursorSort  string
	CursorID    string
}
```

- [ ] **Step 4: Implement the repository methods**

Append to `services/user/internal/adapters/repo/postgres.go`. The student query is the one with real filter complexity:

```go
func (repository *Postgres) ListStudents(contextValue context.Context, transaction pgx.Tx, command app.ListStudents) ([]app.Student, error) {
	rows, err := transaction.Query(contextValue, `
		SELECT student.id::text, student.principal_id::text, student.tenant_id::text,
		       student.enrollment_number, student.status, student.admitted_at,
		       student.version, student.created_at, student.updated_at
		FROM users.students AS student
		WHERE student.tenant_id = $1
		  AND student.deleted_at IS NULL
		  AND ($2::text IS NULL OR student.status = $2)
		  AND ($3::text IS NULL OR student.enrollment_number LIKE $3 || '%')
		  AND (
		        $4::uuid IS NULL
		        OR EXISTS (
		            SELECT 1 FROM users.current_student_affiliations AS affiliation
		            WHERE affiliation.student_id = student.id
		              AND affiliation.batch_id = $4
		        )
		      )
		  AND (
		        $5::uuid IS NULL
		        OR EXISTS (
		            SELECT 1 FROM users.student_department_memberships AS membership
		            WHERE membership.student_id = student.id
		              AND membership.department_id = $5
		        )
		      )
		  AND ($6::timestamptz IS NULL OR (student.created_at, student.id) < ($6, $7))
		ORDER BY student.created_at DESC, student.id DESC
		LIMIT $8
	`,
		command.TenantID, nullableText(command.Status),
		nullableText(command.EnrollmentNumberPrefix),
		nullableUUID(command.BatchID), nullableUUID(command.DepartmentID),
		nullableTimestamp(command.CursorSort), nullableUUID(command.CursorID),
		command.Limit,
	)
	if err != nil {
		return nil, fmt.Errorf("list students: %w", err)
	}
	defer rows.Close()

	students := make([]app.Student, 0, command.Limit)
	for rows.Next() {
		var student app.Student
		if err := rows.Scan(&student.ID, &student.PrincipalID, &student.TenantID,
			&student.EnrollmentNumber, &student.Status, &student.AdmittedAt,
			&student.Version, &student.CreatedAt, &student.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan student row: %w", err)
		}
		students = append(students, student)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read student rows: %w", err)
	}
	return students, nil
}
```

`LIKE $3 || '%'` is safe here because `$3` is a bound parameter, not interpolated SQL. A candidate-supplied `%` widens only their own prefix search and cannot escape the tenant predicate.

Verify the real column names on `users.current_student_affiliations` and `users.student_department_memberships` with `sed -n '/CREATE TABLE users.current_student_affiliations/,/^);/p' services/user/migrations/000002_user_domain.up.sql` before running; adjust the EXISTS subqueries to match.

Add `ListMentorBatchAssignments` and `ListRoleAssignments` as plain keyset `SELECT`s over `users.mentor_batch_assignments` and `users.role_assignments`, following the template in Appendix A.5. Copy the `nullableUUID` / `nullableText` / `nullableTimestamp` helpers from Appendix A.4 into this file if they are not already present.

- [ ] **Step 5: Implement the app methods**

Add `ListStudents`, `ListMentorBatchAssignments`, and `ListRoleAssignments` to the app layer, each following the probe idiom in Appendix A.2, using `pagination.EncodeTime(last.CreatedAt)` for all three cursors.

- [ ] **Step 6: Implement the handlers**

Create `services/user/internal/adapters/http/list_handler.go` with the three handlers and the `listRequestParts` helper from Appendix A.3. Each handler follows the structure of `listExams` in Task 7 Step 6: parse parts, validate enum filters with `httpx.ParseEnumQuery`, authorize, call the service, write the page. Authorization calls:

```go
	// students
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "read", "students", tenantID, tenantID)
	// mentors
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "read", "mentor_batch_assignments", batchID, tenantID)
	// role assignments
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "read", "role_assignments", principalFilterOrTenant, tenantID)
```

`role_assignments` is in `OptionalTenantResources`, so an empty tenant ID is valid there; read the tenant from the `X-Tenant-ID` header as the existing delete handlers in this service do, and pass `""` when absent.

- [ ] **Step 7: Register the routes**

```go
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/students", handler.listStudents)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/batches/{batch_id}/mentors", handler.listMentorBatchAssignments)
	mux.HandleFunc("GET /v1/role-assignments", handler.listRoleAssignments)
```

- [ ] **Step 8: Run the tests**

Run: `cd services/user && go test ./... -v`
Expected: PASS, including Task 2's authorization tests.

- [ ] **Step 9: Update README and OpenAPI, then commit**

```bash
git add services/user/
git commit -m "feat: add user roster and role assignment list endpoints"
```

---

## Task 12: Tenant service list endpoints

**Files:**
- Create: `services/tenant/internal/adapters/http/list_handler.go`
- Modify: `services/tenant/internal/adapters/http/handler.go`, `internal/app/service.go`, `internal/adapters/repo/postgres.go`, `api/openapi.yaml`, `README.md`
- Test: `services/tenant/internal/adapters/http/list_handler_test.go`

**Interfaces:**
- Consumes: Task 1 `pagination`
- Produces: `GET /v1/tenants`, `GET /v1/tenants/{tenant_id}/departments`, `GET /v1/tenants/{tenant_id}/batches`, `GET /v1/placement-organizations/{organization_id}/departments`

All Class B.

- [ ] **Step 1: Write the failing tests**

Create `services/tenant/internal/adapters/http/list_handler_test.go`:

```go
package httpadapter

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestListBatchesRejectsInvalidLimit(t *testing.T) {
	t.Parallel()
	handler := newTestHandler(t)
	request := httptest.NewRequest(http.MethodGet,
		"/v1/tenants/018f4b0d-08f8-7c09-9ba7-efdf9c225001/batches?limit=101", nil)
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusBadRequest)
	}
}

func TestListBatchesRejectsMalformedCursor(t *testing.T) {
	t.Parallel()
	handler := newTestHandler(t)
	request := httptest.NewRequest(http.MethodGet,
		"/v1/tenants/018f4b0d-08f8-7c09-9ba7-efdf9c225001/batches?cursor=!!!", nil)
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusBadRequest)
	}
}
```

`newTestHandler` is the existing helper in this package; confirm with `grep -rn "func newTestHandler" services/tenant/internal/adapters/http/`.

- [ ] **Step 2: Run to verify failure**

Run: `cd services/tenant && go test ./internal/adapters/http/ -run 'TestList' -v`
Expected: FAIL with 404.

- [ ] **Step 3: Add commands, Store methods, and repository queries**

In `services/tenant/internal/app/service.go`, add `Page[T]` from Appendix A.1 plus `ListTenants`, `ListDepartments`, `ListBatches`, and `ListPlacementDepartments` command structs, each carrying `Limit`, `CursorSort`, `CursorID`, and their filters (`Status` for all; `DepartmentID` and `AcademicYear` additionally for batches; `OrganizationID` for placement departments).

In `services/tenant/internal/adapters/repo/postgres.go`, add four keyset queries. The batches query, which has the most filters:

```go
func (repository *Postgres) ListBatches(contextValue context.Context, transaction pgx.Tx, command app.ListBatches) ([]app.Batch, error) {
	rows, err := transaction.Query(contextValue, `
		SELECT id::text, tenant_id::text, department_id::text, code, name,
		       academic_year, status, version, created_at, updated_at
		FROM tenant.batches
		WHERE tenant_id = $1
		  AND deleted_at IS NULL
		  AND ($2::uuid IS NULL OR department_id = $2)
		  AND ($3::text IS NULL OR status = $3)
		  AND ($4::text IS NULL OR academic_year = $4)
		  AND ($5::timestamptz IS NULL OR (created_at, id) < ($5, $6))
		ORDER BY created_at DESC, id DESC
		LIMIT $7
	`,
		command.TenantID, nullableUUID(command.DepartmentID),
		nullableText(command.Status), nullableText(command.AcademicYear),
		nullableTimestamp(command.CursorSort), nullableUUID(command.CursorID),
		command.Limit,
	)
	if err != nil {
		return nil, fmt.Errorf("list batches: %w", err)
	}
	defer rows.Close()

	batches := make([]app.Batch, 0, command.Limit)
	for rows.Next() {
		var batch app.Batch
		if err := rows.Scan(&batch.ID, &batch.TenantID, &batch.DepartmentID, &batch.Code,
			&batch.Name, &batch.AcademicYear, &batch.Status, &batch.Version,
			&batch.CreatedAt, &batch.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan batch row: %w", err)
		}
		batches = append(batches, batch)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read batch rows: %w", err)
	}
	return batches, nil
}
```

Write `ListTenants`, `ListDepartments`, and `ListPlacementDepartments` over `tenant.tenants`, `tenant.departments` (filtered by `tenant_id`), and `tenant.departments` (filtered by `organization_id`), following the template in Appendix A.5. Copy the `nullable*` helpers from Appendix A.4 if not present. Note that `tenant.tenants` has no `tenant_id` column: its query filters on `id` only, with no tenant predicate, because it is a platform-scope resource.

- [ ] **Step 4: Implement the app methods**

Four methods following the probe idiom in Appendix A.2, all using `pagination.EncodeTime(last.CreatedAt)`.

- [ ] **Step 5: Implement the handlers and register routes**

Create `services/tenant/internal/adapters/http/list_handler.go` with four handlers and the `listRequestParts` helper from Appendix A.3. Each handler follows the same five steps: parse the request parts, validate enum filters with `httpx.ParseEnumQuery`, authorize, call the service, then `httpx.WriteJSON(writer, http.StatusOK, page)`. Authorization:

```go
	// GET /v1/tenants — a global resource: tenant ID MUST be empty.
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "read", "tenants", "", "")
	// departments / batches — tenant-scoped
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "read", "departments", tenantID, tenantID)
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "read", "batches", tenantID, tenantID)
	// placement organization departments — a global resource
	decision, err := handler.authorizer.AuthorizeHTTP(request.Context(), request, "read", "placement_organizations", organizationID, "")
```

`tenants` and `placement_organizations` are in `GlobalResources` for the tenant route (`services/user/internal/app/authorization.go:132`); passing a non-empty tenant ID for them is rejected by `validateRequest` as `tenant_id must be empty for this global resource`. `GET /v1/tenants` therefore has no tenant path segment and does not use `listRequestParts`; parse its `limit` and `cursor` directly.

Register:

```go
	mux.HandleFunc("GET /v1/tenants", handler.listTenants)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/departments", handler.listDepartments)
	mux.HandleFunc("GET /v1/tenants/{tenant_id}/batches", handler.listBatches)
	mux.HandleFunc("GET /v1/placement-organizations/{organization_id}/departments", handler.listPlacementDepartments)
```

Note that `GET /v1/tenants` and the existing `POST /v1/tenants` coexist: Go 1.22+ `ServeMux` patterns include the method, so there is no conflict.

- [ ] **Step 6: Run the tests**

Run: `cd services/tenant && go test ./... -v`
Expected: PASS.

- [ ] **Step 7: Full workspace verification**

```bash
cd /home/shreesh/Documents/AlgoQX
make build
make test
make fmt-check
make vet
make lint
make test-migrations
```

Expected: all six exit 0. This is the gate before the branch is considered done.

- [ ] **Step 8: Update README and OpenAPI, then commit**

```bash
git add services/tenant/
git commit -m "feat: add tenant, department, and batch list endpoints"
```

---

## Appendix A: Canonical snippets

Tasks reference this appendix by name. Every snippet here is copied verbatim
into the named service package — Go generics are per-package and the services do
not share an app package, so each service declares its own `Page[T]`. This is
duplication by necessity, not by preference.

### A.1 The page type

Declared once per service, in that service's `internal/app` package:

```go
// Page is one keyset page. NextCursor is empty on the final page.
type Page[T any] struct {
	Items      []T    `json:"items"`
	NextCursor string `json:"next_cursor,omitempty"`
}
```

### A.2 The limit+1 probe idiom

Every app-layer list method follows this shape. `T` is the item type and
`lastSortValue` is whichever of `pagination.EncodeTime(...)` or
`pagination.FormatInt(...)` matches the endpoint's sort column:

```go
func (service *Service) ListThings(contextValue context.Context, capability centralauthz.Capability, command ListThings) (Page[Thing], error) {
	var page Page[Thing]
	err := database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		// One extra row reveals whether a further page exists, with no count query.
		probe := command
		probe.Limit = command.Limit + 1
		things, err := service.store.ListThings(contextValue, transaction, probe)
		if err != nil {
			return err
		}
		page = Page[Thing]{Items: []Thing{}}
		if len(things) > command.Limit {
			things = things[:command.Limit]
			last := things[len(things)-1]
			page.NextCursor = pagination.Encode(pagination.EncodeTime(last.CreatedAt), last.ID)
		}
		page.Items = append(page.Items, things...)
		return nil
	})
	if err != nil {
		return Page[Thing]{}, err
	}
	return page, nil
}
```

`Items` is initialised to an empty slice before appending so the JSON encoder
emits `[]` rather than `null`.

### A.3 The request-parts helper

Declared once per service HTTP adapter package:

```go
// listRequestParts parses the tenant path value and the two pagination
// parameters shared by every collection route in this service.
func listRequestParts(request *http.Request) (string, int, pagination.Cursor, error) {
	tenantID, err := httpx.ParseUUIDPathValue(request, "tenant_id")
	if err != nil {
		return "", 0, pagination.Cursor{}, err
	}
	limit, err := pagination.ParseLimit(request.URL.Query().Get("limit"), 20, 100)
	if err != nil {
		return "", 0, pagination.Cursor{}, err
	}
	cursor, _, err := pagination.Parse(request.URL.Query().Get("cursor"))
	if err != nil {
		return "", 0, pagination.Cursor{}, err
	}
	return tenantID, limit, cursor, nil
}
```

### A.4 The nullable filter helpers

Declared once per service repository package. They turn an absent optional
filter into a SQL `NULL` so one query serves both the filtered and unfiltered
case:

```go
func nullableUUID(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}

func nullableText(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}

// nullableTimestamp parses an RFC3339 nanosecond cursor sort value. The handler
// has already validated the cursor's shape, so a parse failure here is a
// programming error rather than user input.
func nullableTimestamp(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return nil
	}
	return parsed.UTC()
}

func nullableInt(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return nil
	}
	return parsed
}
```

Only include `nullableInt` in packages that page by version number
(question-bank, assessment); an unused function fails `make lint`.

### A.5 The keyset SELECT shape

Class B queries follow this template. The cursor comparison and the ORDER BY
must name the same columns in the same direction, or pagination silently skips
rows:

```sql
SELECT <columns>
FROM <schema>.<table>
WHERE tenant_id = $1
  AND deleted_at IS NULL
  AND ($2::text IS NULL OR <filter_column> = $2)
  AND ($3::timestamptz IS NULL OR (created_at, id) < ($3, $4))
ORDER BY created_at DESC, id DESC
LIMIT $5
```

---

## Completion checklist

- [ ] All 16 endpoints registered and returning `{items, next_cursor}`
- [ ] `make build`, `make test`, `make fmt-check`, `make vet`, `make lint`, `make test-migrations` all green
- [ ] Every Class A function has a `*_test.sql` proving it fails closed without an actor context
- [ ] `services/*/README.md` documents every new route with its class
- [ ] `services/*/api/openapi.yaml` has a path entry for every new route
- [ ] `TASKLIST.md` updated: the read surface is no longer a gap
- [ ] No `TODO`, stub, or placeholder committed

## Notes for the executor

**On the `limit + 1` probe.** Every app method asks the store for one more row than the caller requested, to learn whether a next page exists without a second count query. This is why every SQL function's upper bound is 101, not 100, while the handler still rejects a caller-supplied limit above 100. If you change one bound, change the other.

**On Class A versus Class B.** If you find yourself writing `AND candidate_id = $n` in a Go repository method, stop: that is a Class A query and its predicate belongs in a `SECURITY DEFINER` function. The spec's rationale is in the section "The security constraint that shapes everything".

**On column names.** Several steps tell you to verify column names against the migration files before running. The schemas evolved across up to 19 migrations per service, so the base `000002_domain.up.sql` is not the whole picture — soft-delete columns in particular arrive late. Check before you write the SELECT list, not after the migration fails.
