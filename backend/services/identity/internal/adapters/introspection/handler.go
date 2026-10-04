// Package introspection exposes Identity's private, mTLS-bound endpoints for
// the User service: session validation for central authorization, and
// account provisioning for administrators (ADR-0019). The User service
// authorizes the administrator before calling; only its certificate is
// trusted here.
package introspection

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/aethercode/aethercode/libs/pkg/authn"
	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
	"github.com/aethercode/aethercode/libs/pkg/httpx"
	"github.com/aethercode/aethercode/services/identity/internal/app"
)

type SessionValidator interface {
	ValidateAccessToken(context.Context, string, string) error
}

// Accounts provisions and manages administrator-created accounts.
type Accounts interface {
	ProvisionAccounts(context.Context, []app.AccountRequest, app.AccountAudit) ([]app.IssuedCredential, error)
	ReissuePasswords(context.Context, []string, app.AccountAudit) ([]app.IssuedCredential, error)
	SetAccountStatus(context.Context, []string, string, app.AccountAudit) error
	DiscardAccounts(context.Context, []string, app.AccountAudit) error
}

type AccessVerifier interface {
	Verify(string, time.Time) (authn.Claims, error)
}

type Handler struct {
	service         SessionValidator
	accounts        Accounts
	accessVerifier  AccessVerifier
	trustedSPIFFEID string
	requireMTLS     bool
}

func NewHandler(service SessionValidator, accounts Accounts, accessVerifier AccessVerifier, trustedSPIFFEID string, requireMTLS bool) (http.Handler, error) {
	if service == nil || accounts == nil || accessVerifier == nil {
		return nil, fmt.Errorf("identity session validator, accounts, and access-token verifier are required")
	}
	if requireMTLS && strings.TrimSpace(trustedSPIFFEID) == "" {
		return nil, fmt.Errorf("trusted Identity introspection SPIFFE ID is required with mTLS")
	}
	handler := &Handler{
		service: service, accounts: accounts, accessVerifier: accessVerifier,
		trustedSPIFFEID: strings.TrimSpace(trustedSPIFFEID), requireMTLS: requireMTLS,
	}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /v1/internal/access-token/validate", handler.validateAccessToken)
	mux.HandleFunc("POST /v1/internal/accounts", handler.provisionAccounts)
	mux.HandleFunc("POST /v1/internal/accounts/passwords", handler.reissuePasswords)
	mux.HandleFunc("POST /v1/internal/accounts/status", handler.setAccountStatus)
	mux.HandleFunc("POST /v1/internal/accounts/discard", handler.discardAccounts)
	return noStore(mux), nil
}

type accountAudit struct {
	ActorID   string `json:"actor_id"`
	RequestID string `json:"request_id"`
}

func (audit accountAudit) toApp() app.AccountAudit {
	return app.AccountAudit{ActorID: audit.ActorID, RequestID: audit.RequestID}
}

type credentialsResponse struct {
	Accounts []app.IssuedCredential `json:"accounts"`
}

func (handler *Handler) provisionAccounts(writer http.ResponseWriter, request *http.Request) {
	var body struct {
		accountAudit
		Accounts []app.AccountRequest `json:"accounts"`
	}
	if !handler.decodeTrusted(writer, request, &body) {
		return
	}
	credentials, err := handler.accounts.ProvisionAccounts(request.Context(), body.Accounts, body.toApp())
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusCreated, credentialsResponse{Accounts: credentials})
}

type principalsRequest struct {
	accountAudit
	PrincipalIDs []string `json:"principal_ids"`
	Status       string   `json:"status,omitempty"`
}

func (handler *Handler) reissuePasswords(writer http.ResponseWriter, request *http.Request) {
	var body principalsRequest
	if !handler.decodeTrusted(writer, request, &body) {
		return
	}
	credentials, err := handler.accounts.ReissuePasswords(request.Context(), body.PrincipalIDs, body.toApp())
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, credentialsResponse{Accounts: credentials})
}

func (handler *Handler) setAccountStatus(writer http.ResponseWriter, request *http.Request) {
	var body principalsRequest
	if !handler.decodeTrusted(writer, request, &body) {
		return
	}
	if err := handler.accounts.SetAccountStatus(request.Context(), body.PrincipalIDs, body.Status, body.toApp()); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

func (handler *Handler) discardAccounts(writer http.ResponseWriter, request *http.Request) {
	var body principalsRequest
	if !handler.decodeTrusted(writer, request, &body) {
		return
	}
	if err := handler.accounts.DiscardAccounts(request.Context(), body.PrincipalIDs, body.toApp()); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

// decodeTrusted rejects callers without the trusted certificate before
// reading the body, then decodes it.
func (handler *Handler) decodeTrusted(writer http.ResponseWriter, request *http.Request, body any) bool {
	if handler.requireMTLS && !handler.hasTrustedPeer(request) {
		httpx.WriteError(writer, apperrors.New(apperrors.CodeForbidden, "trusted client certificate is required"))
		return false
	}
	if err := httpx.DecodeJSON(request, body); err != nil {
		httpx.WriteError(writer, err)
		return false
	}
	return true
}

type validationRequest struct {
	AccessToken string `json:"access_token"`
}

func (handler *Handler) validateAccessToken(writer http.ResponseWriter, request *http.Request) {
	if handler.requireMTLS && !handler.hasTrustedPeer(request) {
		httpx.WriteError(writer, apperrors.New(apperrors.CodeForbidden, "trusted client certificate is required"))
		return
	}
	var body validationRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	claims, err := handler.accessVerifier.Verify(strings.TrimSpace(body.AccessToken), time.Now().UTC())
	if err != nil || strings.TrimSpace(claims.Subject) == "" || strings.TrimSpace(claims.TokenID) == "" {
		httpx.WriteError(writer, apperrors.New(apperrors.CodeUnauthorized, "access token is invalid"))
		return
	}
	if err := handler.service.ValidateAccessToken(request.Context(), claims.Subject, claims.TokenID); err != nil {
		httpx.WriteError(writer, apperrors.New(apperrors.CodeUnauthorized, "access token is invalid"))
		return
	}
	writer.Header().Set("Cache-Control", "no-store")
	writer.WriteHeader(http.StatusNoContent)
}

func (handler *Handler) hasTrustedPeer(request *http.Request) bool {
	if request == nil || request.TLS == nil || len(request.TLS.VerifiedChains) == 0 {
		return false
	}
	for _, certificate := range request.TLS.PeerCertificates {
		for _, uri := range certificate.URIs {
			if uri != nil && uri.String() == handler.trustedSPIFFEID {
				return true
			}
		}
	}
	return false
}

func noStore(next http.Handler) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Cache-Control", "no-store")
		writer.Header().Set("Pragma", "no-cache")
		next.ServeHTTP(writer, request)
	})
}
