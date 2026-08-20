// Package httpadapter exposes Identity's public authentication HTTP API.
package httpadapter

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/aethercode/aethercode/libs/pkg/authn"
	"github.com/aethercode/aethercode/libs/pkg/database"
	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
	"github.com/aethercode/aethercode/libs/pkg/httpx"
	"github.com/aethercode/aethercode/services/identity/internal/app"
)

// UseCases keeps the transport adapter independent of Identity's concrete
// application implementation and makes request/response boundary tests small.
type UseCases interface {
	Register(context.Context, string, string, string, string, string) (string, string, error)
	VerifyEmail(context.Context, string) (string, error)
	Login(context.Context, string, string, string, string, string, string) (app.TokenPair, error)
	CompleteMFA(context.Context, string, string, string, string, string) (app.TokenPair, error)
	Refresh(context.Context, string, string, string, string) (app.TokenPair, error)
	Logout(context.Context, string) error
	RequestPasswordReset(context.Context, string, string, string) (string, error)
	ResetPassword(context.Context, string, string, string, string) error
	BeginTOTP(context.Context, string, string) (string, string, error)
	ActivateTOTP(context.Context, string, string, string) ([]string, error)
	DisableTOTP(context.Context, string, string, string) error
	ValidateAccessToken(context.Context, string, string) error
	GetPrincipal(context.Context, string) (*app.Principal, error)
	DeletePrincipal(context.Context, app.DeletePrincipal) error
	HardDeletePrincipal(context.Context, app.DeletePrincipal) error
}

// AccessVerifier verifies the locally minted access assertion for Identity's
// self-service MFA routes. The service never accepts an unsigned principal ID
// from the HTTP request body.
type AccessVerifier interface {
	Verify(string, time.Time) (authn.Claims, error)
}

// Handler owns the Identity HTTP routes and intentionally keeps operational
// endpoints on the same server as the public API.
type Handler struct {
	service                  UseCases
	accessVerifier           AccessVerifier
	exposeDevelopmentSecrets bool
}

// NewHandler installs concrete identity workflows on an operational mux.
func NewHandler(serviceName string, service UseCases, readiness httpx.ReadinessFunc, accessVerifier AccessVerifier, exposeDevelopmentSecrets bool) (*Handler, http.Handler, error) {
	if service == nil {
		return nil, nil, fmt.Errorf("identity use cases are required")
	}
	if accessVerifier == nil {
		return nil, nil, fmt.Errorf("identity access-token verifier is required")
	}
	handler := &Handler{service: service, accessVerifier: accessVerifier, exposeDevelopmentSecrets: exposeDevelopmentSecrets}
	mux := httpx.NewOperationalMux(serviceName, readiness)
	mux.HandleFunc("POST /v1/auth/register", handler.register)
	mux.HandleFunc("POST /v1/auth/verify-email", handler.verifyEmail)
	mux.HandleFunc("POST /v1/auth/login", handler.login)
	mux.HandleFunc("POST /v1/auth/mfa/verify-login", handler.completeMFA)
	mux.HandleFunc("POST /v1/auth/refresh", handler.refresh)
	mux.HandleFunc("POST /v1/auth/logout", handler.logout)
	mux.HandleFunc("POST /v1/auth/password-reset", handler.requestPasswordReset)
	mux.HandleFunc("POST /v1/auth/password-reset/complete", handler.resetPassword)
	mux.HandleFunc("POST /v1/auth/mfa/totp", handler.beginTOTP)
	mux.HandleFunc("POST /v1/auth/mfa/totp/{factor_id}/activate", handler.activateTOTP)
	mux.HandleFunc("DELETE /v1/auth/mfa/totp/{factor_id}", handler.disableTOTP)
	mux.HandleFunc("DELETE /v1/principals/{id}", handler.deletePrincipal)
	mux.HandleFunc("DELETE /v1/principals/{id}/hard", handler.hardDeletePrincipal)
	return handler, noStore(mux), nil
}

type registerRequest struct {
	Email       string `json:"email"`
	DisplayName string `json:"display_name"`
	Password    string `json:"password"`
}

type registerResponse struct {
	PrincipalID       string `json:"principal_id"`
	VerificationToken string `json:"verification_token,omitempty"`
}

func (handler *Handler) register(writer http.ResponseWriter, request *http.Request) {
	var body registerRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	requestID, err := database.NewUUIDv7()
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	principalID, verificationToken, err := handler.service.Register(
		request.Context(), body.Email, body.DisplayName, body.Password, clientIP(request), requestID,
	)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	response := registerResponse{PrincipalID: principalID}
	if handler.exposeDevelopmentSecrets {
		response.VerificationToken = verificationToken
	}
	httpx.WriteJSON(writer, http.StatusCreated, response)
}

type verifyEmailRequest struct {
	Token string `json:"token"`
}

func (handler *Handler) verifyEmail(writer http.ResponseWriter, request *http.Request) {
	var body verifyEmailRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	principalID, err := handler.service.VerifyEmail(request.Context(), body.Token)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, struct {
		PrincipalID string `json:"principal_id"`
	}{PrincipalID: principalID})
}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	TenantID string `json:"tenant_id"`
}

func (handler *Handler) login(writer http.ResponseWriter, request *http.Request) {
	var body loginRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	requestID, err := database.NewUUIDv7()
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	pair, err := handler.service.Login(
		request.Context(), body.Email, body.Password, body.TenantID, clientIP(request), request.UserAgent(), requestID,
	)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, pair)
}

type completeMFARequest struct {
	ChallengeToken string `json:"mfa_challenge_token"`
	Code           string `json:"code"`
}

func (handler *Handler) completeMFA(writer http.ResponseWriter, request *http.Request) {
	var body completeMFARequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	requestID, err := database.NewUUIDv7()
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	pair, err := handler.service.CompleteMFA(
		request.Context(), body.ChallengeToken, body.Code, clientIP(request), request.UserAgent(), requestID,
	)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, pair)
}

type refreshRequest struct {
	RefreshToken string `json:"refresh_token"`
}

func (handler *Handler) refresh(writer http.ResponseWriter, request *http.Request) {
	var body refreshRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	requestID, err := database.NewUUIDv7()
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	pair, err := handler.service.Refresh(
		request.Context(), body.RefreshToken, clientIP(request), request.UserAgent(), requestID,
	)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, pair)
}

type logoutRequest struct {
	RefreshToken string `json:"refresh_token"`
}

func (handler *Handler) logout(writer http.ResponseWriter, request *http.Request) {
	var body logoutRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	if err := handler.service.Logout(request.Context(), body.RefreshToken); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

type passwordResetRequest struct {
	Email string `json:"email"`
}

func (handler *Handler) requestPasswordReset(writer http.ResponseWriter, request *http.Request) {
	var body passwordResetRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	requestID, err := database.NewUUIDv7()
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	token, err := handler.service.RequestPasswordReset(request.Context(), body.Email, clientIP(request), requestID)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	response := struct {
		Status string `json:"status"`
		Token  string `json:"token,omitempty"`
	}{Status: "accepted"}
	if handler.exposeDevelopmentSecrets {
		response.Token = token
	}
	httpx.WriteJSON(writer, http.StatusAccepted, response)
}

type resetPasswordRequest struct {
	Token    string `json:"token"`
	Password string `json:"password"`
}

func (handler *Handler) resetPassword(writer http.ResponseWriter, request *http.Request) {
	var body resetPasswordRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	requestID, err := database.NewUUIDv7()
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	if err := handler.service.ResetPassword(request.Context(), body.Token, body.Password, clientIP(request), requestID); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

type beginTOTPRequest struct {
	Label string `json:"label"`
}

func (handler *Handler) beginTOTP(writer http.ResponseWriter, request *http.Request) {
	principalID, err := handler.authenticatedPrincipal(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body beginTOTPRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	factorID, secret, err := handler.service.BeginTOTP(request.Context(), principalID, body.Label)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	issuer := "AetherCode"
	label := issuer + ":" + principalID
	uri := "otpauth://totp/" + url.PathEscape(label) + "?secret=" + url.QueryEscape(secret) +
		"&issuer=" + url.QueryEscape(issuer) + "&algorithm=SHA1&digits=6&period=30"
	httpx.WriteJSON(writer, http.StatusCreated, struct {
		FactorID string `json:"factor_id"`
		Secret   string `json:"secret"`
		URI      string `json:"otpauth_uri"`
	}{FactorID: factorID, Secret: secret, URI: uri})
}

type totpCodeRequest struct {
	Code string `json:"code"`
}

func (handler *Handler) activateTOTP(writer http.ResponseWriter, request *http.Request) {
	principalID, err := handler.authenticatedPrincipal(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	factorID, err := httpx.ParseUUIDPathValue(request, "factor_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body totpCodeRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	recoveryCodes, err := handler.service.ActivateTOTP(request.Context(), principalID, factorID, body.Code)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	httpx.WriteJSON(writer, http.StatusOK, struct {
		RecoveryCodes []string `json:"recovery_codes"`
	}{RecoveryCodes: recoveryCodes})
}

func (handler *Handler) disableTOTP(writer http.ResponseWriter, request *http.Request) {
	principalID, err := handler.authenticatedPrincipal(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	factorID, err := httpx.ParseUUIDPathValue(request, "factor_id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}
	var body totpCodeRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	if err := handler.service.DisableTOTP(request.Context(), principalID, factorID, body.Code); err != nil {
		httpx.WriteError(writer, err)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

type deletePrincipalRequest struct {
	Reason string `json:"reason"`
}

func (handler *Handler) deletePrincipal(writer http.ResponseWriter, request *http.Request) {
	principalID, err := httpx.ParseUUIDPathValue(request, "id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}

	// Extract actor from access token
	actorID, err := handler.authenticatedPrincipal(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}

	var body deletePrincipalRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}

	command := app.DeletePrincipal{
		ID:      principalID,
		ActorID: actorID,
		Reason:  body.Reason,
	}

	if err := handler.service.DeletePrincipal(request.Context(), command); err != nil {
		httpx.WriteError(writer, err)
		return
	}

	writer.WriteHeader(http.StatusNoContent)
}

func (handler *Handler) hardDeletePrincipal(writer http.ResponseWriter, request *http.Request) {
	principalID, err := httpx.ParseUUIDPathValue(request, "id")
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}

	// Extract actor from access token
	actorID, err := handler.authenticatedPrincipal(request)
	if err != nil {
		httpx.WriteError(writer, err)
		return
	}

	var body deletePrincipalRequest
	if err := httpx.DecodeJSON(request, &body); err != nil {
		httpx.WriteError(writer, err)
		return
	}

	command := app.DeletePrincipal{
		ID:      principalID,
		ActorID: actorID,
		Reason:  body.Reason,
	}

	if err := handler.service.HardDeletePrincipal(request.Context(), command); err != nil {
		httpx.WriteError(writer, err)
		return
	}

	writer.WriteHeader(http.StatusNoContent)
}

func (handler *Handler) authenticatedPrincipal(request *http.Request) (string, error) {
	token, err := httpx.BearerToken(request)
	if err != nil {
		return "", err
	}
	claims, err := handler.accessVerifier.Verify(token, time.Now().UTC())
	if err != nil || claims.Subject == "" {
		return "", apperrors.New(apperrors.CodeUnauthorized, "access token is invalid")
	}
	if err := handler.service.ValidateAccessToken(request.Context(), claims.Subject, claims.TokenID); err != nil {
		return "", apperrors.New(apperrors.CodeUnauthorized, "access token is invalid")
	}
	return claims.Subject, nil
}

func clientIP(request *http.Request) string {
	host, _, err := net.SplitHostPort(strings.TrimSpace(request.RemoteAddr))
	if err == nil {
		if parsed := net.ParseIP(host); parsed != nil {
			return parsed.String()
		}
	}
	if parsed := net.ParseIP(strings.TrimSpace(request.RemoteAddr)); parsed != nil {
		return parsed.String()
	}
	return ""
}

func noStore(next http.Handler) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Cache-Control", "no-store")
		writer.Header().Set("Pragma", "no-cache")
		next.ServeHTTP(writer, request)
	})
}
