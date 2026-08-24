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
