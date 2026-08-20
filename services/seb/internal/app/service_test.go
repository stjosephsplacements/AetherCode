package app

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	centralauthz "github.com/aethercode/aethercode/libs/pkg/authz"
	"github.com/aethercode/aethercode/libs/pkg/database"
	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
)

func TestNewQuitTokenIsOneWayAndHighEntropy(t *testing.T) {
	firstToken, firstHash, err := newQuitToken()
	if err != nil {
		t.Fatalf("generate first quit token: %v", err)
	}
	secondToken, secondHash, err := newQuitToken()
	if err != nil {
		t.Fatalf("generate second quit token: %v", err)
	}
	if len(firstToken) < 40 || firstHash != HashHeaderValue(firstToken) {
		t.Fatalf("first token/hash pair is invalid")
	}
	if firstToken == secondToken || firstHash == secondHash {
		t.Fatalf("quit token generation repeated unexpectedly")
	}
	if strings.Contains(firstHash, firstToken) {
		t.Fatalf("hash exposed plaintext token")
	}
}

func TestValidateConfigurationRejectsPlaintextInsteadOfHash(t *testing.T) {
	err := validateConfiguration(
		"018f4b0d-08f8-7c09-9ba7-efdf9c223001",
		"018f4b0d-08f8-7c09-9ba7-efdf9c223002",
		"018f4b0d-08f8-7c09-9ba7-efdf9c223003",
		"018f4b0d-08f8-7c09-9ba7-efdf9c223004",
		1, "tenant/exams/config.seb", strings.Repeat("a", 64), "kms://india/key/1",
		"not-a-sha256", "",
		"018f4b0d-08f8-7c09-9ba7-efdf9c223005",
	)
	if err == nil {
		t.Fatal("expected non-hash SEB key material to be rejected")
	}
}

func TestValidateSessionHeaderRequiresGatewayFingerprint(t *testing.T) {
	service := &Service{}
	_, err := service.ValidateSessionHeader(context.Background(), centralauthz.Capability{}, ValidateSessionHeader{
		ValidationEventID:   "018f4b0d-08f8-7c09-9ba7-efdf9c223001",
		TenantID:            "018f4b0d-08f8-7c09-9ba7-efdf9c223002",
		SessionID:           "018f4b0d-08f8-7c09-9ba7-efdf9c223003",
		HeaderKind:          "config_key",
		HeaderPresent:       true,
		PresentedHeaderHash: strings.Repeat("a", 64),
	})
	if err == nil {
		t.Fatal("validation without the non-secret gateway fingerprint must fail")
	}
}

func TestValidateIdempotencyRequiresPrintableKeyAndChecksum(t *testing.T) {
	t.Parallel()
	validHash := strings.Repeat("a", 64)
	for _, testCase := range []struct {
		name        string
		key         string
		requestHash string
		wantErr     bool
	}{
		{"valid", "seb-write-001", validHash, false},
		{"missing key", "", validHash, true},
		{"leading whitespace", " seb-write", validHash, true},
		{"unsafe key", "seb\nwrite", validHash, true},
		{"long key", strings.Repeat("x", 256), validHash, true},
		{"bad hash", "seb-write-001", "not-a-hash", true},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			err := validateIdempotency(testCase.key, testCase.requestHash)
			if (err != nil) != testCase.wantErr {
				t.Fatalf("validateIdempotency() error = %v, wantErr %t", err, testCase.wantErr)
			}
		})
	}
}

func TestScopedIdempotencyOperationIsActorAndResourceBound(t *testing.T) {
	t.Parallel()
	capability := centralauthz.Capability{
		ActorID:  "018f4b0d-08f8-7c09-9ba7-efdf9c223001",
		TenantID: "018f4b0d-08f8-7c09-9ba7-efdf9c223002",
	}
	operation, err := scopedIdempotencyOperation(capability, capability.TenantID, "seb.session.close", "018f4b0d-08f8-7c09-9ba7-efdf9c223003")
	if err != nil {
		t.Fatal(err)
	}
	want := "seb.session.close:018f4b0d-08f8-7c09-9ba7-efdf9c223001:018f4b0d-08f8-7c09-9ba7-efdf9c223003"
	if operation != want {
		t.Fatalf("operation = %q, want %q", operation, want)
	}
	if _, err := scopedIdempotencyOperation(capability, "018f4b0d-08f8-7c09-9ba7-efdf9c223004", "seb.session.close", ""); err == nil {
		t.Fatal("tenant mismatch must fail before a claim is made")
	}
}

func TestIssuedSessionIdempotencyNeverStoresOrReplaysQuitToken(t *testing.T) {
	t.Parallel()
	safe := issuedSessionReplay{Session: Session{ID: "018f4b0d-08f8-7c09-9ba7-efdf9c223001"}}
	payload, err := json.Marshal(safe)
	if err != nil {
		t.Fatal(err)
	}
	if jsonContainsKey(payload, "quit_token") {
		t.Fatalf("safe issuance replay payload contains a quit token: %s", payload)
	}
	if _, err := marshalSafeIdempotencyResponse(IssuedSession{Session: safe.Session, QuitToken: "token-value"}); err == nil || strings.Contains(err.Error(), "token-value") {
		t.Fatalf("token-bearing idempotency response must be rejected without leaking it, error = %v", err)
	}
	err = rejectIssuedSessionReplay(database.IdempotencyRecord{
		State:          database.IdempotencyCompleted,
		ResponseStatus: 201,
		ResponseBody:   payload,
	})
	var applicationError *apperrors.Error
	if !errors.As(err, &applicationError) || applicationError.Code != apperrors.CodeConflict {
		t.Fatalf("safe issuance replay error = %#v, want conflict", err)
	}
	if strings.Contains(err.Error(), "token-value") {
		t.Fatalf("replay error leaked a token: %v", err)
	}

	unsafe := []byte(`{"session":{"id":"018f4b0d-08f8-7c09-9ba7-efdf9c223001"},"quit_token":"token-value"}`)
	if !jsonContainsKey(unsafe, "quit_token") {
		t.Fatal("nested quit token was not detected")
	}
	if err := rejectIssuedSessionReplay(database.IdempotencyRecord{
		State: database.IdempotencyCompleted, ResponseStatus: 201, ResponseBody: unsafe,
	}); err == nil || strings.Contains(err.Error(), "token-value") {
		t.Fatalf("unsafe stored replay must fail without revealing a token, error = %v", err)
	}
}

func TestIssueSessionRejectsMissingCandidateBinding(t *testing.T) {
	t.Parallel()
	service := &Service{}
	service.now = func() time.Time { return time.Date(2026, 7, 24, 12, 0, 0, 0, time.UTC) }
	validExpiry := service.now().Add(1 * time.Hour)
	validHash := strings.Repeat("a", 64)
	validUUID := "018f4b0d-08f8-7c09-9ba7-efdf9c223001"

	for _, testCase := range []struct {
		name        string
		candidateID string
		attemptID   string
		configID    string
		wantErr     bool
	}{
		{
			name:        "missing candidate ID",
			candidateID: "",
			attemptID:   "018f4b0d-08f8-7c09-9ba7-efdf9c223003",
			configID:    "018f4b0d-08f8-7c09-9ba7-efdf9c223004",
			wantErr:     true,
		},
		{
			name:        "missing attempt ID",
			candidateID: "018f4b0d-08f8-7c09-9ba7-efdf9c223002",
			attemptID:   "",
			configID:    "018f4b0d-08f8-7c09-9ba7-efdf9c223004",
			wantErr:     true,
		},
		{
			name:        "missing configuration ID",
			candidateID: "018f4b0d-08f8-7c09-9ba7-efdf9c223002",
			attemptID:   "018f4b0d-08f8-7c09-9ba7-efdf9c223003",
			configID:    "",
			wantErr:     true,
		},
		{
			name:        "non-UUID candidate ID",
			candidateID: "not-a-uuid",
			attemptID:   "018f4b0d-08f8-7c09-9ba7-efdf9c223003",
			configID:    "018f4b0d-08f8-7c09-9ba7-efdf9c223004",
			wantErr:     true,
		},
		{
			name:        "non-UUID attempt ID",
			candidateID: "018f4b0d-08f8-7c09-9ba7-efdf9c223002",
			attemptID:   "not-a-uuid",
			configID:    "018f4b0d-08f8-7c09-9ba7-efdf9c223004",
			wantErr:     true,
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			_, err := service.IssueSession(context.Background(), centralauthz.Capability{}, IssueSession{
				ID:              validUUID,
				EventID:         validUUID,
				TenantID:        validUUID,
				ConfigurationID: testCase.configID,
				AttemptID:       testCase.attemptID,
				CandidateID:     testCase.candidateID,
				ExpiresAt:       validExpiry,
				IdempotencyKey:  "seb-issue-001",
				RequestHash:     validHash,
			})
			if (err != nil) != testCase.wantErr {
				t.Fatalf("IssueSession() error = %v, wantErr %t", err, testCase.wantErr)
			}
			var appErr *apperrors.Error
			if testCase.wantErr && errors.As(err, &appErr) && appErr.Code != apperrors.CodeInvalidArgument {
				t.Fatalf("expected CodeInvalidArgument, got %s", appErr.Code)
			}
		})
	}
}

func TestIssueSessionRejectsExpiredOrFutureExpiryBeyond24Hours(t *testing.T) {
	t.Parallel()
	service := &Service{}
	fixedNow := time.Date(2026, 7, 24, 12, 0, 0, 0, time.UTC)
	service.now = func() time.Time { return fixedNow }
	validHash := strings.Repeat("a", 64)
	validUUID := "018f4b0d-08f8-7c09-9ba7-efdf9c223001"

	for _, testCase := range []struct {
		name      string
		expiresAt time.Time
		wantErr   bool
	}{
		{
			name:      "expires in the past",
			expiresAt: fixedNow.Add(-1 * time.Hour),
			wantErr:   true,
		},
		{
			name:      "expires exactly now",
			expiresAt: fixedNow,
			wantErr:   true,
		},
		{
			name:      "expires 25 hours in future",
			expiresAt: fixedNow.Add(25 * time.Hour),
			wantErr:   true,
		},
		{
			name:      "expires 24 hours in future (boundary)",
			expiresAt: fixedNow.Add(24 * time.Hour),
			wantErr:   true,
		},
		{
			name:      "zero time",
			expiresAt: time.Time{},
			wantErr:   true,
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			_, err := service.IssueSession(context.Background(), centralauthz.Capability{}, IssueSession{
				ID:              validUUID,
				EventID:         "018f4b0d-08f8-7c09-9ba7-efdf9c223002",
				TenantID:        "018f4b0d-08f8-7c09-9ba7-efdf9c223003",
				ConfigurationID: "018f4b0d-08f8-7c09-9ba7-efdf9c223004",
				AttemptID:       "018f4b0d-08f8-7c09-9ba7-efdf9c223005",
				CandidateID:     "018f4b0d-08f8-7c09-9ba7-efdf9c223006",
				ExpiresAt:       testCase.expiresAt,
				IdempotencyKey:  "seb-issue-001",
				RequestHash:     validHash,
			})
			if (err != nil) != testCase.wantErr {
				t.Fatalf("IssueSession() error = %v, wantErr %t", err, testCase.wantErr)
			}
			var appErr *apperrors.Error
			if testCase.wantErr && errors.As(err, &appErr) && appErr.Code != apperrors.CodeInvalidArgument {
				t.Fatalf("expected CodeInvalidArgument, got %s", appErr.Code)
			}
		})
	}
}

func TestCloseSessionRejectsZeroExpectedVersion(t *testing.T) {
	t.Parallel()
	service := &Service{}
	validUUID := "018f4b0d-08f8-7c09-9ba7-efdf9c223001"
	validHash := strings.Repeat("a", 64)

	for _, testCase := range []struct {
		name            string
		expectedVersion int64
		reason          string
		wantErr         bool
	}{
		{
			name:            "zero expected version",
			expectedVersion: 0,
			reason:          "candidate requested quit",
			wantErr:         true,
		},
		{
			name:            "negative expected version",
			expectedVersion: -1,
			reason:          "candidate requested quit",
			wantErr:         true,
		},
		{
			name:            "missing reason",
			expectedVersion: 1,
			reason:          "",
			wantErr:         true,
		},
		{
			name:            "reason exceeds 500 chars",
			expectedVersion: 1,
			reason:          strings.Repeat("a", 501),
			wantErr:         true,
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			_, err := service.CloseSession(context.Background(), centralauthz.Capability{}, CloseSession{
				ID:              validUUID,
				TenantID:        "018f4b0d-08f8-7c09-9ba7-efdf9c223002",
				EventID:         "018f4b0d-08f8-7c09-9ba7-efdf9c223003",
				ExpectedVersion: testCase.expectedVersion,
				Reason:          testCase.reason,
				IdempotencyKey:  "seb-close-001",
				RequestHash:     validHash,
			})
			if (err != nil) != testCase.wantErr {
				t.Fatalf("CloseSession() error = %v, wantErr %t", err, testCase.wantErr)
			}
			var appErr *apperrors.Error
			if testCase.wantErr && errors.As(err, &appErr) && appErr.Code != apperrors.CodeInvalidArgument {
				t.Fatalf("expected CodeInvalidArgument, got %s", appErr.Code)
			}
		})
	}
}

func TestValidateSessionHeaderRejectsAbsentHeaderWithHash(t *testing.T) {
	t.Parallel()
	service := &Service{}
	validUUID := "018f4b0d-08f8-7c09-9ba7-efdf9c223001"
	validHash := strings.Repeat("a", 64)

	for _, testCase := range []struct {
		name                string
		headerPresent       bool
		presentedHeaderHash string
		wantErr             bool
	}{
		{
			name:                "absent with hash (invalid)",
			headerPresent:       false,
			presentedHeaderHash: validHash,
			wantErr:             true,
		},
		{
			name:                "present without hash (invalid)",
			headerPresent:       true,
			presentedHeaderHash: "",
			wantErr:             true,
		},
		{
			name:                "present with whitespace-only hash (invalid)",
			headerPresent:       true,
			presentedHeaderHash: "   ",
			wantErr:             true,
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			_, err := service.ValidateSessionHeader(context.Background(), centralauthz.Capability{}, ValidateSessionHeader{
				ValidationEventID:      validUUID,
				TenantID:               "018f4b0d-08f8-7c09-9ba7-efdf9c223002",
				SessionID:              "018f4b0d-08f8-7c09-9ba7-efdf9c223003",
				HeaderKind:             "config_key",
				HeaderPresent:          testCase.headerPresent,
				PresentedHeaderHash:    testCase.presentedHeaderHash,
				RequestFingerprintHash: validHash,
			})
			if (err != nil) != testCase.wantErr {
				t.Fatalf("ValidateSessionHeader() error = %v, wantErr %t", err, testCase.wantErr)
			}
			var appErr *apperrors.Error
			if testCase.wantErr && errors.As(err, &appErr) && appErr.Code != apperrors.CodeInvalidArgument {
				t.Fatalf("expected CodeInvalidArgument, got %s", appErr.Code)
			}
		})
	}
}

func TestValidateSessionHeaderAcceptsOnlyKnownHeaderKinds(t *testing.T) {
	t.Parallel()
	service := &Service{}
	validUUID := "018f4b0d-08f8-7c09-9ba7-efdf9c223001"
	validHash := strings.Repeat("a", 64)

	for _, testCase := range []struct {
		name       string
		headerKind string
		wantErr    bool
	}{
		{
			name:       "unknown rejected",
			headerKind: "unknown",
			wantErr:    true,
		},
		{
			name:       "empty string rejected",
			headerKind: "",
			wantErr:    true,
		},
		{
			name:       "invalid kind rejected",
			headerKind: "invalid_key",
			wantErr:    true,
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			_, err := service.ValidateSessionHeader(context.Background(), centralauthz.Capability{}, ValidateSessionHeader{
				ValidationEventID:      validUUID,
				TenantID:               "018f4b0d-08f8-7c09-9ba7-efdf9c223002",
				SessionID:              "018f4b0d-08f8-7c09-9ba7-efdf9c223003",
				HeaderKind:             testCase.headerKind,
				HeaderPresent:          true,
				PresentedHeaderHash:    validHash,
				RequestFingerprintHash: validHash,
			})
			if (err != nil) != testCase.wantErr {
				t.Fatalf("ValidateSessionHeader() error = %v, wantErr %t", err, testCase.wantErr)
			}
			var appErr *apperrors.Error
			if testCase.wantErr && errors.As(err, &appErr) && appErr.Code != apperrors.CodeInvalidArgument {
				t.Fatalf("expected CodeInvalidArgument, got %s", appErr.Code)
			}
		})
	}
}
