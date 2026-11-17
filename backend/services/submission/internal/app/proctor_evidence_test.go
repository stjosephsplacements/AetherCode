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
	if _, err := service.GetProctorEvidence(context.Background(), centralauthz.Capability{}, "x", id); err == nil {
		t.Fatal("expected an invalid-argument error")
	}
	_, err := service.GetProctorEvidence(context.Background(), centralauthz.Capability{}, id, id)
	var appErr *apperrors.Error
	if !errors.As(err, &appErr) || appErr.Code != apperrors.CodeUnavailable {
		t.Fatalf("error = %v, want unavailable without a reader", err)
	}
}
