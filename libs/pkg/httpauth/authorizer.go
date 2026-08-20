// Package httpauth bridges HTTP identity assertions to a fresh central
// authorization decision and a one-transaction local RLS capability.
package httpauth

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"github.com/aethercode/aethercode/libs/pkg/authn"
	centralauthz "github.com/aethercode/aethercode/libs/pkg/authz"
	"github.com/aethercode/aethercode/libs/pkg/database"
	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
	"github.com/aethercode/aethercode/libs/pkg/httpx"
)

// Authorizer has no positive cache. It is safe to reuse across requests only
// because each Authorize call reaches the central decision service afresh.
type Authorizer struct {
	client        *centralauthz.Client
	targetService string
}

// New validates the fixed database-service target used in every call.
func New(client *centralauthz.Client, targetService string) (*Authorizer, error) {
	if client == nil || strings.TrimSpace(targetService) == "" {
		return nil, fmt.Errorf("central authorization client and target service are required")
	}
	return &Authorizer{client: client, targetService: strings.TrimSpace(targetService)}, nil
}

// Decision is the verified request identity plus the one-use database
// capability. The identity assertion itself is still verified centrally; its
// unverified subject extraction is only routing input for that verifier.
type Decision struct {
	PrincipalID string
	RequestID   string
	Capability  centralauthz.Capability
}

// AuthorizeHTTP extracts a bearer assertion, obtains a fresh central decision,
// and returns the signed capability. It intentionally does not open a database
// transaction yet because an expired/replayed capability must never be reused.
func (authorizer *Authorizer) AuthorizeHTTP(
	contextValue context.Context,
	request *http.Request,
	action, resourceType, resourceID, tenantID string,
) (Decision, error) {
	principalID, err := principalFromRequest(request)
	if err != nil {
		return Decision{}, err
	}
	return authorizer.authorize(contextValue, request, principalID, action, resourceType, resourceID, tenantID)
}

// AuthorizeSelfHTTP uses the bearer subject as the protected resource ID. It
// is appropriate only for routes whose database procedure also binds the
// signed context actor to the affected record.
func (authorizer *Authorizer) AuthorizeSelfHTTP(
	contextValue context.Context,
	request *http.Request,
	action, resourceType, tenantID string,
) (Decision, error) {
	principalID, err := principalFromRequest(request)
	if err != nil {
		return Decision{}, err
	}
	return authorizer.authorize(contextValue, request, principalID, action, resourceType, principalID, tenantID)
}

func (authorizer *Authorizer) authorize(
	contextValue context.Context,
	request *http.Request,
	principalID, action, resourceType, resourceID, tenantID string,
) (Decision, error) {
	if authorizer == nil || authorizer.client == nil {
		return Decision{}, fmt.Errorf("HTTP authorizer is not initialized")
	}
	assertion, err := httpx.BearerToken(request)
	if err != nil {
		return Decision{}, err
	}
	requestID, err := database.NewUUIDv7()
	if err != nil {
		return Decision{}, err
	}
	centralDecision, err := authorizer.client.Authorize(contextValue, centralauthz.CentralRequest{
		PrincipalID: principalID, Action: action, ResourceType: resourceType, ResourceID: resourceID,
		TenantID: tenantID, RequestID: requestID, TargetService: authorizer.targetService,
		IdentityAssertion: assertion,
	})
	if err != nil {
		return Decision{}, apperrors.New(apperrors.CodeForbidden, "authorization denied")
	}
	return Decision{PrincipalID: principalID, RequestID: requestID, Capability: centralDecision.Capability}, nil
}

func principalFromRequest(request *http.Request) (string, error) {
	assertion, err := httpx.BearerToken(request)
	if err != nil {
		return "", err
	}
	principalID, err := authn.UnverifiedSubject(assertion)
	if err != nil {
		return "", apperrors.New(apperrors.CodeUnauthorized, "access token is invalid")
	}
	return principalID, nil
}
