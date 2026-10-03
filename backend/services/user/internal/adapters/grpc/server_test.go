package grpc

import (
	"context"
	"encoding/base64"
	"strings"
	"testing"

	centralauthz "github.com/aethercode/aethercode/libs/pkg/authz"
	authzv1 "github.com/aethercode/aethercode/libs/proto/gen/go/aethercode/authz/v1"
	"github.com/aethercode/aethercode/services/user/internal/app"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const (
	serverTestPrincipal = "018f4b0d-08f8-7c09-9ba7-efdf9c223355"
	serverTestTenant    = "018f4b0d-08f8-7c09-9ba7-efdf9c223366"
	serverTestRequestID = "018f4b0d-08f8-7c09-9ba7-efdf9c223377"
)

func TestAuthorizeRejectsCallerTargetMismatchBeforePolicyEvaluation(t *testing.T) {
	t.Parallel()
	server := NewServer(nil, true)
	contextValue := context.WithValue(context.Background(), callerIdentityContextKey{}, CallerIdentity{
		SPIFFEID:      submissionSPIFFEID,
		TargetService: "submission",
	})

	_, err := server.Authorize(contextValue, &authzv1.AuthorizeRequest{TargetService: "assessment"})
	if status.Code(err) != codes.PermissionDenied {
		t.Fatalf("Authorize() code = %s, want %s", status.Code(err), codes.PermissionDenied)
	}
}

func TestAuthorizeRequiresVerifiedCallerContext(t *testing.T) {
	t.Parallel()
	server := NewServer(nil, true)
	_, err := server.Authorize(context.Background(), &authzv1.AuthorizeRequest{TargetService: "submission"})
	if status.Code(err) != codes.Unauthenticated {
		t.Fatalf("Authorize() code = %s, want %s", status.Code(err), codes.Unauthenticated)
	}
}

func TestAuthorizeForwardsIdentityAssertionToApplication(t *testing.T) {
	t.Parallel()
	identityVerifier := &recordingIdentityVerifier{}
	service, err := app.NewService(emptySnapshotStore{}, serverTestKeyring(t), identityVerifier, true)
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	server := NewServer(service, true)
	contextValue := context.WithValue(context.Background(), callerIdentityContextKey{}, CallerIdentity{
		SPIFFEID:      submissionSPIFFEID,
		TargetService: "submission",
	})
	request := &authzv1.AuthorizeRequest{
		PrincipalId:       serverTestPrincipal,
		Action:            "read",
		ResourceType:      "attempts",
		ResourceId:        "attempt-1",
		TenantId:          serverTestTenant,
		RequestId:         serverTestRequestID,
		TargetService:     "submission",
		IdentityAssertion: "verified-identity-assertion",
	}

	response, err := server.Authorize(contextValue, request)
	if err != nil {
		t.Fatalf("Authorize() error = %v", err)
	}
	if response.GetAllowed() {
		t.Fatal("Authorize() allowed a request without a policy")
	}
	if identityVerifier.assertion != request.GetIdentityAssertion() {
		t.Fatalf("identity assertion = %q, want %q", identityVerifier.assertion, request.GetIdentityAssertion())
	}
}

type emptySnapshotStore struct{}

func (emptySnapshotStore) Snapshot(context.Context, app.SnapshotQuery) (app.Snapshot, error) {
	return app.Snapshot{Revision: 1}, nil
}

func (emptySnapshotStore) Ping(context.Context) error { return nil }

type recordingIdentityVerifier struct {
	assertion string
}

func (verifier *recordingIdentityVerifier) Verify(_ context.Context, assertion string) (app.VerifiedIdentity, error) {
	verifier.assertion = assertion
	return app.VerifiedIdentity{PrincipalID: serverTestPrincipal}, nil
}

func serverTestKeyring(t *testing.T) *centralauthz.Keyring {
	t.Helper()
	keyring, err := centralauthz.ParseKeyring(`[{
"audience":"aether_submission","key_id":"018f4b0d-08f8-7c09-9ba7-efdf9c223388","secret_base64":"` + base64.StdEncoding.EncodeToString([]byte(strings.Repeat("k", 32))) + `"}]`)
	if err != nil {
		t.Fatalf("ParseKeyring() error = %v", err)
	}
	return keyring
}
