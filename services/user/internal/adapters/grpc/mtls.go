package grpc

import (
	"context"
	"crypto/tls"
	"strings"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/peer"
	"google.golang.org/grpc/status"
)

type callerIdentityContextKey struct{}

// CallerIdentity is the verified workload identity that is allowed to ask for
// a decision for TargetService. It is derived exclusively from a URI SAN on a
// certificate chain verified by the configured client CA.
type CallerIdentity struct {
	SPIFFEID      string
	TargetService string
}

// RequireCallerTargetSPIFFEIDs rejects every gRPC call unless a verified TLS
// 1.3 client certificate contains an exact configured SPIFFE URI SAN. The map
// binds each caller workload identity to exactly one target service, preventing
// a service from requesting a signed capability for another service database.
func RequireCallerTargetSPIFFEIDs(trustedServiceTargets map[string]string) grpc.UnaryServerInterceptor {
	trusted := make(map[string]string, len(trustedServiceTargets))
	for spiffeID, targetService := range trustedServiceTargets {
		spiffeID = strings.TrimSpace(spiffeID)
		targetService = strings.ToLower(strings.TrimSpace(targetService))
		if spiffeID != "" && targetService != "" {
			trusted[spiffeID] = targetService
		}
	}

	return func(
		contextValue context.Context,
		request any,
		info *grpc.UnaryServerInfo,
		handler grpc.UnaryHandler,
	) (any, error) {
		identity, found := trustedCallerIdentity(contextValue, trusted)
		if !found {
			return nil, status.Error(codes.Unauthenticated, "verified authorized SPIFFE workload identity is required")
		}
		return handler(context.WithValue(contextValue, callerIdentityContextKey{}, identity), request)
	}
}

// CallerIdentityFromContext returns the identity placed by
// RequireCallerTargetSPIFFEIDs. Server methods use it to bind the request's
// target_service to the verified caller rather than trusting caller input.
func CallerIdentityFromContext(contextValue context.Context) (CallerIdentity, bool) {
	identity, found := contextValue.Value(callerIdentityContextKey{}).(CallerIdentity)
	return identity, found
}

func trustedCallerIdentity(contextValue context.Context, trusted map[string]string) (CallerIdentity, bool) {
	if len(trusted) == 0 {
		return CallerIdentity{}, false
	}
	peerInfo, found := peer.FromContext(contextValue)
	if !found {
		return CallerIdentity{}, false
	}
	tlsInfo, valid := peerInfo.AuthInfo.(credentials.TLSInfo)
	if !valid || tlsInfo.State.Version < tls.VersionTLS13 || len(tlsInfo.State.VerifiedChains) == 0 || len(tlsInfo.State.VerifiedChains[0]) == 0 {
		return CallerIdentity{}, false
	}
	leaf := tlsInfo.State.VerifiedChains[0][0]
	if leaf == nil {
		return CallerIdentity{}, false
	}

	var identity CallerIdentity
	for _, uri := range leaf.URIs {
		if uri == nil {
			continue
		}
		targetService, authorized := trusted[uri.String()]
		if !authorized {
			continue
		}
		candidate := CallerIdentity{SPIFFEID: uri.String(), TargetService: targetService}
		if identity.TargetService != "" && identity != candidate {
			return CallerIdentity{}, false
		}
		identity = candidate
	}
	if identity.TargetService == "" {
		return CallerIdentity{}, false
	}
	return identity, true
}
