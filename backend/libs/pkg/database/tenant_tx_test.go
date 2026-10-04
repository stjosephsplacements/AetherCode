package database

import (
	"errors"
	"testing"

	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
	"github.com/jackc/pgx/v5/pgconn"
)

func TestContextErrorReportsOnlyProjectionLagAsRetryable(t *testing.T) {
	t.Parallel()
	for name, scenario := range map[string]struct {
		err           error
		wantRetryable bool
	}{
		"projection lag":    {&pgconn.PgError{Code: "28000", Message: projectionLagMessage}, true},
		"invalid signature": {&pgconn.PgError{Code: "28000", Message: "invalid signed authorization context"}, false},
		"replayed":          {&pgconn.PgError{Code: "28000", Message: "authorization capability has already been consumed"}, false},
		"other failure":     {errors.New("connection reset"), false},
	} {
		var domainError *apperrors.Error
		retryable := errors.As(contextError(scenario.err), &domainError) && domainError.Code == apperrors.CodeUnavailable
		if retryable != scenario.wantRetryable {
			t.Fatalf("%s: retryable = %v, want %v", name, retryable, scenario.wantRetryable)
		}
	}
}
