package projection

import (
	"errors"
	"testing"

	"github.com/aethercode/aethercode/libs/pkg/messaging"
	"github.com/jackc/pgx/v5/pgconn"
)

func TestMapAuthorizationResyncRequestErrorKeepsOnlyRateLimitRetryable(t *testing.T) {
	rateLimited := mapAuthorizationResyncRequestError(&pgconn.PgError{
		Code: "P0001", Message: "authorization resync request rate limited",
	})
	var permanent messaging.PermanentError
	if errors.As(rateLimited, &permanent) {
		t.Fatalf("rate limit must remain retryable: %v", rateLimited)
	}

	invalid := mapAuthorizationResyncRequestError(&pgconn.PgError{Code: "22023", Message: "invalid"})
	if !errors.As(invalid, &permanent) {
		t.Fatalf("invalid request must be permanent: %v", invalid)
	}

	overCapacity := mapAuthorizationResyncRequestError(&pgconn.PgError{
		Code: "P0001", Message: "authorization resync batch exceeds the 100000-principal safety limit",
	})
	if !errors.As(overCapacity, &permanent) {
		t.Fatalf("capacity rejection must be permanent: %v", overCapacity)
	}
}
