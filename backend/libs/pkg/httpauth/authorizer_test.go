package httpauth

import (
	"fmt"
	"testing"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestNewRejectsMissingDependencies(t *testing.T) {
	t.Parallel()
	if _, err := New(nil, "tenant"); err == nil {
		t.Fatal("New() accepted a nil central client")
	}
}

func TestIsMFARequiredGRPCError(t *testing.T) {
	t.Parallel()
	mfaErr := status.Error(codes.PermissionDenied, "this operation requires recent MFA verification")
	otherPermDenied := status.Error(codes.PermissionDenied, "caller is not authorized for the requested target service")
	unavailable := status.Error(codes.Unavailable, "this operation requires recent MFA verification")

	if !isMFARequiredGRPCError(mfaErr) {
		t.Error("expected true for direct MFA gRPC error")
	}
	if !isMFARequiredGRPCError(fmt.Errorf("request central authorization decision: %w", mfaErr)) {
		t.Error("expected true for wrapped MFA gRPC error")
	}
	if isMFARequiredGRPCError(otherPermDenied) {
		t.Error("expected false for non-MFA PermissionDenied error")
	}
	if isMFARequiredGRPCError(unavailable) {
		t.Error("expected false for Unavailable with MFA message")
	}
	if isMFARequiredGRPCError(nil) {
		t.Error("expected false for nil error")
	}
}
