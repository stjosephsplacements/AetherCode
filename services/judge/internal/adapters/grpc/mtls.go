package grpcadapter

import (
	"context"
	"crypto/tls"
	"fmt"
	"slices"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/peer"
	"google.golang.org/grpc/status"
)

// RequireClientSubjects returns an interceptor that narrows a trusted client
// CA to the explicitly authorized platform adapter identities.
func RequireClientSubjects(allowedSubjects []string) grpc.UnaryServerInterceptor {
	return func(
		contextValue context.Context,
		request any,
		info *grpc.UnaryServerInfo,
		handler grpc.UnaryHandler,
	) (any, error) {
		if err := validateClientSubject(contextValue, allowedSubjects); err != nil {
			return nil, err
		}
		return handler(contextValue, request)
	}
}

func validateClientSubject(contextValue context.Context, allowedSubjects []string) error {
	peerValue, ok := peer.FromContext(contextValue)
	if !ok {
		return status.Error(codes.Unauthenticated, "mTLS client certificate is required")
	}
	tlsInfo, ok := peerValue.AuthInfo.(credentials.TLSInfo)
	if !ok || tlsInfo.State.Version < tls.VersionTLS13 || len(tlsInfo.State.VerifiedChains) == 0 || len(tlsInfo.State.PeerCertificates) == 0 {
		return status.Error(codes.Unauthenticated, "verified TLS 1.3 client certificate is required")
	}
	subject := tlsInfo.State.PeerCertificates[0].Subject.CommonName
	if !slices.Contains(allowedSubjects, subject) {
		return status.Error(codes.PermissionDenied, fmt.Sprintf("client subject %q is not authorized for Judge", subject))
	}
	return nil
}
