package authz

import (
	"context"
	"fmt"
	"strings"
	"time"

	authzv1 "github.com/aethercode/aethercode/libs/proto/gen/go/aethercode/authz/v1"
	"google.golang.org/grpc"
)

// CentralRequest is the authenticated identity and target operation sent over
// mTLS to the canonical User authorization service. Callers construct it for
// every protected request; this package deliberately provides no positive cache.
type CentralRequest struct {
	PrincipalID       string
	Action            string
	ResourceType      string
	ResourceID        string
	TenantID          string
	RequestID         string
	TargetService     string
	IdentityAssertion string
}

// CentralDecision is the fresh central decision and its local-RLS capability.
type CentralDecision struct {
	Allowed       bool
	DecisionID    string
	AuthzRevision int64
	Scopes        []Scope
	Capability    Capability
}

// Scope is an applicable authorization scope returned by the User service.
type Scope struct {
	Kind string
	ID   string
}

// AuthorizationRPC is satisfied by the generated AuthorizationService client.
// It keeps calling-service tests independent from a live gRPC connection.
type AuthorizationRPC interface {
	Authorize(context.Context, *authzv1.AuthorizeRequest, ...grpc.CallOption) (*authzv1.AuthorizeResponse, error)
}

// Client calls the canonical User authorization service. It must be backed by
// an mTLS-authenticated gRPC connection created by the calling service.
type Client struct {
	client AuthorizationRPC
}

func NewClient(client AuthorizationRPC) (*Client, error) {
	if client == nil {
		return nil, fmt.Errorf("central authorization gRPC client is required")
	}
	return &Client{client: client}, nil
}

// Authorize obtains a fresh decision and decodes the opaque five-second
// capability. RPC, deny, malformed, or expired results are errors so the
// caller fails closed before opening its local tenant transaction.
func (client *Client) Authorize(contextValue context.Context, request CentralRequest) (CentralDecision, error) {
	if client == nil || client.client == nil {
		return CentralDecision{}, fmt.Errorf("central authorization client is not initialized")
	}
	identityAssertion := strings.TrimSpace(request.IdentityAssertion)
	if identityAssertion == "" {
		return CentralDecision{}, fmt.Errorf("identity assertion is required for a central authorization decision")
	}
	response, err := client.client.Authorize(contextValue, &authzv1.AuthorizeRequest{
		PrincipalId:       request.PrincipalID,
		Action:            request.Action,
		ResourceType:      request.ResourceType,
		ResourceId:        request.ResourceID,
		TenantId:          request.TenantID,
		RequestId:         request.RequestID,
		TargetService:     request.TargetService,
		IdentityAssertion: identityAssertion,
	})
	if err != nil {
		return CentralDecision{}, fmt.Errorf("request central authorization decision: %w", err)
	}
	if response == nil {
		return CentralDecision{}, fmt.Errorf("central authorization service returned an empty response")
	}
	decisionID := strings.ToLower(strings.TrimSpace(response.GetDecisionId()))
	decision := CentralDecision{
		Allowed:       response.GetAllowed(),
		DecisionID:    decisionID,
		AuthzRevision: int64(response.GetAuthzRevision()),
	}
	for _, scope := range response.GetScopes() {
		if scope != nil {
			decision.Scopes = append(decision.Scopes, Scope{Kind: scope.GetKind(), ID: scope.GetId()})
		}
	}
	if !decision.Allowed {
		return CentralDecision{}, fmt.Errorf("central authorization denied request %s", strings.TrimSpace(request.RequestID))
	}
	if decision.AuthzRevision <= 0 {
		return CentralDecision{}, fmt.Errorf("central authorization returned a non-positive revision")
	}
	capability, err := DecodeCapability(response.GetDatabaseCapability(), time.Now())
	if err != nil {
		return CentralDecision{}, fmt.Errorf("decode central authorization capability: %w", err)
	}
	if capability.CapabilityID != decisionID ||
		capability.ActorID != strings.ToLower(strings.TrimSpace(request.PrincipalID)) ||
		capability.TenantID != strings.ToLower(strings.TrimSpace(request.TenantID)) ||
		capability.Action == "" || capability.Resource == "" ||
		capability.AuthzRevision != decision.AuthzRevision {
		return CentralDecision{}, fmt.Errorf("central authorization capability does not match its decision")
	}
	decision.Capability = capability
	return decision, nil
}
