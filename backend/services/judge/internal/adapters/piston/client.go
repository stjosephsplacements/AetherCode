// Package piston is an evaluation engine adapter for a self-hosted Piston
// instance (github.com/engineer-man/piston). Unlike Judge0's isolate sandbox,
// Piston runs on cgroup v2 hosts, so it serves servers that cannot switch to
// cgroup v1.
package piston

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/aethercode/aethercode/services/judge/internal/dispatcher"
)

// compileTimeoutMS bounds compilation separately from the unit's run limit.
const compileTimeoutMS = 10_000

// maxPendingVerdicts bounds verdicts kept between Submit and Poll. The worker
// polls right after submitting, so the map stays tiny in practice.
const maxPendingVerdicts = 10_000

var javaCompileFailure = regexp.MustCompile(`error: compilation failed`)

// Client runs each unit synchronously during Submit, because Piston's API has
// no queue, and hands the verdict to the following Poll through an in-memory
// map keyed by a random token. A token whose verdict was lost (the judge
// restarted between Submit and Poll) resolves to internal_error, the same
// outcome as an engine outage, so the unit can be regraded.
type Client struct {
	baseURL string
	http    *http.Client

	mu       sync.Mutex
	verdicts map[string]dispatcher.UnitVerdict
}

// NewClient constructs a Piston client for baseURL (e.g. "http://piston:2000").
// Redirects are never followed: a redirect from the engine would be
// unexpected and could route candidate code to an untrusted host.
func NewClient(baseURL string, timeout time.Duration) (*Client, error) {
	parsed, err := url.Parse(baseURL)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return nil, fmt.Errorf("piston: base URL is invalid")
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
		verdicts: make(map[string]dispatcher.UnitVerdict),
	}, nil
}

type file struct {
	Name    string `json:"name"`
	Content string `json:"content"`
}

type executeRequest struct {
	Language       string `json:"language"`
	Version        string `json:"version"`
	Files          []file `json:"files"`
	Stdin          string `json:"stdin"`
	CompileTimeout int    `json:"compile_timeout"`
	RunTimeout     int    `json:"run_timeout"`
	RunMemoryLimit int64  `json:"run_memory_limit"`
}

type stage struct {
	Stdout  string   `json:"stdout"`
	Stderr  string   `json:"stderr"`
	Code    *int     `json:"code"`
	Signal  *string  `json:"signal"`
	Status  *string  `json:"status"`
	CPUTime *float64 `json:"cpu_time"`
	Wall    *float64 `json:"wall_time"`
	Memory  *float64 `json:"memory"`
}

type executeResponse struct {
	Compile *stage `json:"compile"`
	Run     stage  `json:"run"`
}

// Submit executes one unit and returns a token for its verdict.
func (client *Client) Submit(ctx context.Context, req dispatcher.UnitRequest) (string, error) {
	if req.SourceCode == "" {
		return "", fmt.Errorf("piston: source code is required")
	}
	language, err := lookupLanguage(req.Language)
	if err != nil {
		return "", err
	}
	verdict, err := client.execute(ctx, language, req)
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
		return "", fmt.Errorf("piston: too many verdicts awaiting poll")
	}
	client.verdicts[token] = verdict
	return token, nil
}

// Poll returns and forgets the verdict stored by Submit.
func (client *Client) Poll(_ context.Context, token string) (*dispatcher.UnitVerdict, error) {
	client.mu.Lock()
	defer client.mu.Unlock()
	verdict, ok := client.verdicts[token]
	if !ok {
		return &dispatcher.UnitVerdict{Status: "internal_error", Stderr: "piston: verdict lost before poll"}, nil
	}
	delete(client.verdicts, token)
	return &verdict, nil
}

func (client *Client) execute(ctx context.Context, language language, req dispatcher.UnitRequest) (dispatcher.UnitVerdict, error) {
	body, err := json.Marshal(executeRequest{
		Language:       language.pistonName,
		Version:        "*",
		Files:          []file{{Name: language.fileName, Content: req.SourceCode}},
		Stdin:          req.Stdin,
		CompileTimeout: compileTimeoutMS,
		RunTimeout:     req.TimeLimitMS*language.timeMultiplier + language.compileInRunMS,
		RunMemoryLimit: int64(req.MemLimitKB) * 1024,
	})
	if err != nil {
		return dispatcher.UnitVerdict{}, fmt.Errorf("piston: encode execute request: %w", err)
	}
	httpRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, client.baseURL+"/api/v2/execute", bytes.NewReader(body))
	if err != nil {
		return dispatcher.UnitVerdict{}, fmt.Errorf("piston: build execute request: %w", err)
	}
	httpRequest.Header.Set("Content-Type", "application/json")
	httpRequest.Header.Set("Accept", "application/json")
	httpResponse, err := client.http.Do(httpRequest)
	if err != nil {
		return dispatcher.UnitVerdict{}, fmt.Errorf("piston: execute request failed: %w", err)
	}
	defer func() { _ = httpResponse.Body.Close() }()
	if httpResponse.StatusCode != http.StatusOK {
		responseBody, _ := io.ReadAll(io.LimitReader(httpResponse.Body, 4096))
		return dispatcher.UnitVerdict{}, fmt.Errorf("piston: execute returned status %d: %s", httpResponse.StatusCode, responseBody)
	}
	var decoded executeResponse
	if err := json.NewDecoder(httpResponse.Body).Decode(&decoded); err != nil {
		return dispatcher.UnitVerdict{}, fmt.Errorf("piston: decode execute response: %w", err)
	}
	return verdictFor(decoded, req.ExpectedOutput, language), nil
}

func verdictFor(response executeResponse, expectedOutput string, language language) dispatcher.UnitVerdict {
	if compile := response.Compile; compile != nil && (compile.Code == nil || *compile.Code != 0) {
		return dispatcher.UnitVerdict{Status: "compile_error", CompileOutput: firstNonEmpty(compile.Stderr, compile.Stdout)}
	}
	run := response.Run
	exitedNonZero := run.Code == nil || *run.Code != 0
	if language.compileInRunMS > 0 && exitedNonZero && javaCompileFailure.MatchString(run.Stderr) {
		return dispatcher.UnitVerdict{Status: "compile_error", CompileOutput: run.Stderr}
	}
	verdict := dispatcher.UnitVerdict{Stdout: run.Stdout, Stderr: run.Stderr}
	if run.CPUTime != nil {
		verdict.TimeMS = int(*run.CPUTime)
	} else if run.Wall != nil {
		verdict.TimeMS = int(*run.Wall)
	}
	if run.Memory != nil {
		verdict.MemoryKB = int(*run.Memory / 1024)
	}
	// Piston marks timeouts "TO" and kills over-limit processes with SIGKILL.
	switch {
	case run.Status != nil && *run.Status == "TO", run.Signal != nil && *run.Signal == "SIGKILL":
		verdict.Status = "time_limit_exceeded"
	case exitedNonZero || run.Signal != nil:
		verdict.Status = "runtime_error"
	case outputsMatch(run.Stdout, expectedOutput):
		verdict.Status = "accepted"
	default:
		verdict.Status = "wrong_answer"
	}
	return verdict
}

// outputsMatch compares after normalizing line endings, trailing whitespace on
// each line, and trailing blank lines: the usual judge leniency, matching
// Judge0's default comparison for line-oriented output.
func outputsMatch(actual, expected string) bool {
	return normalizeOutput(actual) == normalizeOutput(expected)
}

func normalizeOutput(value string) string {
	value = strings.ReplaceAll(value, "\r\n", "\n")
	value = strings.ReplaceAll(value, "\r", "\n")
	lines := strings.Split(value, "\n")
	for index, line := range lines {
		lines[index] = strings.TrimRight(line, " \t")
	}
	return strings.TrimRight(strings.Join(lines, "\n"), "\n")
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func newToken() (string, error) {
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("piston: generate token: %w", err)
	}
	return "piston-" + hex.EncodeToString(raw), nil
}
