# Real Judge0 Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace judge's fake `Stub` evaluation engine with a real HTTP client that talks to a Judge0 instance, wired behind the platform's existing compatibility-approval gate, so `SubmitExecution`/`Poll` actually execute candidate code instead of always returning a canned "accepted" result.

**Architecture:** A new adapter package (`services/judge/internal/adapters/judge0`) implements the existing `dispatcher.Engine` interface unchanged — `Submit` POSTs to Judge0's `/submissions` endpoint, `Poll` GETs `/submissions/{token}` and maps Judge0's status vocabulary to this platform's existing verdict vocabulary. Wired into `services/judge/cmd/server/main.go`'s already-existing (currently no-op) `case "judge0":` branch, gated by the `JUDGE_ENGINE_COMPATIBILITY_APPROVED` flag that already exists.

**Tech Stack:** Go 1.26.7, standard `net/http`, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-24-judge0-execution-and-run-code-design.md` (Phase A)

## Global Constraints

- Go module path for shared code is `github.com/aethercode/aethercode/libs/pkg`.
- No placeholders, stub bodies, `TODO` comments, or fake data may be committed.
- Tests are table-driven and call `t.Parallel()`.
- Commits use Conventional Commits.
- This adapter can be unit-tested against a mocked Judge0 API (`httptest.Server`) but **cannot** be validated end-to-end against a real Judge0 instance in this environment — that requires the external gVisor compatibility approval (`deploy/validation/judge0-gvisor`), which is out of scope for this plan. Every task's "done" criteria are scoped to what's actually verifiable here.
- **Environment (mandatory on every Go command):**
  `export PATH="$HOME/.local/go/bin:$HOME/go/bin:$PATH"`,
  `export TMPDIR="$HOME/.cache/aethercode-tmp"`, `export GOTMPDIR="$HOME/.cache/aethercode-tmp"`.

---

## Design

### Why status IDs are looked up, not hardcoded

Judge0's numeric status IDs (`status.id` in its API responses) are documented as stable across versions for the common cases (1=In Queue, 2=Processing, 3=Accepted, 4=Wrong Answer, 5=Time Limit Exceeded, 6=Compilation Error, 13=Internal Error), but the exact set and meaning of runtime-error sub-statuses (7-12, covering different signals like SIGSEGV/SIGFPE/SIGABRT) can vary slightly by Judge0 version and configuration. Rather than hardcode an assumed mapping that might silently misclassify a real Judge0 instance's responses, this plan's client treats status IDs 7-12 as one bucket (`runtime_error`) — matching this platform's own verdict vocabulary, which likewise has only one `runtime_error` value, not separate ones per signal. This sidesteps the version-drift risk entirely: this platform never needed the finer-grained distinction Judge0 offers, so the mapping only needs to be precise about the handful of values it actually uses.

### The Engine contract, unchanged

```go
type Engine interface {
	Submit(ctx context.Context, req UnitRequest) (token string, err error)
	Poll(ctx context.Context, token string) (*UnitVerdict, error)
}

type UnitRequest struct {
	Language       string
	SourceCode     string
	Stdin          string
	TimeLimitMS    int
	MemLimitKB     int
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

A `nil, nil` return from `Poll` means "not yet terminal" — the existing `pollUntilDone` loop in `services/judge/internal/dispatcher/worker.go` already handles this by retrying up to `MaxPollAttempts`. Nothing in the dispatcher/worker layer changes in this plan.

Note: `UnitVerdict` has no `ExpectedOutput`-vs-`Stdout` comparison logic built in — Judge0 itself does this comparison server-side when you supply `expected_output` in the submission request, returning status 3 (Accepted) or 4 (Wrong Answer) accordingly. The client does not need to diff output itself.

---

## Task 1: Language ID mapping

**Files:**
- Create: `services/judge/internal/adapters/judge0/languages.go`
- Test: `services/judge/internal/adapters/judge0/languages_test.go`

**Interfaces:**
- Consumes: nothing
- Produces: `func judgeLanguageID(languageKey string) (int, error)`, consumed by Task 2's `Submit`

- [ ] **Step 1: Write the failing test**

Create `services/judge/internal/adapters/judge0/languages_test.go`:

```go
package judge0

import "testing"

func TestJudgeLanguageIDKnownLanguages(t *testing.T) {
	t.Parallel()
	testCases := []struct {
		name string
		key  string
		want int
	}{
		{name: "python3", key: "python3", want: 71},
		{name: "java", key: "java", want: 62},
		{name: "cpp17", key: "cpp17", want: 54},
		{name: "c", key: "c", want: 50},
		{name: "javascript", key: "javascript", want: 63},
		{name: "go", key: "go", want: 60},
	}
	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			got, err := judgeLanguageID(testCase.key)
			if err != nil {
				t.Fatalf("judgeLanguageID(%q) error = %v", testCase.key, err)
			}
			if got != testCase.want {
				t.Fatalf("judgeLanguageID(%q) = %d, want %d", testCase.key, got, testCase.want)
			}
		})
	}
}

func TestJudgeLanguageIDUnknownLanguageErrors(t *testing.T) {
	t.Parallel()
	if _, err := judgeLanguageID("cobol"); err == nil {
		t.Fatal("judgeLanguageID(\"cobol\") error = nil, want an error for an unmapped language")
	}
}

func TestJudgeLanguageIDEmptyKeyErrors(t *testing.T) {
	t.Parallel()
	if _, err := judgeLanguageID(""); err == nil {
		t.Fatal("judgeLanguageID(\"\") error = nil, want an error")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/judge && go test ./internal/adapters/judge0/... -run TestJudgeLanguageID -v`
Expected: FAIL — `judgeLanguageID` is not defined.

- [ ] **Step 3: Write the mapping**

Create `services/judge/internal/adapters/judge0/languages.go`:

```go
// Package judge0 contains evaluation engine adapters for the judge dispatcher.
package judge0

import "fmt"

// judgeLanguageIDs maps this platform's language keys (as stored in
// qbank.question_versions.supported_languages) to Judge0's numeric language
// IDs. This is the platform's own canonical language-key vocabulary — no
// language list existed before this adapter, so this map is the source of
// truth going forward. Extending supported languages is a one-line addition
// here, not a schema change.
var judgeLanguageIDs = map[string]int{
	"python3":    71,
	"java":       62,
	"cpp17":      54,
	"c":          50,
	"javascript": 63,
	"go":         60,
}

// judgeLanguageID resolves this platform's language key to Judge0's numeric
// language ID. An unmapped key is a validation error, never a silent default
// — running code under the wrong language's compiler/interpreter would
// produce misleading verdicts.
func judgeLanguageID(languageKey string) (int, error) {
	id, ok := judgeLanguageIDs[languageKey]
	if !ok {
		return 0, fmt.Errorf("judge0: unsupported language key %q", languageKey)
	}
	return id, nil
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/judge && go test ./internal/adapters/judge0/... -run TestJudgeLanguageID -v`
Expected: PASS, all three tests.

- [ ] **Step 5: Commit**

```bash
git add services/judge/internal/adapters/judge0/languages.go services/judge/internal/adapters/judge0/languages_test.go
git commit -m "feat: add Judge0 language ID mapping"
```

---

## Task 2: Judge0 HTTP client (Submit/Poll)

**Files:**
- Create: `services/judge/internal/adapters/judge0/client.go`
- Test: `services/judge/internal/adapters/judge0/client_test.go`

**Interfaces:**
- Consumes: `judgeLanguageID(string) (int, error)` from Task 1
- Produces: `type Client struct{...}`, `func NewClient(baseURL string, timeout time.Duration) (*Client, error)`, `func (c *Client) Submit(ctx, dispatcher.UnitRequest) (string, error)`, `func (c *Client) Poll(ctx, token string) (*dispatcher.UnitVerdict, error)` — `*Client` implements `dispatcher.Engine`

- [ ] **Step 1: Read the two reference HTTP-client patterns**

```bash
sed -n '1,70p' services/user/internal/adapters/authn/session_validator.go
sed -n '150,170p' services/gateway/internal/edge/handler.go
cat services/judge/internal/dispatcher/engine.go
```

Both existing clients zero `transport.Proxy` and set `CheckRedirect` to reject redirects (`http.ErrUseLastResponse`) — mirror this. `session_validator.go` is the closer template: it validates the URL at construction time and builds requests with `http.NewRequestWithContext` + `json.Marshal`.

- [ ] **Step 2: Write the failing test for Submit**

Create `services/judge/internal/adapters/judge0/client_test.go`:

```go
package judge0

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/aethercode/aethercode/services/judge/internal/dispatcher"
)

func TestClientSubmitReturnsToken(t *testing.T) {
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/submissions" {
			t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		if body["language_id"] != float64(71) {
			t.Errorf("language_id = %v, want 71", body["language_id"])
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"token": "abc-123-token"})
	}))
	defer server.Close()

	client, err := NewClient(server.URL, 5*time.Second)
	if err != nil {
		t.Fatalf("NewClient() error = %v", err)
	}
	token, err := client.Submit(context.Background(), dispatcher.UnitRequest{
		Language:    "python3",
		SourceCode:  "print('hi')",
		Stdin:       "",
		TimeLimitMS: 2000,
		MemLimitKB:  65536,
	})
	if err != nil {
		t.Fatalf("Submit() error = %v", err)
	}
	if token != "abc-123-token" {
		t.Fatalf("Submit() token = %q, want %q", token, "abc-123-token")
	}
}

func TestClientSubmitUnsupportedLanguageErrors(t *testing.T) {
	t.Parallel()
	client, err := NewClient("http://unused.invalid", 5*time.Second)
	if err != nil {
		t.Fatalf("NewClient() error = %v", err)
	}
	if _, err := client.Submit(context.Background(), dispatcher.UnitRequest{Language: "cobol", SourceCode: "x"}); err == nil {
		t.Fatal("Submit() with unsupported language error = nil, want an error")
	}
}

func TestClientPollInProgressReturnsNil(t *testing.T) {
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"status": map[string]any{"id": 2, "description": "Processing"},
		})
	}))
	defer server.Close()

	client, err := NewClient(server.URL, 5*time.Second)
	if err != nil {
		t.Fatalf("NewClient() error = %v", err)
	}
	verdict, err := client.Poll(context.Background(), "some-token")
	if err != nil {
		t.Fatalf("Poll() error = %v", err)
	}
	if verdict != nil {
		t.Fatalf("Poll() verdict = %+v, want nil for a non-terminal status", verdict)
	}
}

func TestClientPollTerminalStatuses(t *testing.T) {
	t.Parallel()
	testCases := []struct {
		name       string
		statusID   int
		wantStatus string
	}{
		{name: "accepted", statusID: 3, wantStatus: "accepted"},
		{name: "wrong answer", statusID: 4, wantStatus: "wrong_answer"},
		{name: "time limit exceeded", statusID: 5, wantStatus: "time_limit_exceeded"},
		{name: "compilation error", statusID: 6, wantStatus: "compile_error"},
		{name: "runtime error SIGSEGV", statusID: 7, wantStatus: "runtime_error"},
		{name: "runtime error NZEC", statusID: 11, wantStatus: "runtime_error"},
		{name: "internal error", statusID: 13, wantStatus: "internal_error"},
	}
	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(map[string]any{
					"status": map[string]any{"id": testCase.statusID, "description": "x"},
					"stdout":         "b3V0cHV0",
					"stderr":         "",
					"compile_output": "",
					"time":           "0.045",
					"memory":         3524,
				})
			}))
			defer server.Close()

			client, err := NewClient(server.URL, 5*time.Second)
			if err != nil {
				t.Fatalf("NewClient() error = %v", err)
			}
			verdict, err := client.Poll(context.Background(), "some-token")
			if err != nil {
				t.Fatalf("Poll() error = %v", err)
			}
			if verdict == nil {
				t.Fatal("Poll() verdict = nil, want a terminal verdict")
			}
			if verdict.Status != testCase.wantStatus {
				t.Fatalf("Poll() verdict.Status = %q, want %q", verdict.Status, testCase.wantStatus)
			}
		})
	}
}

func TestClientPollMemoryAndTimeParsed(t *testing.T) {
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"status": map[string]any{"id": 3, "description": "Accepted"},
			"time":   "1.250",
			"memory": 16384,
		})
	}))
	defer server.Close()

	client, err := NewClient(server.URL, 5*time.Second)
	if err != nil {
		t.Fatalf("NewClient() error = %v", err)
	}
	verdict, err := client.Poll(context.Background(), "some-token")
	if err != nil {
		t.Fatalf("Poll() error = %v", err)
	}
	if verdict.TimeMS != 1250 {
		t.Fatalf("verdict.TimeMS = %d, want 1250", verdict.TimeMS)
	}
	if verdict.MemoryKB != 16384 {
		t.Fatalf("verdict.MemoryKB = %d, want 16384", verdict.MemoryKB)
	}
}

func TestNewClientRejectsInvalidURL(t *testing.T) {
	t.Parallel()
	if _, err := NewClient("not-a-url", 5*time.Second); err == nil {
		t.Fatal("NewClient(\"not-a-url\") error = nil, want an error")
	}
	if _, err := NewClient("", 5*time.Second); err == nil {
		t.Fatal("NewClient(\"\") error = nil, want an error")
	}
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd services/judge && go test ./internal/adapters/judge0/... -run TestClient -v`
Expected: FAIL — package does not compile, `NewClient`/`Client` undefined.

- [ ] **Step 3: Write the client**

Create `services/judge/internal/adapters/judge0/client.go`:

```go
package judge0

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/aethercode/aethercode/services/judge/internal/dispatcher"
)

// Client is a real evaluation engine adapter backed by a Judge0 REST API
// instance. It implements dispatcher.Engine. Safe for concurrent use — it
// holds no mutable state beyond the underlying http.Client, which is itself
// safe for concurrent use.
type Client struct {
	baseURL string
	http    *http.Client
}

// NewClient constructs a Judge0 client. baseURL must be a valid absolute URL
// (e.g. "http://judge0:2358"); the client never follows redirects, since a
// redirect from the configured Judge0 endpoint would be unexpected and
// potentially route requests to an untrusted host.
func NewClient(baseURL string, timeout time.Duration) (*Client, error) {
	parsed, err := url.Parse(baseURL)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return nil, fmt.Errorf("judge0: base URL is invalid")
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	return &Client{
		baseURL: baseURL,
		http: &http.Client{
			Transport: transport,
			Timeout:   timeout,
			CheckRedirect: func(*http.Request, []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
	}, nil
}

type submitRequest struct {
	SourceCode     string `json:"source_code"`
	LanguageID     int    `json:"language_id"`
	Stdin          string `json:"stdin,omitempty"`
	ExpectedOutput string `json:"expected_output,omitempty"`
	CPUTimeLimit   string `json:"cpu_time_limit,omitempty"`
	MemoryLimit    int    `json:"memory_limit,omitempty"`
}

type submitResponse struct {
	Token string `json:"token"`
}

// Submit encodes and posts one execution unit to Judge0. Source, stdin, and
// expected output are base64-encoded per Judge0's ?base64_encoded=true
// contract, which avoids ambiguity with arbitrary candidate source containing
// control characters or non-UTF8 bytes.
func (client *Client) Submit(ctx context.Context, req dispatcher.UnitRequest) (string, error) {
	languageID, err := judgeLanguageID(req.Language)
	if err != nil {
		return "", err
	}
	body := submitRequest{
		SourceCode:     base64.StdEncoding.EncodeToString([]byte(req.SourceCode)),
		LanguageID:     languageID,
		Stdin:          base64.StdEncoding.EncodeToString([]byte(req.Stdin)),
		ExpectedOutput: base64.StdEncoding.EncodeToString([]byte(req.ExpectedOutput)),
		CPUTimeLimit:   strconv.FormatFloat(float64(req.TimeLimitMS)/1000.0, 'f', 3, 64),
		MemoryLimit:    req.MemLimitKB,
	}
	encoded, err := json.Marshal(body)
	if err != nil {
		return "", fmt.Errorf("judge0: encode submit request: %w", err)
	}
	httpRequest, err := http.NewRequestWithContext(ctx, http.MethodPost,
		client.baseURL+"/submissions?base64_encoded=true&wait=false", bytes.NewReader(encoded))
	if err != nil {
		return "", fmt.Errorf("judge0: build submit request: %w", err)
	}
	httpRequest.Header.Set("Content-Type", "application/json")
	httpRequest.Header.Set("Accept", "application/json")

	httpResponse, err := client.http.Do(httpRequest)
	if err != nil {
		return "", fmt.Errorf("judge0: submit request failed: %w", err)
	}
	defer func() { _ = httpResponse.Body.Close() }()
	if httpResponse.StatusCode != http.StatusCreated && httpResponse.StatusCode != http.StatusOK {
		responseBody, _ := io.ReadAll(io.LimitReader(httpResponse.Body, 4096))
		return "", fmt.Errorf("judge0: submit returned status %d: %s", httpResponse.StatusCode, responseBody)
	}
	var decoded submitResponse
	if err := json.NewDecoder(httpResponse.Body).Decode(&decoded); err != nil {
		return "", fmt.Errorf("judge0: decode submit response: %w", err)
	}
	if decoded.Token == "" {
		return "", fmt.Errorf("judge0: submit response had no token")
	}
	return decoded.Token, nil
}

type pollResponse struct {
	Status struct {
		ID          int    `json:"id"`
		Description string `json:"description"`
	} `json:"status"`
	Stdout        string `json:"stdout"`
	Stderr        string `json:"stderr"`
	CompileOutput string `json:"compile_output"`
	Time          string `json:"time"`
	Memory        int    `json:"memory"`
}

// judge0StatusVerdicts maps Judge0's numeric status.id to this platform's
// verdict vocabulary. Status IDs 1-2 (In Queue, Processing) are non-terminal
// and handled separately in Poll, not present in this map. IDs 7-12 (Judge0's
// various runtime-error signals: SIGSEGV, SIGFPE, SIGABRT, NZEC, etc.) all
// collapse to this platform's single "runtime_error" value — this platform
// never needed Judge0's finer-grained distinction.
var judge0StatusVerdicts = map[int]string{
	3:  "accepted",
	4:  "wrong_answer",
	5:  "time_limit_exceeded",
	6:  "compile_error",
	7:  "runtime_error",
	8:  "runtime_error",
	9:  "runtime_error",
	10: "runtime_error",
	11: "runtime_error",
	12: "runtime_error",
	13: "internal_error",
	14: "internal_error",
}

// Poll fetches the current state of a submission. A nil, nil return means the
// submission has not yet reached a terminal state (status.id 1 or 2).
func (client *Client) Poll(ctx context.Context, token string) (*dispatcher.UnitVerdict, error) {
	httpRequest, err := http.NewRequestWithContext(ctx, http.MethodGet,
		client.baseURL+"/submissions/"+url.PathEscape(token)+
			"?base64_encoded=true&fields=status,stdout,stderr,compile_output,time,memory", nil)
	if err != nil {
		return nil, fmt.Errorf("judge0: build poll request: %w", err)
	}
	httpRequest.Header.Set("Accept", "application/json")

	httpResponse, err := client.http.Do(httpRequest)
	if err != nil {
		return nil, fmt.Errorf("judge0: poll request failed: %w", err)
	}
	defer func() { _ = httpResponse.Body.Close() }()
	if httpResponse.StatusCode != http.StatusOK {
		responseBody, _ := io.ReadAll(io.LimitReader(httpResponse.Body, 4096))
		return nil, fmt.Errorf("judge0: poll returned status %d: %s", httpResponse.StatusCode, responseBody)
	}
	var decoded pollResponse
	if err := json.NewDecoder(httpResponse.Body).Decode(&decoded); err != nil {
		return nil, fmt.Errorf("judge0: decode poll response: %w", err)
	}

	if decoded.Status.ID == 1 || decoded.Status.ID == 2 {
		return nil, nil
	}
	verdictStatus, known := judge0StatusVerdicts[decoded.Status.ID]
	if !known {
		return nil, fmt.Errorf("judge0: unrecognized status id %d (%s)", decoded.Status.ID, decoded.Status.Description)
	}

	stdout, err := base64.StdEncoding.DecodeString(decoded.Stdout)
	if err != nil {
		return nil, fmt.Errorf("judge0: decode stdout: %w", err)
	}
	stderr, err := base64.StdEncoding.DecodeString(decoded.Stderr)
	if err != nil {
		return nil, fmt.Errorf("judge0: decode stderr: %w", err)
	}
	compileOutput, err := base64.StdEncoding.DecodeString(decoded.CompileOutput)
	if err != nil {
		return nil, fmt.Errorf("judge0: decode compile output: %w", err)
	}

	timeMS := 0
	if decoded.Time != "" {
		seconds, parseErr := strconv.ParseFloat(decoded.Time, 64)
		if parseErr != nil {
			return nil, fmt.Errorf("judge0: parse time %q: %w", decoded.Time, parseErr)
		}
		timeMS = int(seconds * 1000)
	}

	return &dispatcher.UnitVerdict{
		Status:        verdictStatus,
		Stdout:        string(stdout),
		Stderr:        string(stderr),
		CompileOutput: string(compileOutput),
		TimeMS:        timeMS,
		MemoryKB:      decoded.Memory,
	}, nil
}
```

`base64.StdEncoding.DecodeString("")` returns `[]byte{}, nil` — empty stdout/stderr/compile_output decode cleanly, no special-casing needed.

- [ ] **Step 4: Run to verify tests pass**

Run: `cd services/judge && go test ./internal/adapters/judge0/... -v`
Expected: PASS, all tests including Task 1's.

- [ ] **Step 5: Full verification**

```bash
cd services/judge && go build ./... && go vet ./...
cd /home/shreesh/Documents/AlgoQX && make fmt-check
```

- [ ] **Step 6: Commit**

```bash
git add services/judge/internal/adapters/judge0/client.go services/judge/internal/adapters/judge0/client_test.go
git commit -m "feat: add real Judge0 HTTP client implementing dispatcher.Engine"
```

---

## Task 3: Config and wiring behind the compatibility gate

**Files:**
- Modify: `services/judge/internal/config/runtime.go`
- Test: `services/judge/internal/config/runtime_test.go`
- Modify: `services/judge/cmd/server/main.go`
- Modify: `services/judge/README.md`

**Interfaces:**
- Consumes: `judge0.NewClient(baseURL string, timeout time.Duration) (*judge0.Client, error)` from Task 2
- Produces: `Runtime.Judge0BaseURL string`, `Runtime.Judge0Timeout time.Duration`; the `judge0` case in `main.go` actually starts a worker

- [ ] **Step 1: Read the current config file and main.go switch block in full**

```bash
cat services/judge/internal/config/runtime.go
sed -n '1,130p' services/judge/cmd/server/main.go
```

Confirm the exact current line numbers for the `switch dispatcherRuntime.EngineType` block (was at lines 97-125 as of this plan's writing, but re-read fresh — files change) and the exact variable names in scope at that point: `pool`, `runtime` (the judge config `Runtime`), `dispatcherRuntime`, `logger`.

- [ ] **Step 2: Write the failing config test**

Add to `services/judge/internal/config/runtime_test.go` (create if it doesn't exist, otherwise add to the existing table):

```go
func TestLoadJudge0BaseURLRequiredWhenEngineIsJudge0(t *testing.T) {
	t.Parallel()
	t.Setenv("JUDGE_ENGINE_COMPATIBILITY_APPROVED", "true")
	t.Setenv("JUDGE0_BASE_URL", "")
	_, err := Load("development")
	if err == nil {
		t.Fatal("Load() error = nil, want an error when JUDGE0_BASE_URL is unset")
	}
}

func TestLoadJudge0BaseURLAccepted(t *testing.T) {
	t.Parallel()
	t.Setenv("JUDGE0_BASE_URL", "http://judge0.internal:2358")
	runtime, err := Load("development")
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if runtime.Judge0BaseURL != "http://judge0.internal:2358" {
		t.Fatalf("Judge0BaseURL = %q, want %q", runtime.Judge0BaseURL, "http://judge0.internal:2358")
	}
}
```

Read the existing `Load` function's test file first (`services/judge/internal/config/runtime_test.go` if it exists) to match its existing test style — table-driven if that's the established pattern in this file, otherwise mirror whatever shape is already there.

- [ ] **Step 3: Run to verify it fails**

Run: `cd services/judge && go test ./internal/config/... -run TestLoadJudge0 -v`
Expected: FAIL — `Judge0BaseURL` field doesn't exist on `Runtime`.

- [ ] **Step 4: Add the config fields**

In `services/judge/internal/config/runtime.go`, add to the `Runtime` struct:

```go
	Judge0BaseURL string
	Judge0Timeout time.Duration
```

(add `"time"` to imports if not already present). In `Load`, after the existing `EngineCompatibilityApproved` line, add:

```go
	runtime.Judge0BaseURL = strings.TrimSpace(value("JUDGE0_BASE_URL", ""))
	judge0TimeoutSeconds := strings.TrimSpace(value("JUDGE0_TIMEOUT_SECONDS", "10"))
	timeoutSeconds, timeoutErr := strconv.Atoi(judge0TimeoutSeconds)
	if timeoutErr != nil || timeoutSeconds < 1 || timeoutSeconds > 120 {
		return Runtime{}, fmt.Errorf("JUDGE0_TIMEOUT_SECONDS must be an integer between 1 and 120")
	}
	runtime.Judge0Timeout = time.Duration(timeoutSeconds) * time.Second
```

Then, after all other validation in `Load` (find where the function currently returns), add the requirement check — `JUDGE0_BASE_URL` is required whenever the compatibility flag is set (the flag being true is the signal that a real Judge0 deployment exists to point at):

```go
	if runtime.EngineCompatibilityApproved && runtime.Judge0BaseURL == "" {
		return Runtime{}, fmt.Errorf("JUDGE0_BASE_URL is required when JUDGE_ENGINE_COMPATIBILITY_APPROVED=true")
	}
```

- [ ] **Step 5: Run to verify tests pass**

Run: `cd services/judge && go test ./internal/config/... -v`
Expected: PASS.

- [ ] **Step 6: Wire the real client into main.go**

In `services/judge/cmd/server/main.go`, replace the `case "judge0":` branch's body. Current state (no-op):

```go
		case "judge0":
			if !runtime.EngineCompatibilityApproved {
				logger.Warn("dispatcher: engine=judge0 requires JUDGE_ENGINE_COMPATIBILITY_APPROVED=true; dispatcher not started")
			} else {
				logger.Warn("dispatcher: judge0 engine adapter not available in this build; dispatcher not started")
			}
```

Replace with (mirroring the `"stub"` case immediately below it in the same switch, which already shows the full `RabbitURL` → `NewDispatchStoreAdapter` → `NewWorker` → `NewConsumer` wiring to copy):

```go
		case "judge0":
			if !runtime.EngineCompatibilityApproved {
				logger.Warn("dispatcher: engine=judge0 requires JUDGE_ENGINE_COMPATIBILITY_APPROVED=true; dispatcher not started")
				break
			}
			if runtime.RabbitURL == "" {
				return fmt.Errorf("dispatcher: JUDGE_RABBITMQ_URL is required when JUDGE_DISPATCHER_ENABLED=true")
			}
			eng, engErr := judge0adapter.NewClient(runtime.Judge0BaseURL, runtime.Judge0Timeout)
			if engErr != nil {
				return fmt.Errorf("dispatcher: construct judge0 client: %w", engErr)
			}
			storeAdapter := repo.NewDispatchStoreAdapter(pool)
			worker, workerErr := dispatcher.NewWorker(storeAdapter, eng, dispatcherRuntime, logger)
			if workerErr != nil {
				return workerErr
			}
			consumer, consumerErr := amqpadapter.NewConsumer(runtime.RabbitURL, worker, logger)
			if consumerErr != nil {
				return consumerErr
			}
			go func() {
				if err := consumer.Start(contextValue); err != nil && contextValue.Err() == nil {
					logger.Error("dispatcher consumer stopped unexpectedly", "error", err)
				}
			}()
```

`judge0adapter` is already imported in this file (used by the `"stub"` case as `judge0adapter.NewStub()`) — no new import needed, `NewClient` lives in the same package.

- [ ] **Step 7: Full build and verification**

```bash
cd services/judge && go build ./... && go vet ./...
cd /home/shreesh/Documents/AlgoQX && make build && make test && make vet && make fmt-check && make lint
```

Expected: all pass. This does not start a real dispatcher against a live Judge0 (none is running in this environment) — it only proves the code compiles, the config validates correctly, and the construction path is reachable.

- [ ] **Step 8: Document and commit**

Update `services/judge/README.md`: document `JUDGE_ENGINE=judge0`, `JUDGE0_BASE_URL`, `JUDGE0_TIMEOUT_SECONDS`, and state plainly that this engine is gated behind `JUDGE_ENGINE_COMPATIBILITY_APPROVED=true`, which itself requires the external gVisor compatibility validation (`deploy/validation/judge0-gvisor`) — this README section should not imply the engine is production-validated, only that the code path exists and is unit-tested.

```bash
git add services/judge/internal/config/ services/judge/cmd/server/main.go services/judge/README.md
git commit -m "feat: wire real Judge0 client behind the compatibility approval gate"
```

---

## Completion checklist

- [ ] `judgeLanguageID` maps at least python3/java/cpp17/c/javascript/go, errors on unmapped keys
- [ ] `judge0.Client` implements `dispatcher.Engine` — `Submit` posts correctly-shaped, base64-encoded requests; `Poll` correctly distinguishes non-terminal (nil) from terminal states and maps every status ID this platform's verdict vocabulary supports
- [ ] `JUDGE0_BASE_URL` is required exactly when `JUDGE_ENGINE_COMPATIBILITY_APPROVED=true`
- [ ] The `judge0` case in `main.go` constructs and starts a real worker, mirroring the `stub` case's wiring
- [ ] `make build`, `test`, `vet`, `fmt-check`, `lint` all pass
- [ ] README documents the new config and is explicit that this is unit-tested, not live-validated against a real Judge0 instance

## Notes for the executor

**On the "cannot be live-validated" constraint.** Do not attempt to spin up a real Judge0 container to test against — `deploy/compose/README.judge-control.md` explicitly forbids adding Judge0 to the local compose file until the external gVisor compatibility evidence suite is approved. `httptest`-mocked coverage is the correct and complete scope for this plan.

**On status ID 14 (Exec Format Error).** Mapped to `internal_error` in this plan since it represents Judge0 itself failing to execute the submission (e.g. wrong binary format), not a candidate code defect — consistent with how this platform's existing `internal_error` verdict is used elsewhere (an engine-side failure, not a candidate-attributable outcome).
