package authz

import (
	"errors"

	"google.golang.org/genproto/googleapis/rpc/errdetails"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const (
	// MFARequiredReason and MFAErrorDomain identify the gRPC status detail that marks a
	// PermissionDenied as "allowed by policy, needs a recent MFA step-up".
	MFARequiredReason = "MFA_REQUIRED"
	MFAErrorDomain    = "aethercode.authz"
)

// MFARequiredStatus returns a PermissionDenied gRPC error carrying the MFA detail.
func MFARequiredStatus(message string) error {
	denied := status.New(codes.PermissionDenied, message)
	withDetail, err := denied.WithDetails(&errdetails.ErrorInfo{Reason: MFARequiredReason, Domain: MFAErrorDomain})
	if err != nil {
		return denied.Err()
	}
	return withDetail.Err()
}

// IsMFARequired reports whether err, or an error it wraps, is a PermissionDenied with the MFA
// detail. It matches the structured detail, never the message text.
func IsMFARequired(err error) bool {
	for current := err; current != nil; current = errors.Unwrap(current) {
		grpcStatus, ok := status.FromError(current)
		if !ok || grpcStatus.Code() != codes.PermissionDenied {
			continue
		}
		for _, detail := range grpcStatus.Details() {
			if info, ok := detail.(*errdetails.ErrorInfo); ok && info.GetReason() == MFARequiredReason && info.GetDomain() == MFAErrorDomain {
				return true
			}
		}
	}
	return false
}
