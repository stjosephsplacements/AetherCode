// Package aethercode is an evaluation engine adapter for the AetherCode
// Execution Engine (github.com/stjosephsplacements/AetherCode-Execution-Engine),
// the college's own on-premise engine on go-judge (ADR-0028). It uses the
// engine as a pure executor: each unit is one job with a single test, the
// engine returns the full output, and this adapter grades it with
// dispatcher.OutputsMatch, so no expected output ever reaches the engine.
package aethercode

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/aethercode/aethercode/services/judge/internal/dispatcher"
)

const (
	// The engine's accepted ranges for per-test limits.
	minTimeLimitMS   = 100
	maxTimeLimitMS   = 20_000
	minMemoryLimitKB = 16_384
	maxMemoryLimitKB = 2_097_152

	// maxPendingVerdicts bounds verdicts kept between Submit and Poll.
	maxPendingVerdicts = 10_000
	// maxEventBytes bounds one SSE line; a verdict carries the full output.
	maxEventBytes = 32 << 20
	// The engine answers 429 when its queue is full; back off and retry.
	initialRetryDelay = 500 * time.Millisecond
	maxRetryDelay     = 10 * time.Second
)

// Client runs each unit during Submit: it creates a job, follows the job's
// event stream to its VERDICT, and keeps the verdict for the following Poll. A verdict lost to a judge restart resolves to
// internal_error, so the unit can be regraded.
type Client struct {
	baseURL string
	http    *http.Client
	sleep   func(context.Context, time.Duration) error

	mu       sync.Mutex
	verdicts map[string]dispatcher.UnitVerdict
}

// NewClient constructs a client for baseURL (e.g. "http://host.docker.internal:5100").
// timeout bounds one whole unit, queueing included. Redirects are never
// followed, so candidate code cannot be routed to another host.
func NewClient(baseURL string, timeout time.Duration) (*Client, error) {
	parsed, err := url.Parse(baseURL)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return nil, fmt.Errorf("aethercode: base URL is invalid")
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	return &Client{
		baseURL: strings.TrimRight(baseURL, "/"),
		http: &http.Client{
			Transport: transport,
			Timeout:   timeout,
			CheckRedirect: func(*http.Request, []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
		sleep:    sleepContext,
		verdicts: make(map[string]dispatcher.UnitVerdict),
	}, nil
}

type testCase struct {
	Input          string `json:"input"`
	ExpectedOutput string `json:"expected_output"`
}

type executeRequest struct {
	Language      string     `json:"language"`
	SourceCode    string     `json:"source_code"`
	Tests         []testCase `json:"tests"`
	TimeLimitMS   int        `json:"time_limit_ms"`
	MemoryLimitKB int        `json:"memory_limit_kb"`
}

type testResult struct {
	TestIndex   int    `json:"test_index"`
	Verdict     string `json:"verdict"`
	CPUTimeNS   int64  `json:"cpu_time_ns"`
	MemoryBytes int64  `json:"memory_bytes"`
	Stdout      string `json:"stdout"`
	Stderr      string `json:"stderr"`
}

type verdictData struct {
	Verdict       string       `json:"verdict"`
	CompileStderr string       `json:"compile_stderr"`
	Results       []testResult `json:"results"`
}

// Submit executes one unit and returns a token for its verdict.
func (client *Client) Submit(ctx context.Context, req dispatcher.UnitRequest) (string, error) {
	if req.SourceCode == "" {
		return "", fmt.Errorf("aethercode: source code is required")
	}
	language, err := lookupLanguage(req.Language)
	if err != nil {
		return "", err
	}
	jobID, streamToken, err := client.createJob(ctx, req.IdempotencyKey, executeRequest{
		Language:   language.engineName,
		SourceCode: req.SourceCode,
		// The expected output stays here: this adapter compares, not the engine.
		Tests:         []testCase{{Input: req.Stdin, ExpectedOutput: ""}},
		TimeLimitMS:   clamp(req.TimeLimitMS*language.timeMultiplier, minTimeLimitMS, maxTimeLimitMS),
		MemoryLimitKB: clamp(req.MemLimitKB, minMemoryLimitKB, maxMemoryLimitKB),
	})
	if err != nil {
		return "", err
	}
	data, err := client.awaitVerdict(ctx, jobID, streamToken)
	if err != nil {
		return "", err
	}
	token, err := newToken()
	if err != nil {
		return "", err
	}
	client.mu.Lock()
	defer client.mu.Unlock()
	if len(client.verdicts) >= maxPendingVerdicts {
		return "", fmt.Errorf("aethercode: too many verdicts awaiting poll")
	}
	client.verdicts[token] = verdictFor(data, 0, req.ExpectedOutput)
	return token, nil
}

// SubmitBatch runs several units of one program as a single engine job: one
// queue entry and one compile, with the tests running side by side. Every
// request must have the same language, source and limits. It returns one token
// per request, in order. As in Submit, the expected output is never sent.
func (client *Client) SubmitBatch(ctx context.Context, requests []dispatcher.UnitRequest) ([]string, error) {
	if len(requests) == 0 {
		return nil, fmt.Errorf("aethercode: a batch needs at least one unit")
	}
	if len(requests) > dispatcher.MaxBatchUnits {
		return nil, fmt.Errorf("aethercode: a batch holds at most %d units", dispatcher.MaxBatchUnits)
	}
	first := requests[0]
	if first.SourceCode == "" {
		return nil, fmt.Errorf("aethercode: source code is required")
	}
	language, err := lookupLanguage(first.Language)
	if err != nil {
		return nil, err
	}
	tests := make([]testCase, len(requests))
	for i, req := range requests {
		if req.Language != first.Language || req.SourceCode != first.SourceCode || req.TimeLimitMS != first.TimeLimitMS || req.MemLimitKB != first.MemLimitKB {
			return nil, fmt.Errorf("aethercode: unit %d differs from the first in language, source or limits", i)
		}
		tests[i] = testCase{Input: req.Stdin}
	}
	jobID, streamToken, err := client.createJob(ctx, batchKey(requests), executeRequest{
		Language:      language.engineName,
		SourceCode:    first.SourceCode,
		Tests:         tests,
		TimeLimitMS:   clamp(first.TimeLimitMS*language.timeMultiplier, minTimeLimitMS, maxTimeLimitMS),
		MemoryLimitKB: clamp(first.MemLimitKB, minMemoryLimitKB, maxMemoryLimitKB),
	})
	if err != nil {
		return nil, err
	}
	data, err := client.awaitVerdict(ctx, jobID, streamToken)
	if err != nil {
		return nil, err
	}
	tokens := make([]string, len(requests))
	for i := range tokens {
		if tokens[i], err = newToken(); err != nil {
			return nil, err
		}
	}
	client.mu.Lock()
	defer client.mu.Unlock()
	if len(client.verdicts)+len(tokens) > maxPendingVerdicts {
		return nil, fmt.Errorf("aethercode: too many verdicts awaiting poll")
	}
	for i, req := range requests {
		client.verdicts[tokens[i]] = verdictFor(data, i, req.ExpectedOutput)
	}
	return tokens, nil
}

// Forget drops a verdict that will not be polled.
func (client *Client) Forget(token string) {
	client.mu.Lock()
	defer client.mu.Unlock()
	delete(client.verdicts, token)
}

// batchKey is the idempotency key of a batch: the same units give the same key,
// so a batch submitted again after a timeout returns the original engine job.
func batchKey(requests []dispatcher.UnitRequest) string {
	sum := sha256.New()
	for _, req := range requests {
		sum.Write([]byte(req.IdempotencyKey))
		sum.Write([]byte{0})
	}
	return "batch-" + hex.EncodeToString(sum.Sum(nil))[:48]
}

// Poll returns and forgets the verdict stored by Submit.
func (client *Client) Poll(_ context.Context, token string) (*dispatcher.UnitVerdict, error) {
	client.mu.Lock()
	defer client.mu.Unlock()
	verdict, ok := client.verdicts[token]
	if !ok {
		return &dispatcher.UnitVerdict{Status: "internal_error", Stderr: "aethercode: verdict lost before poll"}, nil
	}
	delete(client.verdicts, token)
	return &verdict, nil
}

// createJob posts the unit. A non-empty idempotencyKey makes a retry after a timeout
// or restart return the original job instead of running the unit twice.
func (client *Client) createJob(ctx context.Context, idempotencyKey string, request executeRequest) (string, string, error) {
	body, err := json.Marshal(request)
	if err != nil {
		return "", "", fmt.Errorf("aethercode: encode execute request: %w", err)
	}
	delay := initialRetryDelay
	for {
		httpRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, client.baseURL+"/api/v1/execute", bytes.NewReader(body))
		if err != nil {
			return "", "", fmt.Errorf("aethercode: build execute request: %w", err)
		}
		httpRequest.Header.Set("Content-Type", "application/json")
		if idempotencyKey != "" {
			httpRequest.Header.Set("Idempotency-Key", idempotencyKey)
		}
		httpResponse, err := client.http.Do(httpRequest)
		if err != nil {
			return "", "", fmt.Errorf("aethercode: execute request failed: %w", err)
		}
		responseBody, _ := io.ReadAll(io.LimitReader(httpResponse.Body, 4096))
		_ = httpResponse.Body.Close()
		switch httpResponse.StatusCode {
		case http.StatusCreated, http.StatusOK: // 200: the engine already had this idempotency key
			var created struct {
				JobID       string `json:"job_id"`
				StreamToken string `json:"stream_token"`
			}
			if err := json.Unmarshal(responseBody, &created); err != nil || created.JobID == "" {
				return "", "", fmt.Errorf("aethercode: execute response has no job id")
			}
			return created.JobID, created.StreamToken, nil
		case http.StatusTooManyRequests:
			wait := delay
			if seconds, parseErr := strconv.Atoi(httpResponse.Header.Get("Retry-After")); parseErr == nil && seconds > 0 {
				wait = time.Duration(seconds) * time.Second
			}
			if err := client.sleep(ctx, min(wait, maxRetryDelay)); err != nil {
				return "", "", fmt.Errorf("aethercode: engine stayed busy: %w", err)
			}
			delay = min(delay*2, maxRetryDelay)
		default:
			return "", "", fmt.Errorf("aethercode: execute returned status %d: %s", httpResponse.StatusCode, responseBody)
		}
	}
}

// awaitVerdict follows the job's Server-Sent Events until VERDICT.
func (client *Client) awaitVerdict(ctx context.Context, jobID, streamToken string) (verdictData, error) {
	query := url.Values{"job_id": {jobID}}
	if streamToken != "" {
		query.Set("stream_token", streamToken)
	}
	httpRequest, err := http.NewRequestWithContext(ctx, http.MethodGet,
		client.baseURL+"/api/v1/stream?"+query.Encode(), nil)
	if err != nil {
		return verdictData{}, fmt.Errorf("aethercode: build stream request: %w", err)
	}
	httpRequest.Header.Set("Accept", "text/event-stream")
	httpResponse, err := client.http.Do(httpRequest)
	if err != nil {
		return verdictData{}, fmt.Errorf("aethercode: stream request failed: %w", err)
	}
	defer func() { _ = httpResponse.Body.Close() }()
	if httpResponse.StatusCode != http.StatusOK {
		return verdictData{}, fmt.Errorf("aethercode: stream returned status %d", httpResponse.StatusCode)
	}
	return readVerdict(httpResponse.Body)
}

// readVerdict parses an SSE stream and returns the data of its VERDICT event.
func readVerdict(stream io.Reader) (verdictData, error) {
	scanner := bufio.NewScanner(stream)
	scanner.Buffer(make([]byte, 64<<10), maxEventBytes)
	var event string
	var data []string
	for scanner.Scan() {
		line := strings.TrimSuffix(scanner.Text(), "\r")
		switch {
		case line == "":
			if event == "VERDICT" && len(data) > 0 {
				var envelope struct {
					Data verdictData `json:"data"`
				}
				if err := json.Unmarshal([]byte(strings.Join(data, "\n")), &envelope); err != nil {
					return verdictData{}, fmt.Errorf("aethercode: decode verdict: %w", err)
				}
				return envelope.Data, nil
			}
			event, data = "", nil
		case strings.HasPrefix(line, "event:"):
			event = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
		case strings.HasPrefix(line, "data:"):
			data = append(data, strings.TrimPrefix(strings.TrimPrefix(line, "data:"), " "))
		}
	}
	if err := scanner.Err(); err != nil {
		return verdictData{}, fmt.Errorf("aethercode: read stream: %w", err)
	}
	return verdictData{}, fmt.Errorf("aethercode: stream ended without a verdict")
}

// verdictFor grades the output of test index against its expected output.
func verdictFor(data verdictData, index int, expectedOutput string) dispatcher.UnitVerdict {
	if data.Verdict == "compilation_error" {
		return dispatcher.UnitVerdict{Status: "compile_error", CompileOutput: data.CompileStderr}
	}
	var result *testResult
	for i := range data.Results {
		if data.Results[i].TestIndex == index {
			result = &data.Results[i]
			break
		}
	}
	if result == nil {
		return dispatcher.UnitVerdict{Status: "internal_error", Stderr: "aethercode: no test result"}
	}
	verdict := dispatcher.UnitVerdict{
		Stdout:   result.Stdout,
		Stderr:   result.Stderr,
		TimeMS:   int(result.CPUTimeNS / int64(time.Millisecond)),
		MemoryKB: int(result.MemoryBytes / 1024),
	}
	switch result.Verdict {
	case "accepted", "wrong_answer":
		// The engine compared against an empty expectation; grade here.
		if dispatcher.OutputsMatch(result.Stdout, expectedOutput) {
			verdict.Status = "accepted"
		} else {
			verdict.Status = "wrong_answer"
		}
	case "time_limit":
		verdict.Status = "time_limit_exceeded"
	case "memory_limit":
		verdict.Status = "memory_limit_exceeded"
	case "runtime_error", "output_limit":
		verdict.Status = "runtime_error"
	default:
		verdict.Status = "internal_error"
	}
	return verdict
}

func clamp(value, low, high int) int {
	return max(low, min(high, value))
}

func sleepContext(ctx context.Context, duration time.Duration) error {
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func newToken() (string, error) {
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("aethercode: generate token: %w", err)
	}
	return "aethercode-" + hex.EncodeToString(raw), nil
}
