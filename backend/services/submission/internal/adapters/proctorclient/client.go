// Package proctorclient reads violations from the proctor service's internal
// endpoint (ADR-0080).
package proctorclient

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/stjosephsplacements/AetherCode/services/submission/internal/app"
)

const maxResponseBytes = 4 << 20

var _ app.ViolationReader = (*Client)(nil)

// Client calls GET /violations with a bearer token. The base URL comes only
// from configuration, never from a request.
type Client struct {
	base  *url.URL
	token string
	http  *http.Client
}

func New(baseURL, token string, timeout time.Duration) (*Client, error) {
	base, err := url.Parse(strings.TrimRight(baseURL, "/"))
	if err != nil || (base.Scheme != "http" && base.Scheme != "https") || base.Host == "" {
		return nil, fmt.Errorf("proctor URL must be an absolute http(s) URL")
	}
	if token == "" || timeout <= 0 {
		return nil, fmt.Errorf("proctor token and timeout are required")
	}
	// The bearer token must go only to the configured host: no redirects, no proxy.
	httpClient := &http.Client{
		Timeout:       timeout,
		Transport:     &http.Transport{Proxy: nil},
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	return &Client{base: base, token: token, http: httpClient}, nil
}

func (client *Client) Violations(ctx context.Context, tenantID, attemptID string) (app.ViolationList, error) {
	target := client.base.JoinPath("violations")
	target.RawQuery = url.Values{"tenant_id": {tenantID}, "attempt_id": {attemptID}}.Encode()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, target.String(), nil)
	if err != nil {
		return app.ViolationList{}, fmt.Errorf("build proctor request: %w", err)
	}
	request.Header.Set("Authorization", "Bearer "+client.token)
	response, err := client.http.Do(request)
	if err != nil {
		return app.ViolationList{}, fmt.Errorf("call proctor service: %w", err)
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK {
		return app.ViolationList{}, fmt.Errorf("proctor service returned status %d", response.StatusCode)
	}
	var body struct {
		Truncated  bool            `json:"truncated"`
		Violations []app.Violation `json:"violations"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, maxResponseBytes)).Decode(&body); err != nil {
		return app.ViolationList{}, fmt.Errorf("decode proctor response: %w", err)
	}
	if body.Violations == nil {
		body.Violations = []app.Violation{}
	}
	return app.ViolationList{Violations: body.Violations, Truncated: body.Truncated}, nil
}
