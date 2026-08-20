package authz

import (
	"context"
	"encoding/base64"
	"strings"
	"testing"
	"time"

	authzv1 "github.com/aethercode/aethercode/libs/proto/gen/go/aethercode/authz/v1"
	"google.golang.org/grpc"
)

type fakeAuthorizationRPC struct {
	response *authzv1.AuthorizeResponse
	request  *authzv1.AuthorizeRequest
	err      error
}

func (rpc *fakeAuthorizationRPC) Authorize(_ context.Context, request *authzv1.AuthorizeRequest, _ ...grpc.CallOption) (*authzv1.AuthorizeResponse, error) {
	rpc.request = request
	return rpc.response, rpc.err
}

func TestClientDecodesFreshAllowedCapability(t *testing.T) {
	t.Parallel()
	now := time.Now().UTC()
	keyring, err := ParseKeyring(`[{"audience":"aether_submission","key_id":"018f4b0d-08f8-7c09-9ba7-efdf9c223344","secret_base64":"` + base64.StdEncoding.EncodeToString([]byte(strings.Repeat("x", 32))) + `"}]`)
	if err != nil {
		t.Fatalf("ParseKeyring() error = %v", err)
	}
	decisionID := "018f4b0d-08f8-7c09-9ba7-efdf9c223377"
	capability, err := keyring.Issue("aether_submission", "018f4b0d-08f8-7c09-9ba7-efdf9c223355", "018f4b0d-08f8-7c09-9ba7-efdf9c223366", 9, decisionID, "submission.read", "submission.attempts", now)
	if err != nil {
		t.Fatalf("Issue() error = %v", err)
	}
	encoded, err := capability.Encode()
	if err != nil {
		t.Fatalf("Encode() error = %v", err)
	}
	rpc := &fakeAuthorizationRPC{response: &authzv1.AuthorizeResponse{
		Allowed:            true,
		DecisionId:         decisionID,
		AuthzRevision:      9,
		DatabaseCapability: encoded,
	}}
	client, err := NewClient(rpc)
	if err != nil {
		t.Fatalf("NewClient() error = %v", err)
	}
	decision, err := client.Authorize(context.Background(), CentralRequest{
		PrincipalID: "018f4b0d-08f8-7c09-9ba7-efdf9c223355", TenantID: "018f4b0d-08f8-7c09-9ba7-efdf9c223366",
		Action: "read", ResourceType: "attempts", ResourceID: "attempt-1", RequestID: decisionID, TargetService: "submission", IdentityAssertion: "signed-identity-assertion",
	})
	if err != nil {
		t.Fatalf("Authorize() error = %v", err)
	}
	if !decision.Allowed || decision.Capability.Action != "submission.read" || decision.Capability.CapabilityID != decision.DecisionID ||
		rpc.request.GetTargetService() != "submission" || rpc.request.GetIdentityAssertion() != "signed-identity-assertion" {
		t.Fatalf("Authorize() = %#v, request = %#v", decision, rpc.request)
	}
}

func TestClientFailsClosedWhenIdentityAssertionIsMissing(t *testing.T) {
	t.Parallel()
	rpc := &fakeAuthorizationRPC{}
	client, err := NewClient(rpc)
	if err != nil {
		t.Fatalf("NewClient() error = %v", err)
	}
	request := CentralRequest{PrincipalID: "018f4b0d-08f8-7c09-9ba7-efdf9c223355"}
	if _, err := client.Authorize(context.Background(), request); err == nil {
		t.Fatal("Authorize() accepted a request without an identity assertion")
	}
	if rpc.request != nil {
		t.Fatal("Authorize() called central Authz without an identity assertion")
	}
}

func TestClientRejectsCapabilityBoundToAnotherDecision(t *testing.T) {
	t.Parallel()
	now := time.Now().UTC()
	keyring, err := ParseKeyring(`[{
"audience":"aether_submission","key_id":"018f4b0d-08f8-7c09-9ba7-efdf9c223344","secret_base64":"` + base64.StdEncoding.EncodeToString([]byte(strings.Repeat("x", 32))) + `"}]`)
	if err != nil {
		t.Fatalf("ParseKeyring() error = %v", err)
	}
	capability, err := keyring.Issue(
		"aether_submission",
		"018f4b0d-08f8-7c09-9ba7-efdf9c223355",
		"018f4b0d-08f8-7c09-9ba7-efdf9c223366",
		9,
		"018f4b0d-08f8-7c09-9ba7-efdf9c223388",
		"submission.read",
		"submission.attempts",
		now,
	)
	if err != nil {
		t.Fatalf("Issue() error = %v", err)
	}
	encoded, err := capability.Encode()
	if err != nil {
		t.Fatalf("Encode() error = %v", err)
	}
	client, err := NewClient(&fakeAuthorizationRPC{response: &authzv1.AuthorizeResponse{
		Allowed:            true,
		DecisionId:         "018f4b0d-08f8-7c09-9ba7-efdf9c223377",
		AuthzRevision:      9,
		DatabaseCapability: encoded,
	}})
	if err != nil {
		t.Fatalf("NewClient() error = %v", err)
	}
	_, err = client.Authorize(context.Background(), CentralRequest{
		PrincipalID:       "018f4b0d-08f8-7c09-9ba7-efdf9c223355",
		TenantID:          "018f4b0d-08f8-7c09-9ba7-efdf9c223366",
		Action:            "read",
		ResourceType:      "attempts",
		ResourceID:        "attempt-1",
		RequestID:         "018f4b0d-08f8-7c09-9ba7-efdf9c223377",
		TargetService:     "submission",
		IdentityAssertion: "signed-identity-assertion",
	})
	if err == nil {
		t.Fatal("Authorize() accepted a capability for a different decision")
	}
}
