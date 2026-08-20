// Package grpc exposes the canonical internal authorization contract.
package grpc

import (
	"context"
	"errors"
	"fmt"

	authzv1 "github.com/aethercode/aethercode/libs/proto/gen/go/aethercode/authz/v1"
	"github.com/aethercode/aethercode/services/user/internal/app"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// Server implements AuthorizationService over the private mTLS network.
type Server struct {
	authzv1.UnimplementedAuthorizationServiceServer
	service               *app.Service
	requireCallerIdentity bool
}

func NewServer(service *app.Service, requireCallerIdentity bool) *Server {
	return &Server{service: service, requireCallerIdentity: requireCallerIdentity}
}

func (server *Server) Authorize(contextValue context.Context, request *authzv1.AuthorizeRequest) (*authzv1.AuthorizeResponse, error) {
	if request == nil {
		return nil, status.Error(codes.InvalidArgument, "authorization request is required")
	}
	targetService := request.GetTargetService()
	if server.requireCallerIdentity {
		caller, trusted := CallerIdentityFromContext(contextValue)
		if !trusted {
			return nil, status.Error(codes.Unauthenticated, "verified authorization caller identity is required")
		}
		if targetService != caller.TargetService {
			return nil, status.Error(codes.PermissionDenied, "caller is not authorized for the requested target service")
		}
		targetService = caller.TargetService
	}
	decision, err := server.service.Authorize(contextValue, app.Request{
		PrincipalID:       request.GetPrincipalId(),
		Action:            request.GetAction(),
		ResourceType:      request.GetResourceType(),
		ResourceID:        request.GetResourceId(),
		TenantID:          request.GetTenantId(),
		RequestID:         request.GetRequestId(),
		TargetService:     targetService,
		IdentityAssertion: request.GetIdentityAssertion(),
	})
	if err != nil {
		var validationError *app.ValidationError
		var authenticationError app.AuthenticationError
		if errors.As(err, &validationError) {
			return nil, status.Error(codes.InvalidArgument, validationError.Error())
		}
		if errors.As(err, &authenticationError) {
			return nil, status.Error(codes.Unauthenticated, authenticationError.Error())
		}
		return nil, status.Error(codes.Unavailable, fmt.Sprintf("authorization decision unavailable: %v", err))
	}
	response := &authzv1.AuthorizeResponse{
		Allowed:       decision.Allowed,
		DecisionId:    decision.DecisionID,
		AuthzRevision: uint64(decision.AuthzRevision),
	}
	if decision.Allowed {
		response.DatabaseCapability = decision.Capability
		response.DatabaseCapabilityExpiresAt = decision.ExpiresAt.UTC().Format("2006-01-02T15:04:05.000000Z")
	}
	for _, scope := range decision.Scopes {
		response.Scopes = append(response.Scopes, &authzv1.Scope{Kind: scope.Kind, Id: scope.ID})
	}
	return response, nil
}
