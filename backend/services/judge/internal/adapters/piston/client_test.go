package piston

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/aethercode/aethercode/services/judge/internal/dispatcher"
)

func pistonServer(t *testing.T, check func(executeRequest), response string) *Client {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/v2/execute" {
			t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
		var body executeRequest
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode request: %v", err)
		}
		if check != nil {
			check(body)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(response))
	}))
	t.Cleanup(server.Close)
	client, err := NewClient(server.URL, 5*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	return client
}

func run(t *testing.T, client *Client, req dispatcher.UnitRequest) *dispatcher.UnitVerdict {
	t.Helper()
	token, err := client.Submit(context.Background(), req)
	if err != nil {
		t.Fatalf("Submit: %v", err)
	}
	verdict, err := client.Poll(context.Background(), token)
	if err != nil || verdict == nil {
		t.Fatalf("Poll = %v, %v", verdict, err)
	}
	return verdict
}

func TestVerdicts(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name     string
		language string
		response string
		expected string
		want     string
	}{
		{"accepted ignores trailing whitespace", "python3", `{"run":{"stdout":"3 \r\n\n","stderr":"","code":0,"signal":null,"cpu_time":12,"memory":2048000}}`, "3", "accepted"},
		{"wrong answer", "python3", `{"run":{"stdout":"4\n","stderr":"","code":0,"signal":null}}`, "3\n", "wrong_answer"},
		{"compile error", "cpp17", `{"compile":{"stdout":"","stderr":"main.cpp:1: error","code":1,"signal":null},"run":{"stdout":"","stderr":"","code":null,"signal":null}}`, "", "compile_error"},
		{"java compiles inside run", "java", `{"run":{"stdout":"","stderr":"Main.java:3: error: ';' expected\nerror: compilation failed","code":1,"signal":null}}`, "", "compile_error"},
		{"timeout", "c", `{"run":{"stdout":"","stderr":"","code":null,"signal":"SIGKILL","status":"TO"}}`, "", "time_limit_exceeded"},
		{"runtime error", "c", `{"run":{"stdout":"","stderr":"segfault","code":139,"signal":null}}`, "", "runtime_error"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			client := pistonServer(t, nil, test.response)
			verdict := run(t, client, dispatcher.UnitRequest{Language: test.language, SourceCode: "src", ExpectedOutput: test.expected, TimeLimitMS: 1000, MemLimitKB: 262144})
			if verdict.Status != test.want {
				t.Fatalf("status = %q, want %q (%+v)", verdict.Status, test.want, verdict)
			}
		})
	}
}

func TestSubmitSendsLanguageFilesAndLimits(t *testing.T) {
	t.Parallel()
	client := pistonServer(t, func(body executeRequest) {
		if body.Language != "java" || body.Files[0].Name != "Main.java" || body.Files[0].Content != "class Main {}" {
			t.Errorf("language/files = %q %+v", body.Language, body.Files)
		}
		if body.Stdin != "1 2\n" || body.RunTimeout != 2*1500+3000 || body.RunMemoryLimit != 262144*1024 {
			t.Errorf("stdin/limits = %q %d %d", body.Stdin, body.RunTimeout, body.RunMemoryLimit)
		}
	}, `{"run":{"stdout":"3","stderr":"","code":0,"signal":null}}`)
	verdict := run(t, client, dispatcher.UnitRequest{Language: "java", SourceCode: "class Main {}", Stdin: "1 2\n", ExpectedOutput: "3", TimeLimitMS: 1500, MemLimitKB: 262144})
	if verdict.Status != "accepted" {
		t.Fatalf("status = %q", verdict.Status)
	}
}

func TestPollUnknownTokenIsInternalError(t *testing.T) {
	t.Parallel()
	client, err := NewClient("http://piston:2000", time.Second)
	if err != nil {
		t.Fatal(err)
	}
	verdict, err := client.Poll(context.Background(), "piston-missing")
	if err != nil || verdict.Status != "internal_error" {
		t.Fatalf("Poll = %+v, %v", verdict, err)
	}
}

func TestSubmitRejectsUnknownLanguage(t *testing.T) {
	t.Parallel()
	client, err := NewClient("http://piston:2000", time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.Submit(context.Background(), dispatcher.UnitRequest{Language: "cobol", SourceCode: "x"}); err == nil {
		t.Fatal("unknown language must be rejected")
	}
}
