package aethercode

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/aethercode/aethercode/services/judge/internal/dispatcher"
)

// fakeEngine answers like the engine: 201 with a job id, then an SSE stream
// whose VERDICT carries the given data. busy makes the first N creates 429.
func fakeEngine(t *testing.T, busy int32, verdict string, captured *executeRequest) *httptest.Server {
	t.Helper()
	var creates atomic.Int32
	return httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/api/v1/execute":
			if creates.Add(1) <= busy {
				writer.Header().Set("Retry-After", "1")
				writer.WriteHeader(http.StatusTooManyRequests)
				return
			}
			if captured != nil {
				if err := json.NewDecoder(request.Body).Decode(captured); err != nil {
					t.Errorf("decode execute request: %v", err)
				}
			}
			writer.WriteHeader(http.StatusCreated)
			_, _ = writer.Write([]byte(`{"job_id":"job-1"}`))
		case "/api/v1/stream":
			if request.URL.Query().Get("job_id") != "job-1" {
				t.Errorf("stream for unexpected job %q", request.URL.RawQuery)
			}
			writer.Header().Set("Content-Type", "text/event-stream")
			flusher := writer.(http.Flusher)
			_, _ = fmt.Fprint(writer, "id: job-1:1-0\nevent: QUEUED\ndata: {\"type\":\"QUEUED\"}\n\n: heartbeat\n")
			flusher.Flush()
			// Split one event across writes, as a network would.
			event := "event: VERDICT\ndata: {\"type\":\"VERDICT\",\"data\":" + verdict + "}\n\n"
			_, _ = fmt.Fprint(writer, event[:20])
			flusher.Flush()
			_, _ = fmt.Fprint(writer, event[20:])
		default:
			http.NotFound(writer, request)
		}
	}))
}

func run(t *testing.T, server *httptest.Server, request dispatcher.UnitRequest) dispatcher.UnitVerdict {
	t.Helper()
	client, err := NewClient(server.URL, 10*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	client.sleep = func(context.Context, time.Duration) error { return nil }
	token, err := client.Submit(context.Background(), request)
	if err != nil {
		t.Fatalf("Submit: %v", err)
	}
	verdict, err := client.Poll(context.Background(), token)
	if err != nil {
		t.Fatalf("Poll: %v", err)
	}
	return *verdict
}

func TestGradesOutputLocally(t *testing.T) {
	var sent executeRequest
	server := fakeEngine(t, 2, `{"verdict":"wrong_answer","results":[{"test_index":0,"verdict":"wrong_answer","cpu_time_ns":7000000,"memory_bytes":4194304,"stdout":"42  \r\n\n","stderr":""}]}`, &sent)
	defer server.Close()

	verdict := run(t, server, dispatcher.UnitRequest{
		Language: "python3", SourceCode: "print(42)", Stdin: "21\n", ExpectedOutput: "42\n", TimeLimitMS: 1000, MemLimitKB: 1024,
	})
	if verdict.Status != "accepted" || verdict.TimeMS != 7 || verdict.MemoryKB != 4096 {
		t.Fatalf("verdict = %+v, want accepted after normalizing whitespace", verdict)
	}
	if sent.Language != "python" || sent.Mode != "run" || sent.TimeLimitMS != 2000 || sent.MemoryLimitKB != minMemoryLimitKB {
		t.Fatalf("request = %+v, want python run mode, doubled time, memory clamped to the engine minimum", sent)
	}
	if len(sent.Tests) != 1 || sent.Tests[0].Input != "21\n" || sent.Tests[0].ExpectedOutput != "" {
		t.Fatalf("tests = %+v, want the input only: the expected output never leaves the judge", sent.Tests)
	}
}

func TestMapsEngineVerdicts(t *testing.T) {
	for _, testCase := range []struct{ data, want string }{
		{`{"verdict":"accepted","results":[{"verdict":"accepted","stdout":"1\n"}]}`, "wrong_answer"},
		{`{"verdict":"compilation_error","compile_stderr":"main.c:1: error"}`, "compile_error"},
		{`{"verdict":"time_limit","results":[{"verdict":"time_limit"}]}`, "time_limit_exceeded"},
		{`{"verdict":"memory_limit","results":[{"verdict":"memory_limit"}]}`, "memory_limit_exceeded"},
		{`{"verdict":"runtime_error","results":[{"verdict":"output_limit"}]}`, "runtime_error"},
		{`{"verdict":"internal_error","results":[]}`, "internal_error"},
	} {
		server := fakeEngine(t, 0, testCase.data, nil)
		verdict := run(t, server, dispatcher.UnitRequest{Language: "c", SourceCode: "int main(){}", ExpectedOutput: "2\n", TimeLimitMS: 1000, MemLimitKB: 65536})
		server.Close()
		if verdict.Status != testCase.want {
			t.Errorf("%s: status = %q, want %q", testCase.data, verdict.Status, testCase.want)
		}
		if testCase.want == "compile_error" && !strings.Contains(verdict.CompileOutput, "error") {
			t.Errorf("compile output = %q", verdict.CompileOutput)
		}
	}
}

func TestRejectsUnknownLanguagesAndLostVerdicts(t *testing.T) {
	client, err := NewClient("http://127.0.0.1:1", time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.Submit(context.Background(), dispatcher.UnitRequest{Language: "cobol", SourceCode: "x"}); err == nil {
		t.Fatal("an unmapped language must be rejected")
	}
	verdict, err := client.Poll(context.Background(), "aethercode-unknown")
	if err != nil || verdict.Status != "internal_error" {
		t.Fatalf("lost verdict = %+v, %v; want internal_error so the unit is regraded", verdict, err)
	}
}
