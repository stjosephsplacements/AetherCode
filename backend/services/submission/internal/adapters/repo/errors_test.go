package repo

import (
	"errors"
	"fmt"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"

	apperrors "github.com/stjosephsplacements/AetherCode/libs/pkg/errors"
)

// The database functions raise P0002 (no_data_found) for a row that does not exist; that must reach the
// caller as "not found", never as an internal error.
func TestMapDatabaseErrorNoDataFoundIsNotFound(t *testing.T) {
	t.Parallel()
	err := mapDatabaseError(fmt.Errorf("wrapped: %w", &pgconn.PgError{Code: "P0002", Message: "attempt was not found"}), "list answer revisions")
	var application *apperrors.Error
	if !errors.As(err, &application) || application.Code != apperrors.CodeNotFound {
		t.Fatalf("mapDatabaseError(P0002) = %v, want a not-found application error", err)
	}
}
