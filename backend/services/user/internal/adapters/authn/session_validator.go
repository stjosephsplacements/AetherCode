package authn

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	userconfig "github.com/stjosephsplacements/AetherCode/services/user/internal/config"
)

// SessionValidator calls Identity's private introspection endpoint for
// authorization decisions. With a zero cache TTL (the default) it asks for every
// decision, so a committed revocation takes effect before User Authz can issue
// another local database capability. With a TTL it reuses a successful answer
// for at most that long (never past the token's own expiry), which keeps a surge of
// signed-in users from becoming one introspection and one database lookup per
// request; a revoked token then stays usable for at most the TTL. Failures are
// never cached, and concurrent checks of one token share one call.
type SessionValidator struct {
	endpoint *url.URL
	client   *http.Client

	ttl      time.Duration
	now      func() time.Time
	mu       sync.Mutex
	valid    map[[sha256.Size]byte]time.Time // token digest -> reuse until
	inflight map[[sha256.Size]byte]*validation
}

type validation struct {
	done chan struct{}
	err  error
}

// maxCachedTokens bounds memory: a full map is cleared of expired entries and, if still full, simply not extended.
const maxCachedTokens = 200000

func NewSessionValidator(runtime userconfig.IdentityIntrospectionRuntime) (*SessionValidator, error) {
	endpoint, err := url.Parse(strings.TrimSpace(runtime.URL))
	if err != nil || endpoint == nil || endpoint.Scheme == "" || endpoint.Host == "" {
		return nil, fmt.Errorf("identity introspection URL is invalid")
	}
	transport := &http.Transport{
		Proxy:                 nil,
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          20,
		MaxConnsPerHost:       20,
		MaxIdleConnsPerHost:   20,
		IdleConnTimeout:       30 * time.Second,
		TLSHandshakeTimeout:   5 * time.Second,
		ResponseHeaderTimeout: 5 * time.Second,
		ExpectContinueTimeout: time.Second,
	}
	if runtime.RequireMTLS {
		tlsConfig, err := loadMTLSClientConfig(runtime)
		if err != nil {
			return nil, err
		}
		transport.TLSClientConfig = tlsConfig
	}
	return &SessionValidator{
		ttl:      runtime.CacheTTL,
		now:      time.Now,
		valid:    make(map[[sha256.Size]byte]time.Time),
		inflight: make(map[[sha256.Size]byte]*validation),
		endpoint: endpoint,
		client: &http.Client{
			Transport: transport,
			Timeout:   7 * time.Second,
			CheckRedirect: func(*http.Request, []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
	}, nil
}

func (validator *SessionValidator) Validate(contextValue context.Context, token string) error {
	if validator == nil || validator.client == nil || validator.endpoint == nil {
		return fmt.Errorf("identity session validator is not initialized")
	}
	if validator.ttl <= 0 {
		return validator.introspect(contextValue, token)
	}
	key := sha256.Sum256([]byte(strings.TrimSpace(token)))
	validator.mu.Lock()
	if until, ok := validator.valid[key]; ok && validator.now().Before(until) {
		validator.mu.Unlock()
		return nil
	}
	if pending, ok := validator.inflight[key]; ok {
		validator.mu.Unlock()
		select {
		case <-pending.done:
			return pending.err
		case <-contextValue.Done():
			return contextValue.Err()
		}
	}
	pending := &validation{done: make(chan struct{})}
	validator.inflight[key] = pending
	validator.mu.Unlock()

	pending.err = validator.introspect(contextValue, token)

	validator.mu.Lock()
	delete(validator.inflight, key)
	if pending.err == nil {
		validator.remember(key, token)
	}
	validator.mu.Unlock()
	close(pending.done)
	return pending.err
}

// remember stores a successful check until the TTL or the token's expiry, whichever is sooner. Callers hold the lock.
func (validator *SessionValidator) remember(key [sha256.Size]byte, token string) {
	expiry, ok := tokenExpiry(token)
	if !ok {
		return // no readable expiry: never reuse
	}
	now := validator.now()
	until := now.Add(validator.ttl)
	if expiry.Before(until) {
		until = expiry
	}
	if !until.After(now) {
		return
	}
	if len(validator.valid) >= maxCachedTokens {
		for digest, stored := range validator.valid {
			if !now.Before(stored) {
				delete(validator.valid, digest)
			}
		}
		if len(validator.valid) >= maxCachedTokens {
			return
		}
	}
	validator.valid[key] = until
}

// tokenExpiry reads the exp claim without verifying the token: it only ever shortens how long a check that Identity already
// accepted is reused.
func tokenExpiry(token string) (time.Time, bool) {
	parts := strings.Split(strings.TrimSpace(token), ".")
	if len(parts) < 2 {
		return time.Time{}, false
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return time.Time{}, false
	}
	var claims struct {
		Expires int64 `json:"exp"`
	}
	if json.Unmarshal(raw, &claims) != nil || claims.Expires <= 0 {
		return time.Time{}, false
	}
	return time.Unix(claims.Expires, 0), true
}

func (validator *SessionValidator) introspect(contextValue context.Context, token string) error {
	payload, err := json.Marshal(struct {
		AccessToken string `json:"access_token"`
	}{AccessToken: strings.TrimSpace(token)})
	if err != nil {
		return fmt.Errorf("encode Identity introspection request: %w", err)
	}
	request, err := http.NewRequestWithContext(contextValue, http.MethodPost, validator.endpoint.String(), bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("create Identity introspection request: %w", err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	response, err := validator.client.Do(request)
	if err != nil {
		return fmt.Errorf("call Identity introspection: %w", err)
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusNoContent {
		return fmt.Errorf("identity introspection rejected the access token")
	}
	return nil
}

func loadMTLSClientConfig(runtime userconfig.IdentityIntrospectionRuntime) (*tls.Config, error) {
	certificate, err := tls.LoadX509KeyPair(runtime.CertificateFile, runtime.KeyFile)
	if err != nil {
		return nil, fmt.Errorf("load Identity introspection client certificate: %w", err)
	}
	caPEM, err := os.ReadFile(runtime.CAFile)
	if err != nil {
		return nil, fmt.Errorf("read Identity introspection client CA: %w", err)
	}
	rootCAs := x509.NewCertPool()
	if !rootCAs.AppendCertsFromPEM(caPEM) {
		return nil, fmt.Errorf("identity introspection client CA contains no certificates")
	}
	return &tls.Config{
		MinVersion:   tls.VersionTLS13,
		Certificates: []tls.Certificate{certificate},
		RootCAs:      rootCAs,
		ServerName:   runtime.ServerName,
	}, nil
}
