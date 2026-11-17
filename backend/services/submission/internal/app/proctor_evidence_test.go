package app

import (
	"context"
	"errors"
	"testing"

	centralauthz "github.com/stjosephsplacements/AetherCode/libs/pkg/authz"
	apperrors "github.com/stjosephsplacements/AetherCode/libs/pkg/errors"
)

func TestGetProctorEvidenceRejectsBadInputAndMissingReader(t *testing.T) {
	service := &Service{}
	const id = "0190a0a0-0000-7000-8000-000000000001"
	var appErr *apperrors.Error
	_, err := service.GetProctorEvidence(context.Background(), centralauthz.Capability{}, "x", id)
	if !errors.As(err, &appErr) || appErr.Code != apperrors.CodeInvalidArgument {
		t.Fatalf("error = %v, want invalid argument for a malformed tenant ID", err)
	}
	_, err = service.GetProctorEvidence(context.Background(), centralauthz.Capability{}, id, id)
	if !errors.As(err, &appErr) || appErr.Code != apperrors.CodeUnavailable {
		t.Fatalf("error = %v, want unavailable without a reader", err)
	}
}
