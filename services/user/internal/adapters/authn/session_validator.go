package authn

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	userconfig "github.com/aethercode/aethercode/services/user/internal/config"
)

// SessionValidator calls Identity's private introspection endpoint for every
// authorization decision. It carries no positive cache, so a committed token
// or family revocation takes effect before User Authz can issue another local
// database capability.
type SessionValidator struct {
	endpoint *url.URL
	client   *http.Client
}

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
