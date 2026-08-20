// Package introspection exposes Identity's private, mTLS-bound session
// validation endpoint for the canonical User authorization service.
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
)

type SessionValidator interface {
	ValidateAccessToken(context.Context, string, string) error
}

type AccessVerifier interface {
	Verify(string, time.Time) (authn.Claims, error)
}

type Handler struct {
	service         SessionValidator
	accessVerifier  AccessVerifier
	trustedSPIFFEID string
	requireMTLS     bool
}

func NewHandler(service SessionValidator, accessVerifier AccessVerifier, trustedSPIFFEID string, requireMTLS bool) (http.Handler, error) {
	if service == nil || accessVerifier == nil {
		return nil, fmt.Errorf("Identity session validator and access-token verifier are required")
	}
	if requireMTLS && strings.TrimSpace(trustedSPIFFEID) == "" {
		return nil, fmt.Errorf("trusted Identity introspection SPIFFE ID is required with mTLS")
	}
	handler := &Handler{
		service: service, accessVerifier: accessVerifier,
		trustedSPIFFEID: strings.TrimSpace(trustedSPIFFEID), requireMTLS: requireMTLS,
	}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /v1/internal/access-token/validate", handler.validateAccessToken)
	return noStore(mux), nil
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
