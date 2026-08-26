package httpadapter

import (
	"context"
	"encoding/base64"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	centralauthz "github.com/aethercode/aethercode/libs/pkg/authz"
	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
	"github.com/aethercode/aethercode/libs/pkg/httpauth"
	"github.com/aethercode/aethercode/libs/pkg/ratelimit"
	authzv1 "github.com/aethercode/aethercode/libs/proto/gen/go/aethercode/authz/v1"
	"google.golang.org/grpc"
)

// unverifiedBearerToken builds a compact JWS with the given subject and no
// verifiable signature. It exercises only the unsigned routing path
// (candidateResourceID / authn.UnverifiedSubject); it must never be accepted
// as a verified assertion.
func unverifiedBearerToken(subject string) string {
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"none"}`))
	claims := base64.RawURLEncoding.EncodeToString([]byte(`{"sub":"` + subject + `"}`))
	signature := base64.RawURLEncoding.EncodeToString([]byte("unsigned"))
	return header + "." + claims + "." + signature
}

// recordingAuthorizationRPC captures the central authorization request a route
// makes and always denies it, so a handler test can assert which protected
// resource the route asks for without a live decision service.
type recordingAuthorizationRPC struct {
	request *authzv1.AuthorizeRequest
}

func (rpc *recordingAuthorizationRPC) Authorize(
	_ context.Context, request *authzv1.AuthorizeRequest, _ ...grpc.CallOption,
) (*authzv1.AuthorizeResponse, error) {
	rpc.request = request
	return &authzv1.AuthorizeResponse{Allowed: false}, nil
}

// TestUnitResultRoutesRequestTheirOwnProtectedResource pins the access-control
// boundary between the two views. The candidate route asks for `attempts`,
// which a student's self-scoped assignment can satisfy; the reviewer route asks
// for `judge_receipts`, which the canonical policy grants only to a college-,
// department-, batch-, or platform-scoped role. Pointing the reviewer route at
// `attempts` would silently hand every candidate their own per-unit breakdown.
func TestUnitResultRoutesRequestTheirOwnProtectedResource(t *testing.T) {
	t.Parallel()

	const (
		tenantID    = "018f4b0d-08f8-7c09-9ba7-efdf9c221010"
		attemptID   = "018f4b0d-08f8-7c09-9ba7-efdf9c221011"
		candidateID = "018f4b0d-08f8-7c09-9ba7-efdf9c221012"
	)
	testCases := []struct {
		name             string
		route            func(*Handler, http.ResponseWriter, *http.Request)
		wantResourceType string
		wantResourceID   string
	}{
		{
			name:             "candidate summary authorizes against attempts",
			route:            (*Handler).getAttemptUnitSummary,
			wantResourceType: "attempts",
			wantResourceID:   candidateID,
		},
		{
			name:             "reviewer breakdown authorizes against judge receipts",
			route:            (*Handler).listAttemptUnitResults,
			wantResourceType: "judge_receipts",
			wantResourceID:   attemptID,
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()

			rpc := &recordingAuthorizationRPC{}
			client, err := centralauthz.NewClient(rpc)
			if err != nil {
				t.Fatalf("NewClient() error = %v", err)
			}
			authorizer, err := httpauth.New(client, "submission")
			if err != nil {
				t.Fatalf("httpauth.New() error = %v", err)
			}
			request := httptest.NewRequest(http.MethodGet, "/v1/tenants/"+tenantID+"/attempts/"+attemptID+"/unit-results", nil)
			request.SetPathValue("tenant_id", tenantID)
			request.SetPathValue("attempt_id", attemptID)
			request.Header.Set("Authorization", "Bearer "+unverifiedBearerToken(candidateID))

			recorder := httptest.NewRecorder()
			testCase.route(&Handler{authorizer: authorizer}, recorder, request)

			if recorder.Code != http.StatusForbidden {
				t.Fatalf("status = %d, want 403; body = %s", recorder.Code, recorder.Body.String())
			}
			if rpc.request == nil {
				t.Fatal("route did not request a central authorization decision")
			}
			if rpc.request.GetResourceType() != testCase.wantResourceType {
				t.Fatalf("resource type = %q, want %q", rpc.request.GetResourceType(), testCase.wantResourceType)
			}
			if rpc.request.GetResourceId() != testCase.wantResourceID {
				t.Fatalf("resource id = %q, want %q", rpc.request.GetResourceId(), testCase.wantResourceID)
			}
			if rpc.request.GetAction() != "read" || rpc.request.GetTenantId() != tenantID {
				t.Fatalf("action/tenant = %q/%q", rpc.request.GetAction(), rpc.request.GetTenantId())
			}
		})
	}
}

func TestRequiredIdempotencyKey(t *testing.T) {
	request := httptest.NewRequest("POST", "/", nil)
	if _, err := requiredIdempotencyKey(request); err == nil {
		t.Fatal("missing key must fail")
	}
	request.Header.Set("Idempotency-Key", "request-1")
	key, err := requiredIdempotencyKey(request)
	if err != nil || key != "request-1" {
		t.Fatalf("requiredIdempotencyKey() = %q, %v", key, err)
	}
	request.Header.Set("Idempotency-Key", strings.Repeat("x", 256))
	_, err = requiredIdempotencyKey(request)
	var applicationError *apperrors.Error
	if !errors.As(err, &applicationError) || applicationError.Code != apperrors.CodeInvalidArgument {
		t.Fatalf("error = %#v, want invalid argument", err)
	}
}

func TestOptionalUUIDQueryAcceptsEmpty(t *testing.T) {
	t.Parallel()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	if v, err := optionalUUIDQuery(req, "exam_version_id"); err != nil || v != "" {
		t.Fatalf("empty param should return empty string, got %q, %v", v, err)
	}
}

func TestOptionalUUIDQueryRejectsMalformed(t *testing.T) {
	t.Parallel()
	req := httptest.NewRequest(http.MethodGet, "/?exam_version_id=not-a-uuid", nil)
	if _, err := optionalUUIDQuery(req, "exam_version_id"); err == nil {
		t.Fatal("malformed UUID must be rejected")
	}
}

func TestOptionalUUIDQueryAcceptsValidUUID(t *testing.T) {
	t.Parallel()
	req := httptest.NewRequest(http.MethodGet,
		"/?exam_version_id=018f4b0d-08f8-7c09-9ba7-efdf9c221001", nil)
	v, err := optionalUUIDQuery(req, "exam_version_id")
	if err != nil || v != "018f4b0d-08f8-7c09-9ba7-efdf9c221001" {
		t.Fatalf("valid UUID rejected: %q, %v", v, err)
	}
}

func newStartAttemptRequest(candidateID string) *http.Request {
	body := `{"candidate_assignment_id":"018f4b0d-08f8-7c09-9ba7-efdf9c221002"}`
	request := httptest.NewRequest(http.MethodPost, "/v1/tenants/018f4b0d-08f8-7c09-9ba7-efdf9c221003/attempts", strings.NewReader(body))
	request.SetPathValue("tenant_id", "018f4b0d-08f8-7c09-9ba7-efdf9c221003")
	request.Header.Set("Idempotency-Key", "request-1")
	request.Header.Set("Authorization", "Bearer "+unverifiedBearerToken(candidateID))
	return request
}

func TestStartAttemptRateLimitBlocks429AfterBurstExhausted(t *testing.T) {
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
	handler := &Handler{startAttemptLimiter: limiter}
	candidateID := "018f4b0d-08f8-7c09-9ba7-efdf9c221004"

	first := httptest.NewRecorder()
	handler.startAttempt(first, newStartAttemptRequest(candidateID))
	if first.Code == http.StatusTooManyRequests {
		t.Fatalf("first request: unexpectedly rate limited, body = %s", first.Body.String())
	}

	second := httptest.NewRecorder()
	handler.startAttempt(second, newStartAttemptRequest(candidateID))
	if second.Code != http.StatusTooManyRequests {
		t.Fatalf("second request: expected 429, got %d, body = %s", second.Code, second.Body.String())
	}
	if second.Header().Get("Retry-After") != retryAfterStartAttempt {
		t.Fatalf("Retry-After = %q, want %q", second.Header().Get("Retry-After"), retryAfterStartAttempt)
	}
}

func TestStartAttemptRateLimitTracksDistinctCandidatesSeparately(t *testing.T) {
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
	handler := &Handler{startAttemptLimiter: limiter}

	first := httptest.NewRecorder()
	handler.startAttempt(first, newStartAttemptRequest("018f4b0d-08f8-7c09-9ba7-efdf9c221005"))
	if first.Code == http.StatusTooManyRequests {
		t.Fatalf("candidate-1 first request: unexpectedly rate limited")
	}

	second := httptest.NewRecorder()
	handler.startAttempt(second, newStartAttemptRequest("018f4b0d-08f8-7c09-9ba7-efdf9c221006"))
	if second.Code == http.StatusTooManyRequests {
		t.Fatalf("candidate-2 first request: unexpectedly rate limited by candidate-1's bucket")
	}
}

func TestStartAttemptNilLimiterAllowsAllRequests(t *testing.T) {
	t.Parallel()
	handler := &Handler{}
	candidateID := "018f4b0d-08f8-7c09-9ba7-efdf9c221007"
	for i := range 5 {
		rec := httptest.NewRecorder()
		handler.startAttempt(rec, newStartAttemptRequest(candidateID))
		if rec.Code == http.StatusTooManyRequests {
			t.Fatalf("request %d: unexpectedly rate limited (nil limiter must allow all)", i+1)
		}
	}
}
