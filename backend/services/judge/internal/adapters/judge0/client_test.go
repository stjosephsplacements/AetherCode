package judge0

import (
	"context"
	"encoding/base64"
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
		wantSourceCode := base64.StdEncoding.EncodeToString([]byte("print('hi')"))
		if body["source_code"] != wantSourceCode {
			t.Errorf("source_code = %v, want %q", body["source_code"], wantSourceCode)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"token": "abc-123-token"})
	}))
	defer server.Close()

	client, err := NewClient(server.URL, 5*time.Second, "")
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
	client, err := NewClient("http://unused.invalid", 5*time.Second, "")
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

	client, err := NewClient(server.URL, 5*time.Second, "")
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
					"status":         map[string]any{"id": testCase.statusID, "description": "x"},
					"stdout":         "b3V0cHV0",
					"stderr":         "",
					"compile_output": "",
					"time":           "0.045",
					"memory":         3524,
				})
			}))
			defer server.Close()

			client, err := NewClient(server.URL, 5*time.Second, "")
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
			if verdict.Stdout != "output" {
				t.Fatalf("Poll() verdict.Stdout = %q, want %q", verdict.Stdout, "output")
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

	client, err := NewClient(server.URL, 5*time.Second, "")
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
	if _, err := NewClient("not-a-url", 5*time.Second, ""); err == nil {
		t.Fatal("NewClient(\"not-a-url\") error = nil, want an error")
	}
	if _, err := NewClient("", 5*time.Second, ""); err == nil {
		t.Fatal("NewClient(\"\") error = nil, want an error")
	}
}

func TestClientSendsAuthTokenHeaderWhenConfigured(t *testing.T) {
	t.Parallel()
	var gotHeader string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotHeader = r.Header.Get("X-Auth-Token")
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"token": "abc-123-token"})
	}))
	defer server.Close()

	client, err := NewClient(server.URL, 5*time.Second, "super-secret-token")
	if err != nil {
		t.Fatalf("NewClient() error = %v", err)
	}
	if _, err := client.Submit(context.Background(), dispatcher.UnitRequest{
		Language:   "python3",
		SourceCode: "print('hi')",
	}); err != nil {
		t.Fatalf("Submit() error = %v", err)
	}
	if gotHeader != "super-secret-token" {
		t.Fatalf("X-Auth-Token header = %q, want %q", gotHeader, "super-secret-token")
	}
}

func TestClientOmitsAuthTokenHeaderWhenNotConfigured(t *testing.T) {
	t.Parallel()
	var gotHeader string
	sawHeader := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotHeader, sawHeader = r.Header.Get("X-Auth-Token"), r.Header.Get("X-Auth-Token") != ""
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"token": "abc-123-token"})
	}))
	defer server.Close()

	client, err := NewClient(server.URL, 5*time.Second, "")
	if err != nil {
		t.Fatalf("NewClient() error = %v", err)
	}
	if _, err := client.Submit(context.Background(), dispatcher.UnitRequest{
		Language:   "python3",
		SourceCode: "print('hi')",
	}); err != nil {
		t.Fatalf("Submit() error = %v", err)
	}
	if sawHeader {
		t.Fatalf("X-Auth-Token header = %q, want no header sent", gotHeader)
	}
}

func TestClientSubmitRejectsEmptySourceCode(t *testing.T) {
	t.Parallel()
	client, err := NewClient("http://unused.invalid", 5*time.Second, "")
	if err != nil {
		t.Fatalf("NewClient() error = %v", err)
	}
	if _, err := client.Submit(context.Background(), dispatcher.UnitRequest{Language: "python3", SourceCode: ""}); err == nil {
		t.Fatal("Submit() with empty source code error = nil, want an error")
	}
}

func TestClientSubmitNonSuccessStatusReturnsError(t *testing.T) {
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte("engine unavailable"))
	}))
	defer server.Close()

	client, err := NewClient(server.URL, 5*time.Second, "")
	if err != nil {
		t.Fatalf("NewClient() error = %v", err)
	}
	if _, err := client.Submit(context.Background(), dispatcher.UnitRequest{Language: "python3", SourceCode: "print(1)"}); err == nil {
		t.Fatal("Submit() with a 500 response error = nil, want an error")
	}
}

func TestClientPollNonSuccessStatusReturnsError(t *testing.T) {
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte("engine unavailable"))
	}))
	defer server.Close()

	client, err := NewClient(server.URL, 5*time.Second, "")
	if err != nil {
		t.Fatalf("NewClient() error = %v", err)
	}
	if _, err := client.Poll(context.Background(), "some-token"); err == nil {
		t.Fatal("Poll() with a 500 response error = nil, want an error")
	}
}

func TestClientPollUnrecognizedStatusIDReturnsError(t *testing.T) {
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"status": map[string]any{"id": 99, "description": "Unknown Future Status"},
		})
	}))
	defer server.Close()

	client, err := NewClient(server.URL, 5*time.Second, "")
	if err != nil {
		t.Fatalf("NewClient() error = %v", err)
	}
	if _, err := client.Poll(context.Background(), "some-token"); err == nil {
		t.Fatal("Poll() with an unrecognized status id error = nil, want an error, not a silently-wrong verdict")
	}
}
