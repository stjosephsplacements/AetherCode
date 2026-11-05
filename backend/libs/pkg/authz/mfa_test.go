package authz

import (
	"fmt"
	"testing"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestIsMFARequired(t *testing.T) {
	mfa := MFARequiredStatus("reworded message")
	if !IsMFARequired(mfa) || !IsMFARequired(fmt.Errorf("central decision: %w", mfa)) {
		t.Fatal("the structured detail must match, direct or wrapped, whatever the message says")
	}
	if IsMFARequired(status.Error(codes.PermissionDenied, "this operation requires recent MFA verification")) {
		t.Fatal("matching on message text alone must not count")
	}
	if IsMFARequired(nil) || IsMFARequired(status.Error(codes.Unavailable, "x")) {
		t.Fatal("nil and other codes must not match")
	}
}
