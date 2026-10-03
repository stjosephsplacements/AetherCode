package httpadapter

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/aethercode/aethercode/libs/pkg/authn"
	"github.com/aethercode/aethercode/libs/pkg/ratelimit"
	"github.com/aethercode/aethercode/services/identity/internal/app"
)

type fakeUseCases struct {
	registerEmail      string
	registerToken      string
	getPrincipalID     string
	getPrincipalResult *app.Principal
}

func (fake *fakeUseCases) Register(_ context.Context, email, _, _, _, _ string) (string, string, error) {
	fake.registerEmail = email
	return "019b11a0-0000-7000-8000-000000000001", fake.registerToken, nil
}

func (fake *fakeUseCases) VerifyEmail(context.Context, string) (string, error) {
	return "019b11a0-0000-7000-8000-000000000001", nil
}

func (fake *fakeUseCases) Login(context.Context, string, string, string, string, string, string) (app.TokenPair, error) {
	return app.TokenPair{}, nil
}

func (fake *fakeUseCases) CompleteMFA(context.Context, string, string, string, string, string) (app.TokenPair, error) {
	return app.TokenPair{}, nil
}

func (fake *fakeUseCases) Refresh(context.Context, string, string, string, string) (app.TokenPair, error) {
	return app.TokenPair{}, nil
}

func (fake *fakeUseCases) Logout(context.Context, string) error { return nil }

func (fake *fakeUseCases) RequestPasswordReset(context.Context, string, string, string) (string, error) {
	return "reset-token", nil
}

func (fake *fakeUseCases) ResetPassword(context.Context, string, string, string, string) error {
	return nil
}

func (fake *fakeUseCases) BeginTOTP(context.Context, string, string) (string, string, error) {
	return "019b11a0-0000-7000-8000-000000000002", "ABCDEFGHIJKLMNOP", nil
}

func (fake *fakeUseCases) ActivateTOTP(context.Context, string, string, string) ([]string, error) {
	return []string{"ABCDEFGH-IJKLMNO"}, nil
}

func (fake *fakeUseCases) DisableTOTP(context.Context, string, string, string) error { return nil }

func (fake *fakeUseCases) ValidateAccessToken(context.Context, string, string) error { return nil }

func (fake *fakeUseCases) GetPrincipal(_ context.Context, id string) (*app.Principal, error) {
	fake.getPrincipalID = id
	if fake.getPrincipalResult != nil {
		return fake.getPrincipalResult, nil
	}
	return nil, nil
}

func (fake *fakeUseCases) DeletePrincipal(context.Context, app.DeletePrincipal) error { return nil }

func (fake *fakeUseCases) HardDeletePrincipal(context.Context, app.DeletePrincipal) error {
	return nil
}

type fakeVerifier struct{}

func (fakeVerifier) Verify(string, time.Time) (authn.Claims, error) {
	return authn.Claims{Subject: "019b11a0-0000-7000-8000-000000000001"}, nil
}

func TestRegisterDoesNotExposeVerificationBearerOutsideDevelopment(t *testing.T) {
	t.Parallel()
	fake := &fakeUseCases{registerToken: "verification-bearer"}
	_, handler, err := NewHandler("identity", fake, nil, fakeVerifier{}, false, nil, nil, nil)
	if err != nil {
		t.Fatalf("NewHandler() error = %v", err)
	}
	request := httptest.NewRequest(http.MethodPost, "/v1/auth/register", strings.NewReader(`{"email":"user@example.com","display_name":"Ada","password":"AetherCode2026"}`))
	request.RemoteAddr = "127.0.0.1:1234"
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusCreated {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("Cache-Control = %q", response.Header().Get("Cache-Control"))
	}
	var body map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if _, found := body["verification_token"]; found {
		t.Fatalf("production response exposed verification bearer: %s", response.Body.String())
	}
	if fake.registerEmail != "user@example.com" {
		t.Fatalf("register email = %q", fake.registerEmail)
	}
}

func TestRegisterRejectsUnknownJSONFields(t *testing.T) {
	t.Parallel()
	fake := &fakeUseCases{}
	_, handler, err := NewHandler("identity", fake, nil, fakeVerifier{}, true, nil, nil, nil)
	if err != nil {
		t.Fatalf("NewHandler() error = %v", err)
	}
	request := httptest.NewRequest(http.MethodPost, "/v1/auth/register", strings.NewReader(`{"email":"user@example.com","display_name":"Ada","password":"AetherCode2026","unexpected":true}`))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
}

func TestDevelopmentResetResponseIncludesBearerOnlyWhenEnabled(t *testing.T) {
	t.Parallel()
	fake := &fakeUseCases{}
	_, handler, err := NewHandler("identity", fake, nil, fakeVerifier{}, true, nil, nil, nil)
	if err != nil {
		t.Fatalf("NewHandler() error = %v", err)
	}
	request := httptest.NewRequest(http.MethodPost, "/v1/auth/password-reset", strings.NewReader(`{"email":"user@example.com"}`))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusAccepted || !strings.Contains(response.Body.String(), "reset-token") {
		t.Fatalf("response = %d %s", response.Code, response.Body.String())
	}
}

func TestRegisterRateLimitBlocks429AfterBurstExhausted(t *testing.T) {
	t.Parallel()
	// Burst of 1 with near-zero refill so the second request from the same IP
	// is always denied within the test window.
	limiter, err := ratelimit.New(ratelimit.Config{
		Capacity:        1,
		RefillPerSecond: 0.0001,
		MaxEntries:      100,
		IdleTTL:         time.Hour,
	})
	if err != nil {
		t.Fatalf("ratelimit.New() error = %v", err)
	}
	fake := &fakeUseCases{registerToken: "tok"}
	_, handler, err := NewHandler("identity", fake, nil, fakeVerifier{}, false, limiter, nil, nil)
	if err != nil {
		t.Fatalf("NewHandler() error = %v", err)
	}

	body := `{"email":"rate@example.com","display_name":"Rate","password":"AetherCode2026"}`
	makeRequest := func() *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/v1/auth/register", strings.NewReader(body))
		req.RemoteAddr = "203.0.113.42:9999"
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		return rec
	}

	first := makeRequest()
	if first.Code != http.StatusCreated {
		t.Fatalf("first request: status = %d, body = %s", first.Code, first.Body.String())
	}

	second := makeRequest()
	if second.Code != http.StatusTooManyRequests {
		t.Fatalf("second request: expected 429, got %d, body = %s", second.Code, second.Body.String())
	}
	if second.Header().Get("Retry-After") != retryAfterRegistration {
		t.Fatalf("Retry-After = %q, want %q", second.Header().Get("Retry-After"), retryAfterRegistration)
	}
	var problem map[string]any
	if err := json.Unmarshal(second.Body.Bytes(), &problem); err != nil {
		t.Fatalf("decode 429 body: %v", err)
	}
	if problem["code"] != "too_many_requests" {
		t.Fatalf("429 code = %q, want too_many_requests", problem["code"])
	}
}

func TestRegisterRateLimitDistinctIPsAreTrackedSeparately(t *testing.T) {
	t.Parallel()
	limiter, err := ratelimit.New(ratelimit.Config{
		Capacity:        1,
		RefillPerSecond: 0.0001,
		MaxEntries:      100,
		IdleTTL:         time.Hour,
	})
	if err != nil {
		t.Fatalf("ratelimit.New() error = %v", err)
	}
	fake := &fakeUseCases{registerToken: "tok"}
	_, handler, err := NewHandler("identity", fake, nil, fakeVerifier{}, false, limiter, nil, nil)
	if err != nil {
		t.Fatalf("NewHandler() error = %v", err)
	}

	body := `{"email":"iptest@example.com","display_name":"IP","password":"AetherCode2026"}`
	makeRequest := func(ip string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/v1/auth/register", strings.NewReader(body))
		req.RemoteAddr = ip + ":9999"
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		return rec
	}

	if r := makeRequest("203.0.113.1"); r.Code != http.StatusCreated {
		t.Fatalf("IP-1 first request: status = %d", r.Code)
	}
	// IP-1 exhausted, IP-2 has its own fresh bucket and should succeed.
	if r := makeRequest("203.0.113.2"); r.Code != http.StatusCreated {
		t.Fatalf("IP-2 first request: status = %d", r.Code)
	}
	// IP-1 should now be rate limited.
	if r := makeRequest("203.0.113.1"); r.Code != http.StatusTooManyRequests {
		t.Fatalf("IP-1 second request: expected 429, got %d", r.Code)
	}
}

func TestRegisterRateLimitXForwardedForOverridesRemoteAddr(t *testing.T) {
	t.Parallel()
	limiter, err := ratelimit.New(ratelimit.Config{
		Capacity:        1,
		RefillPerSecond: 0.0001,
		MaxEntries:      100,
		IdleTTL:         time.Hour,
	})
	if err != nil {
		t.Fatalf("ratelimit.New() error = %v", err)
	}
	fake := &fakeUseCases{registerToken: "tok"}
	_, handler, err := NewHandler("identity", fake, nil, fakeVerifier{}, false, limiter, nil, nil)
	if err != nil {
		t.Fatalf("NewHandler() error = %v", err)
	}

	body := `{"email":"xff@example.com","display_name":"XFF","password":"AetherCode2026"}`
	makeRequestWithXFF := func(xff string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/v1/auth/register", strings.NewReader(body))
		req.RemoteAddr = "10.0.0.1:1234" // gateway address; varies per request
		req.Header.Set("X-Forwarded-For", xff)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		return rec
	}

	// First request from real client IP succeeds.
	if r := makeRequestWithXFF("198.51.100.7"); r.Code != http.StatusCreated {
		t.Fatalf("first request: status = %d, body = %s", r.Code, r.Body.String())
	}
	// Second request from the same real client IP (different gateway RemoteAddr) is limited.
	if r := makeRequestWithXFF("198.51.100.7"); r.Code != http.StatusTooManyRequests {
		t.Fatalf("second request from same real IP: expected 429, got %d", r.Code)
	}
}

func TestRegisterNilLimiterAllowsAllRequests(t *testing.T) {
	t.Parallel()
	fake := &fakeUseCases{registerToken: "tok"}
	_, handler, err := NewHandler("identity", fake, nil, fakeVerifier{}, false, nil, nil, nil)
	if err != nil {
		t.Fatalf("NewHandler() error = %v", err)
	}
	body := `{"email":"nolimit@example.com","display_name":"NoLimit","password":"AetherCode2026"}`
	for i := range 5 {
		req := httptest.NewRequest(http.MethodPost, "/v1/auth/register", strings.NewReader(body))
		req.RemoteAddr = "192.0.2.1:1234"
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusCreated {
			t.Fatalf("request %d: status = %d (nil limiter must allow all)", i+1, rec.Code)
		}
	}
}

func TestLoginRateLimitBlocks429AfterBurstExhausted(t *testing.T) {
	t.Parallel()
	limiter, err := ratelimit.New(ratelimit.Config{
		Capacity:        1,
		RefillPerSecond: 0.0001,
		MaxEntries:      100,
		IdleTTL:         time.Hour,
	})
	if err != nil {
		t.Fatalf("ratelimit.New() error = %v", err)
	}
	fake := &fakeUseCases{}
	_, handler, err := NewHandler("identity", fake, nil, fakeVerifier{}, false, nil, limiter, nil)
	if err != nil {
		t.Fatalf("NewHandler() error = %v", err)
	}

	body := `{"email":"rate@example.com","password":"AetherCode2026","tenant_id":"019b11a0-0000-7000-8000-000000000003"}`
	makeRequest := func() *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/v1/auth/login", strings.NewReader(body))
		req.RemoteAddr = "203.0.113.42:9999"
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		return rec
	}

	first := makeRequest()
	if first.Code != http.StatusOK {
		t.Fatalf("first request: status = %d, body = %s", first.Code, first.Body.String())
	}

	second := makeRequest()
	if second.Code != http.StatusTooManyRequests {
		t.Fatalf("second request: expected 429, got %d, body = %s", second.Code, second.Body.String())
	}
	if second.Header().Get("Retry-After") != retryAfterLoginOrPasswordReset {
		t.Fatalf("Retry-After = %q, want %q", second.Header().Get("Retry-After"), retryAfterLoginOrPasswordReset)
	}
	var problem map[string]any
	if err := json.Unmarshal(second.Body.Bytes(), &problem); err != nil {
		t.Fatalf("decode 429 body: %v", err)
	}
	if problem["code"] != "too_many_requests" {
		t.Fatalf("429 code = %q, want too_many_requests", problem["code"])
	}
}

func TestLoginRateLimitXForwardedForOverridesRemoteAddr(t *testing.T) {
	t.Parallel()
	limiter, err := ratelimit.New(ratelimit.Config{
		Capacity:        1,
		RefillPerSecond: 0.0001,
		MaxEntries:      100,
		IdleTTL:         time.Hour,
	})
	if err != nil {
		t.Fatalf("ratelimit.New() error = %v", err)
	}
	fake := &fakeUseCases{}
	_, handler, err := NewHandler("identity", fake, nil, fakeVerifier{}, false, nil, limiter, nil)
	if err != nil {
		t.Fatalf("NewHandler() error = %v", err)
	}

	body := `{"email":"xff@example.com","password":"AetherCode2026","tenant_id":"019b11a0-0000-7000-8000-000000000003"}`
	makeRequestWithXFF := func(xff string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/v1/auth/login", strings.NewReader(body))
		req.RemoteAddr = "10.0.0.1:1234" // gateway address; varies per request
		req.Header.Set("X-Forwarded-For", xff)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		return rec
	}

	// First request from real client IP succeeds.
	if r := makeRequestWithXFF("198.51.100.7"); r.Code != http.StatusOK {
		t.Fatalf("first request: status = %d, body = %s", r.Code, r.Body.String())
	}
	// Second request from the same real client IP (different gateway RemoteAddr) is limited.
	if r := makeRequestWithXFF("198.51.100.7"); r.Code != http.StatusTooManyRequests {
		t.Fatalf("second request from same real IP: expected 429, got %d", r.Code)
	}
}

func TestLoginNilLimiterAllowsAllRequests(t *testing.T) {
	t.Parallel()
	fake := &fakeUseCases{}
	_, handler, err := NewHandler("identity", fake, nil, fakeVerifier{}, false, nil, nil, nil)
	if err != nil {
		t.Fatalf("NewHandler() error = %v", err)
	}
	body := `{"email":"nolimit@example.com","password":"AetherCode2026","tenant_id":"019b11a0-0000-7000-8000-000000000003"}`
	for i := range 5 {
		req := httptest.NewRequest(http.MethodPost, "/v1/auth/login", strings.NewReader(body))
		req.RemoteAddr = "192.0.2.1:1234"
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("request %d: status = %d (nil limiter must allow all)", i+1, rec.Code)
		}
	}
}

func TestPasswordResetRateLimitBlocks429AfterBurstExhausted(t *testing.T) {
	t.Parallel()
	limiter, err := ratelimit.New(ratelimit.Config{
		Capacity:        1,
		RefillPerSecond: 0.0001,
		MaxEntries:      100,
		IdleTTL:         time.Hour,
	})
	if err != nil {
		t.Fatalf("ratelimit.New() error = %v", err)
	}
	fake := &fakeUseCases{}
	_, handler, err := NewHandler("identity", fake, nil, fakeVerifier{}, false, nil, nil, limiter)
	if err != nil {
		t.Fatalf("NewHandler() error = %v", err)
	}

	body := `{"email":"rate@example.com"}`
	makeRequest := func() *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/v1/auth/password-reset", strings.NewReader(body))
		req.RemoteAddr = "203.0.113.42:9999"
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		return rec
	}

	first := makeRequest()
	if first.Code != http.StatusAccepted {
		t.Fatalf("first request: status = %d, body = %s", first.Code, first.Body.String())
	}

	second := makeRequest()
	if second.Code != http.StatusTooManyRequests {
		t.Fatalf("second request: expected 429, got %d, body = %s", second.Code, second.Body.String())
	}
	if second.Header().Get("Retry-After") != retryAfterLoginOrPasswordReset {
		t.Fatalf("Retry-After = %q, want %q", second.Header().Get("Retry-After"), retryAfterLoginOrPasswordReset)
	}
}

func TestPasswordResetRateLimitXForwardedForOverridesRemoteAddr(t *testing.T) {
	t.Parallel()
	limiter, err := ratelimit.New(ratelimit.Config{
		Capacity:        1,
		RefillPerSecond: 0.0001,
		MaxEntries:      100,
		IdleTTL:         time.Hour,
	})
	if err != nil {
		t.Fatalf("ratelimit.New() error = %v", err)
	}
	fake := &fakeUseCases{}
	_, handler, err := NewHandler("identity", fake, nil, fakeVerifier{}, false, nil, nil, limiter)
	if err != nil {
		t.Fatalf("NewHandler() error = %v", err)
	}

	body := `{"email":"xff@example.com"}`
	makeRequestWithXFF := func(xff string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/v1/auth/password-reset", strings.NewReader(body))
		req.RemoteAddr = "10.0.0.1:1234" // gateway address; varies per request
		req.Header.Set("X-Forwarded-For", xff)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		return rec
	}

	// First request from real client IP succeeds.
	if r := makeRequestWithXFF("198.51.100.7"); r.Code != http.StatusAccepted {
		t.Fatalf("first request: status = %d, body = %s", r.Code, r.Body.String())
	}
	// Second request from the same real client IP (different gateway RemoteAddr) is limited.
	if r := makeRequestWithXFF("198.51.100.7"); r.Code != http.StatusTooManyRequests {
		t.Fatalf("second request from same real IP: expected 429, got %d", r.Code)
	}
}

func TestPasswordResetCompleteRateLimitBlocks429AfterBurstExhausted(t *testing.T) {
	t.Parallel()
	limiter, err := ratelimit.New(ratelimit.Config{
		Capacity:        1,
		RefillPerSecond: 0.0001,
		MaxEntries:      100,
		IdleTTL:         time.Hour,
	})
	if err != nil {
		t.Fatalf("ratelimit.New() error = %v", err)
	}
	fake := &fakeUseCases{}
	_, handler, err := NewHandler("identity", fake, nil, fakeVerifier{}, false, nil, nil, limiter)
	if err != nil {
		t.Fatalf("NewHandler() error = %v", err)
	}

	body := `{"token":"reset-token","password":"AetherCode2026"}`
	makeRequest := func() *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/v1/auth/password-reset/complete", strings.NewReader(body))
		req.RemoteAddr = "203.0.113.42:9999"
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		return rec
	}

	first := makeRequest()
	if first.Code != http.StatusNoContent {
		t.Fatalf("first request: status = %d, body = %s", first.Code, first.Body.String())
	}

	second := makeRequest()
	if second.Code != http.StatusTooManyRequests {
		t.Fatalf("second request: expected 429, got %d, body = %s", second.Code, second.Body.String())
	}
}

func TestPasswordResetCompleteRateLimitXForwardedForOverridesRemoteAddr(t *testing.T) {
	t.Parallel()
	limiter, err := ratelimit.New(ratelimit.Config{
		Capacity:        1,
		RefillPerSecond: 0.0001,
		MaxEntries:      100,
		IdleTTL:         time.Hour,
	})
	if err != nil {
		t.Fatalf("ratelimit.New() error = %v", err)
	}
	fake := &fakeUseCases{}
	_, handler, err := NewHandler("identity", fake, nil, fakeVerifier{}, false, nil, nil, limiter)
	if err != nil {
		t.Fatalf("NewHandler() error = %v", err)
	}

	body := `{"token":"reset-token","password":"AetherCode2026"}`
	makeRequestWithXFF := func(xff string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/v1/auth/password-reset/complete", strings.NewReader(body))
		req.RemoteAddr = "10.0.0.1:1234" // gateway address; varies per request
		req.Header.Set("X-Forwarded-For", xff)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		return rec
	}

	// First request from real client IP succeeds.
	if r := makeRequestWithXFF("198.51.100.7"); r.Code != http.StatusNoContent {
		t.Fatalf("first request: status = %d, body = %s", r.Code, r.Body.String())
	}
	// Second request from the same real client IP (different gateway RemoteAddr) is limited.
	if r := makeRequestWithXFF("198.51.100.7"); r.Code != http.StatusTooManyRequests {
		t.Fatalf("second request from same real IP: expected 429, got %d", r.Code)
	}
}

func TestPasswordResetNilLimiterAllowsAllRequests(t *testing.T) {
	t.Parallel()
	fake := &fakeUseCases{}
	_, handler, err := NewHandler("identity", fake, nil, fakeVerifier{}, false, nil, nil, nil)
	if err != nil {
		t.Fatalf("NewHandler() error = %v", err)
	}
	body := `{"email":"nolimit@example.com"}`
	for i := range 5 {
		req := httptest.NewRequest(http.MethodPost, "/v1/auth/password-reset", strings.NewReader(body))
		req.RemoteAddr = "192.0.2.1:1234"
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusAccepted {
			t.Fatalf("request %d: status = %d (nil limiter must allow all)", i+1, rec.Code)
		}
	}
}

func TestGetPrincipalReturns200WhenFound(t *testing.T) {
	t.Parallel()
	principalID := "019b11a0-0000-7000-8000-000000000001"
	fake := &fakeUseCases{
		getPrincipalResult: &app.Principal{ID: principalID, Email: "ada@example.com", DisplayName: "Ada", Status: "active"},
	}
	_, handler, err := NewHandler("identity", fake, nil, fakeVerifier{}, false, nil, nil, nil)
	if err != nil {
		t.Fatalf("NewHandler() error = %v", err)
	}
	req := httptest.NewRequest(http.MethodGet, "/v1/principals/"+principalID, nil)
	req.Header.Set("Authorization", "Bearer valid-token")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body["id"] != principalID {
		t.Fatalf("response id = %q, want %q", body["id"], principalID)
	}
	if fake.getPrincipalID != principalID {
		t.Fatalf("service received id = %q, want %q", fake.getPrincipalID, principalID)
	}
}

func TestGetPrincipalReturns404WhenNotFound(t *testing.T) {
	t.Parallel()
	fake := &fakeUseCases{} // getPrincipalResult is nil → not found
	_, handler, err := NewHandler("identity", fake, nil, fakeVerifier{}, false, nil, nil, nil)
	if err != nil {
		t.Fatalf("NewHandler() error = %v", err)
	}
	req := httptest.NewRequest(http.MethodGet, "/v1/principals/019b11a0-0000-7000-8000-000000000099", nil)
	req.Header.Set("Authorization", "Bearer valid-token")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
}

func TestGetPrincipalRejectsUnauthenticated(t *testing.T) {
	t.Parallel()
	fake := &fakeUseCases{}
	_, handler, err := NewHandler("identity", fake, nil, fakeVerifier{}, false, nil, nil, nil)
	if err != nil {
		t.Fatalf("NewHandler() error = %v", err)
	}
	req := httptest.NewRequest(http.MethodGet, "/v1/principals/019b11a0-0000-7000-8000-000000000001", nil)
	// No Authorization header.
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code == http.StatusOK {
		t.Fatal("unauthenticated request was accepted, want a non-200 status")
	}
}

func TestGetPrincipalRejectsMalformedID(t *testing.T) {
	t.Parallel()
	fake := &fakeUseCases{}
	_, handler, err := NewHandler("identity", fake, nil, fakeVerifier{}, false, nil, nil, nil)
	if err != nil {
		t.Fatalf("NewHandler() error = %v", err)
	}
	req := httptest.NewRequest(http.MethodGet, "/v1/principals/not-a-uuid", nil)
	req.Header.Set("Authorization", "Bearer valid-token")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("malformed UUID: status = %d, body = %s", rec.Code, rec.Body.String())
	}
}
