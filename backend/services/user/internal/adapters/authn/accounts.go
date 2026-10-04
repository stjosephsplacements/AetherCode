package authn

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
	"github.com/aethercode/aethercode/libs/pkg/httpx"
	"github.com/aethercode/aethercode/services/user/internal/app"
	userconfig "github.com/aethercode/aethercode/services/user/internal/config"
)

// AccountsClient calls Identity's private account endpoints (ADR-0019) over
// the same mTLS channel as session introspection. Provisioning hashes up to
// 500 passwords, so its timeouts are longer than introspection's.
type AccountsClient struct {
	base   *url.URL
	client *http.Client
}

func NewAccountsClient(runtime userconfig.IdentityIntrospectionRuntime) (*AccountsClient, error) {
	endpoint, err := url.Parse(strings.TrimSpace(runtime.URL))
	if err != nil || endpoint == nil || endpoint.Scheme == "" || endpoint.Host == "" {
		return nil, fmt.Errorf("identity introspection URL is invalid")
	}
	transport := &http.Transport{
		Proxy:                 nil,
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          4,
		MaxConnsPerHost:       4,
		IdleConnTimeout:       30 * time.Second,
		TLSHandshakeTimeout:   5 * time.Second,
		ResponseHeaderTimeout: 12 * time.Second,
	}
	if runtime.RequireMTLS {
		tlsConfig, err := loadMTLSClientConfig(runtime)
		if err != nil {
			return nil, err
		}
		transport.TLSClientConfig = tlsConfig
	}
	return &AccountsClient{
		base: &url.URL{Scheme: endpoint.Scheme, Host: endpoint.Host},
		client: &http.Client{
			Transport: transport,
			Timeout:   13 * time.Second,
			CheckRedirect: func(*http.Request, []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
	}, nil
}

type credentialsResponse struct {
	Accounts []app.IssuedCredential `json:"accounts"`
}

func (client *AccountsClient) ProvisionAccounts(contextValue context.Context, requests []app.AccountRequest, audit app.AccountAudit) ([]app.IssuedCredential, error) {
	var response credentialsResponse
	err := client.post(contextValue, "/v1/internal/accounts", struct {
		app.AccountAudit
		Accounts []app.AccountRequest `json:"accounts"`
	}{AccountAudit: audit, Accounts: requests}, http.StatusCreated, &response)
	return response.Accounts, err
}

func (client *AccountsClient) ReissuePasswords(contextValue context.Context, principalIDs []string, audit app.AccountAudit) ([]app.IssuedCredential, error) {
	var response credentialsResponse
	err := client.post(contextValue, "/v1/internal/accounts/passwords", principalsRequest{AccountAudit: audit, PrincipalIDs: principalIDs}, http.StatusOK, &response)
	return response.Accounts, err
}

func (client *AccountsClient) SetAccountStatus(contextValue context.Context, principalIDs []string, status string, audit app.AccountAudit) error {
	return client.post(contextValue, "/v1/internal/accounts/status", principalsRequest{AccountAudit: audit, PrincipalIDs: principalIDs, Status: status}, http.StatusNoContent, nil)
}

func (client *AccountsClient) DiscardAccounts(contextValue context.Context, principalIDs []string, audit app.AccountAudit) error {
	return client.post(contextValue, "/v1/internal/accounts/discard", principalsRequest{AccountAudit: audit, PrincipalIDs: principalIDs}, http.StatusNoContent, nil)
}

type principalsRequest struct {
	app.AccountAudit
	PrincipalIDs []string `json:"principal_ids"`
	Status       string   `json:"status,omitempty"`
}

// post sends one request and decodes the expected success body. Identity's
// own client errors (a taken username, an invalid row) pass through with
// their code and message so the administrator sees what to fix.
func (client *AccountsClient) post(contextValue context.Context, path string, body any, wantStatus int, destination any) error {
	payload, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("encode Identity accounts request: %w", err)
	}
	request, err := http.NewRequestWithContext(contextValue, http.MethodPost, client.base.JoinPath(path).String(), bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("create Identity accounts request: %w", err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	response, err := client.client.Do(request)
	if err != nil {
		return fmt.Errorf("call Identity accounts: %w", err)
	}
	defer func() { _ = response.Body.Close() }()
	responseBody, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return fmt.Errorf("read Identity accounts response: %w", err)
	}
	if response.StatusCode == wantStatus {
		if destination == nil {
			return nil
		}
		if err := json.Unmarshal(responseBody, destination); err != nil {
			return fmt.Errorf("decode Identity accounts response: %w", err)
		}
		return nil
	}
	var problem httpx.Problem
	if response.StatusCode >= 400 && response.StatusCode < 500 && json.Unmarshal(responseBody, &problem) == nil && problem.Code != "" {
		if code, ok := clientErrorCodes[problem.Code]; ok {
			return apperrors.New(code, problem.Message)
		}
	}
	return fmt.Errorf("identity accounts %s returned HTTP %d", path, response.StatusCode)
}

// clientErrorCodes are the Identity problems an administrator can act on.
// Anything else, including a rejected certificate, is an internal error.
var clientErrorCodes = map[string]apperrors.Code{
	string(apperrors.CodeInvalidArgument): apperrors.CodeInvalidArgument,
	string(apperrors.CodeConflict):        apperrors.CodeConflict,
	string(apperrors.CodeNotFound):        apperrors.CodeNotFound,
}
