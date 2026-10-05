package edge

import (
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/aethercode/aethercode/libs/pkg/authn"
	"github.com/aethercode/aethercode/libs/pkg/ratelimit"
)

type testVerifier struct {
	claims authn.Claims
	err    error
	calls  atomic.Int32
}

func (verifier *testVerifier) Verify(_ string, _ time.Time) (authn.Claims, error) {
	verifier.calls.Add(1)
	return verifier.claims, verifier.err
}

func newTestHandler(t *testing.T, upstreams map[string]*url.URL, verifier AssertionVerifier, prefixes []string, trusted []*net.IPNet) *Handler {
	t.Helper()
	limiter, err := ratelimit.New(ratelimit.Config{
		Capacity: 100, RefillPerSecond: 100, MaxEntries: 100, IdleTTL: time.Minute,
	})
	if err != nil {
		t.Fatalf("new limiter: %v", err)
	}
	handler, err := New(Config{
		Upstreams:            upstreams,
		Verifier:             verifier,
		Limiter:              limiter,
		TrustedProxyCIDRs:    trusted,
		SEBProtectedPrefixes: prefixes,
		SEBPublicOrigin:      "https://exam.example",
		RequestTimeout:       time.Second,
		SEBValidationTimeout: time.Second,
	})
	if err != nil {
		t.Fatalf("new handler: %v", err)
	}
	return handler
}

func mustURL(t *testing.T, raw string) *url.URL {
	t.Helper()
	parsed, err := url.Parse(raw)
	if err != nil {
		t.Fatalf("parse URL: %v", err)
	}
	return parsed
}

func proxyRequest(method, target string) *http.Request {
	request := httptest.NewRequest(method, target, nil)
	request.RemoteAddr = "192.0.2.44:4242"
	return request
}

func TestHandlerVerifiesProtectedRouteAndStripsServicePrefix(t *testing.T) {
	var calls atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		calls.Add(1)
		if request.URL.Path != "/v1/attempts" || request.URL.RawQuery != "page=2" {
			t.Errorf("unexpected upstream route %q?%q", request.URL.Path, request.URL.RawQuery)
		}
		if got := request.Header.Get("Authorization"); got != "Bearer assertion" {
			t.Errorf("authorization was not preserved: %q", got)
		}
		if got := request.Header.Get("Idempotency-Key"); got != "key-1" {
			t.Errorf("idempotency key was not preserved: %q", got)
		}
		if got := request.Header.Get("Traceparent"); got != "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-00" {
			t.Errorf("traceparent was not preserved: %q", got)
		}
		if got := request.Header.Get("X-Forwarded-For"); got != "192.0.2.44" {
			t.Errorf("unexpected forwarded address: %q", got)
		}
		if got := request.Header.Get("Keep-Alive"); got != "" {
			t.Errorf("hop-by-hop Keep-Alive was forwarded: %q", got)
		}
		writer.WriteHeader(http.StatusCreated)
	}))
	defer upstream.Close()
	verifier := &testVerifier{claims: authn.Claims{Subject: "11111111-1111-4111-8111-111111111111"}}
	handler := newTestHandler(t, map[string]*url.URL{"submission": mustURL(t, upstream.URL)}, verifier, nil, nil)
	request := proxyRequest(http.MethodPost, "/api/submission/v1/attempts?page=2")
	request.Header.Set("Authorization", "Bearer assertion")
	request.Header.Set("Idempotency-Key", "key-1")
	request.Header.Set("Traceparent", "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-00")
	// Browsers and nginx send hop-by-hop headers; they are accepted and dropped.
	request.Header.Set("Connection", "keep-alive")
	request.Header.Set("Keep-Alive", "timeout=5")
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusCreated {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	if calls.Load() != 1 || verifier.calls.Load() != 1 {
		t.Fatalf("upstream calls = %d, verifier calls = %d", calls.Load(), verifier.calls.Load())
	}
}

func TestHandlerOnlyAllowsExplicitIdentityPublicRoutes(t *testing.T) {
	var calls atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		calls.Add(1)
		if request.URL.Path != "/v1/auth/login" {
			t.Errorf("unexpected path %q", request.URL.Path)
		}
		writer.WriteHeader(http.StatusNoContent)
	}))
	defer upstream.Close()
	verifier := &testVerifier{claims: authn.Claims{Subject: "11111111-1111-4111-8111-111111111111"}}
	handler := newTestHandler(t, map[string]*url.URL{"identity": mustURL(t, upstream.URL)}, verifier, nil, nil)

	publicRequest := proxyRequest(http.MethodPost, "/api/identity/v1/auth/login")
	publicRecorder := httptest.NewRecorder()
	handler.ServeHTTP(publicRecorder, publicRequest)
	if publicRecorder.Code != http.StatusNoContent || verifier.calls.Load() != 0 {
		t.Fatalf("public route status = %d, verifier calls = %d", publicRecorder.Code, verifier.calls.Load())
	}

	protectedRequest := proxyRequest(http.MethodPost, "/api/identity/v1/auth/mfa/totp")
	protectedRecorder := httptest.NewRecorder()
	handler.ServeHTTP(protectedRecorder, protectedRequest)
	if protectedRecorder.Code != http.StatusUnauthorized {
		t.Fatalf("protected status = %d", protectedRecorder.Code)
	}
}

func TestHandlerNeverRoutesJudgeOrSpoofedForwardingHeaders(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Fatal("upstream must not receive rejected gateway requests")
	}))
	defer upstream.Close()
	verifier := &testVerifier{claims: authn.Claims{Subject: "11111111-1111-4111-8111-111111111111"}}
	handler := newTestHandler(t, map[string]*url.URL{"submission": mustURL(t, upstream.URL)}, verifier, nil, nil)

	judgeRequest := proxyRequest(http.MethodGet, "/api/judge/v1/jobs")
	judgeRecorder := httptest.NewRecorder()
	handler.ServeHTTP(judgeRecorder, judgeRequest)
	if judgeRecorder.Code != http.StatusNotFound {
		t.Fatalf("judge status = %d", judgeRecorder.Code)
	}

	spoofedRequest := proxyRequest(http.MethodGet, "/api/submission/v1/attempts")
	spoofedRequest.Header.Set("Authorization", "Bearer assertion")
	spoofedRequest.Header.Set("X-Forwarded-For", "203.0.113.4")
	spoofedRecorder := httptest.NewRecorder()
	handler.ServeHTTP(spoofedRecorder, spoofedRequest)
	if spoofedRecorder.Code != http.StatusBadRequest {
		t.Fatalf("spoofed forwarding status = %d", spoofedRecorder.Code)
	}
}

func TestHandlerUsesForwardedForOnlyFromTrustedIngress(t *testing.T) {
	_, trustedRange, err := net.ParseCIDR("10.0.0.0/8")
	if err != nil {
		t.Fatal(err)
	}
	upstream := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if got := request.Header.Get("X-Forwarded-For"); got != "203.0.113.8" {
			t.Errorf("forwarded client = %q", got)
		}
		writer.WriteHeader(http.StatusNoContent)
	}))
	defer upstream.Close()
	verifier := &testVerifier{claims: authn.Claims{Subject: "11111111-1111-4111-8111-111111111111"}}
	handler := newTestHandler(t, map[string]*url.URL{"submission": mustURL(t, upstream.URL)}, verifier, nil, []*net.IPNet{trustedRange})
	request := proxyRequest(http.MethodGet, "/api/submission/v1/attempts")
	request.RemoteAddr = "10.1.2.3:2345"
	request.Header.Set("Authorization", "Bearer assertion")
	request.Header.Set("X-Forwarded-For", "203.0.113.8, 10.1.2.3")
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusNoContent {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
}

func TestHandlerChecksSEBRequestHashBeforeForwarding(t *testing.T) {
	const tenantID = "33333333-3333-4333-8333-333333333333"
	requestHash, configKeyHash := strings.Repeat("a", 64), strings.Repeat("b", 64)
	var targetCalls atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		targetCalls.Add(1)
		for _, header := range []string{secureConfigHeader, secureBrowserHeader} {
			if request.Header.Get(header) != "" {
				t.Errorf("SEB input header %s leaked to the target service", header)
			}
		}
		writer.WriteHeader(http.StatusAccepted)
	}))
	defer target.Close()
	var checks atomic.Int32
	seb := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		checks.Add(1)
		if request.URL.Path != "/v1/tenants/"+tenantID+"/request-checks" {
			t.Errorf("SEB check path = %s", request.URL.Path)
		}
		if request.Header.Get("Authorization") != "Bearer assertion" {
			t.Errorf("SEB did not receive the original bearer assertion")
		}
		var body sebCheckRequest
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Errorf("decode body: %v", err)
		}
		want := sebCheckRequest{
			URL:         "https://exam.example/api/submission/v1/tenants/" + tenantID + "/attempts/22222222-2222-4222-8222-222222222222/submit?x=%2F",
			RequestHash: requestHash, ConfigKeyHash: configKeyHash,
		}
		if body != want {
			t.Errorf("SEB check = %+v, want %+v", body, want)
		}
		_ = json.NewEncoder(writer).Encode(sebCheckResponse{Result: "matched"})
	}))
	defer seb.Close()
	verifier := &testVerifier{claims: authn.Claims{Subject: "11111111-1111-4111-8111-111111111111"}}
	handler := newTestHandler(t, map[string]*url.URL{
		"submission": mustURL(t, target.URL),
		"seb":        mustURL(t, seb.URL),
	}, verifier, []string{"/api/submission/v1/tenants"}, nil)
	request := proxyRequest(http.MethodPost, "/api/submission/v1/tenants/"+tenantID+"/attempts/22222222-2222-4222-8222-222222222222/submit?x=%2F")
	request.Header.Set("Authorization", "Bearer assertion")
	request.Header.Set(secureBrowserHeader, requestHash)
	request.Header.Set(secureConfigHeader, configKeyHash)
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusAccepted || targetCalls.Load() != 1 || checks.Load() != 1 {
		t.Fatalf("status = %d, target calls = %d, checks = %d", recorder.Code, targetCalls.Load(), checks.Load())
	}
}

func TestHandlerFailsClosedOnSEBCheck(t *testing.T) {
	for name, testCase := range map[string]struct {
		path   string
		result string
		status int
	}{
		"mismatched hash":   {"/api/submission/v1/tenants/33333333-3333-4333-8333-333333333333/attempts", "mismatched", http.StatusOK},
		"missing headers":   {"/api/submission/v1/tenants/33333333-3333-4333-8333-333333333333/attempts", "missing", http.StatusOK},
		"SEB unavailable":   {"/api/submission/v1/tenants/33333333-3333-4333-8333-333333333333/attempts", "", http.StatusServiceUnavailable},
		"no tenant in path": {"/api/submission/v1/tenants/not-a-tenant/attempts", "matched", http.StatusOK},
	} {
		t.Run(name, func(t *testing.T) {
			target := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
				t.Error("target must not receive a failed SEB request")
			}))
			defer target.Close()
			seb := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
				writer.WriteHeader(testCase.status)
				_ = json.NewEncoder(writer).Encode(sebCheckResponse{Result: testCase.result})
			}))
			defer seb.Close()
			verifier := &testVerifier{claims: authn.Claims{Subject: "11111111-1111-4111-8111-111111111111"}}
			handler := newTestHandler(t, map[string]*url.URL{
				"submission": mustURL(t, target.URL),
				"seb":        mustURL(t, seb.URL),
			}, verifier, []string{"/api/submission/v1/tenants"}, nil)
			request := proxyRequest(http.MethodGet, testCase.path)
			request.Header.Set("Authorization", "Bearer assertion")
			recorder := httptest.NewRecorder()

			handler.ServeHTTP(recorder, request)

			if recorder.Code != http.StatusForbidden {
				t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
			}
		})
	}
}
