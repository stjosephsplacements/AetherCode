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
	if sent.Language != "python" || sent.TimeLimitMS != 2000 || sent.MemoryLimitKB != minMemoryLimitKB {
		t.Fatalf("request = %+v, want python, doubled time, memory clamped to the engine minimum", sent)
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

func TestSendsTheUnitAsIdempotencyKeyAndAcceptsARepeatedJob(t *testing.T) {
	var key string
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/api/v1/execute":
			key = request.Header.Get("Idempotency-Key")
			writer.WriteHeader(http.StatusOK) // the engine already had this key
			_, _ = writer.Write([]byte(`{"job_id":"job-1"}`))
		case "/api/v1/stream":
			writer.Header().Set("Content-Type", "text/event-stream")
			_, _ = fmt.Fprint(writer, "event: VERDICT\ndata: {\"type\":\"VERDICT\",\"data\":{\"verdict\":\"accepted\",\"results\":[{\"test_index\":0,\"verdict\":\"accepted\",\"stdout\":\"1\\n\"}]}}\n\n")
		}
	}))
	defer server.Close()

	verdict := run(t, server, dispatcher.UnitRequest{Language: "c", SourceCode: "x", ExpectedOutput: "1\n", IdempotencyKey: "unit-7"})
	if key != "unit-7" || verdict.Status != "accepted" {
		t.Fatalf("key = %q, verdict = %+v, want the unit id as the key and an accepted verdict from the repeated job", key, verdict)
	}
}

func TestSubmitBatchRunsAllUnitsInOneEngineJobAndGradesEachOne(t *testing.T) {
	var executes atomic.Int32
	var sent executeRequest
	var key string
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/api/v1/execute":
			executes.Add(1)
			key = request.Header.Get("Idempotency-Key")
			_ = json.NewDecoder(request.Body).Decode(&sent)
			writer.WriteHeader(http.StatusCreated)
			_, _ = writer.Write([]byte(`{"job_id":"job-1"}`))
		case "/api/v1/stream":
			writer.Header().Set("Content-Type", "text/event-stream")
			// Results arrive out of order; each is matched by its test index.
			verdict := `{"verdict":"wrong_answer","results":[` +
				`{"test_index":2,"verdict":"time_limit","cpu_time_ns":2000000000},` +
				`{"test_index":0,"verdict":"accepted","stdout":"a\n","cpu_time_ns":1000000},` +
				`{"test_index":1,"verdict":"accepted","stdout":"WRONG\n","cpu_time_ns":2000000}]}`
			_, _ = fmt.Fprint(writer, "event: VERDICT\ndata: {\"type\":\"VERDICT\",\"data\":"+verdict+"}\n\n")
		}
	}))
	defer server.Close()

	client, err := NewClient(server.URL, 10*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	requests := []dispatcher.UnitRequest{
		{Language: "python3", SourceCode: "x", Stdin: "in0", ExpectedOutput: "a\n", TimeLimitMS: 1000, MemLimitKB: 65536, IdempotencyKey: "u0"},
		{Language: "python3", SourceCode: "x", Stdin: "in1", ExpectedOutput: "b\n", TimeLimitMS: 1000, MemLimitKB: 65536, IdempotencyKey: "u1"},
		{Language: "python3", SourceCode: "x", Stdin: "in2", ExpectedOutput: "c\n", TimeLimitMS: 1000, MemLimitKB: 65536, IdempotencyKey: "u2"},
	}
	tokens, err := client.SubmitBatch(context.Background(), requests)
	if err != nil {
		t.Fatalf("SubmitBatch: %v", err)
	}
	if executes.Load() != 1 || len(sent.Tests) != 3 {
		t.Fatalf("execute calls = %d with %d tests, want one call carrying all 3", executes.Load(), len(sent.Tests))
	}
	for i, test := range sent.Tests {
		if test.ExpectedOutput != "" || test.Input != fmt.Sprintf("in%d", i) {
			t.Errorf("test %d = %+v, want its input only: the expected output never leaves the judge", i, test)
		}
	}
	if !strings.HasPrefix(key, "batch-") || len(key) < 20 {
		t.Errorf("idempotency key = %q, want a batch key", key)
	}

	want := []string{"accepted", "wrong_answer", "time_limit_exceeded"}
	for i, token := range tokens {
		verdict, err := client.Poll(context.Background(), token)
		if err != nil {
			t.Fatal(err)
		}
		if verdict.Status != want[i] {
			t.Errorf("unit %d status = %q, want %q", i, verdict.Status, want[i])
		}
	}
}

func TestSubmitBatchSharesACompileErrorAndRejectsMixedPrograms(t *testing.T) {
	server := fakeEngine(t, 0, `{"verdict":"compilation_error","compile_stderr":"boom"}`, nil)
	defer server.Close()
	client, err := NewClient(server.URL, 10*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	same := []dispatcher.UnitRequest{
		{Language: "c", SourceCode: "x", Stdin: "1", TimeLimitMS: 1000, MemLimitKB: 65536},
		{Language: "c", SourceCode: "x", Stdin: "2", TimeLimitMS: 1000, MemLimitKB: 65536},
	}
	tokens, err := client.SubmitBatch(context.Background(), same)
	if err != nil {
		t.Fatalf("SubmitBatch: %v", err)
	}
	for _, token := range tokens {
		verdict, _ := client.Poll(context.Background(), token)
		if verdict.Status != "compile_error" || verdict.CompileOutput != "boom" {
			t.Errorf("verdict = %+v, want compile_error with the compiler's output", verdict)
		}
	}

	mixed := []dispatcher.UnitRequest{same[0], {Language: "c", SourceCode: "y", Stdin: "2", TimeLimitMS: 1000, MemLimitKB: 65536}}
	if _, err := client.SubmitBatch(context.Background(), mixed); err == nil {
		t.Error("a batch of different programs was accepted")
	}
	if _, err := client.SubmitBatch(context.Background(), nil); err == nil {
		t.Error("an empty batch was accepted")
	}
	too := make([]dispatcher.UnitRequest, dispatcher.MaxBatchUnits+1)
	for i := range too {
		too[i] = same[0]
	}
	if _, err := client.SubmitBatch(context.Background(), too); err == nil {
		t.Error("a batch above the limit was accepted")
	}
}

func TestForgetReleasesAVerdict(t *testing.T) {
	server := fakeEngine(t, 0, `{"verdict":"accepted","results":[{"test_index":0,"verdict":"accepted","stdout":"x"}]}`, nil)
	defer server.Close()
	client, _ := NewClient(server.URL, 10*time.Second)
	tokens, err := client.SubmitBatch(context.Background(), []dispatcher.UnitRequest{{Language: "c", SourceCode: "x", TimeLimitMS: 1000, MemLimitKB: 65536}})
	if err != nil {
		t.Fatal(err)
	}
	client.Forget(tokens[0])
	if verdict, _ := client.Poll(context.Background(), tokens[0]); verdict.Status != "internal_error" {
		t.Fatalf("a forgotten verdict polled as %q, want internal_error", verdict.Status)
	}
}
