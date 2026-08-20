// Package pagination encodes and validates the opaque keyset cursors used by
// every AetherCode collection endpoint. A cursor carries no authority: it is
// applied only inside an already-authorized, tenant- and actor-scoped query, so
// it is deliberately unsigned. Signing it would imply it grants access.
package pagination

import (
	"encoding/base64"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
)

const separator = "|"

var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// Cursor is one decoded keyset position: the value of the sort column and the
// primary key that breaks ties on equal sort values.
type Cursor struct {
	SortValue string
	ID        string
}

// Encode builds the opaque token handed back to clients as next_cursor.
func Encode(sortValue, id string) string {
	return encodeRaw(sortValue + separator + id)
}

func encodeRaw(payload string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(payload))
}

// Parse decodes a client-supplied cursor. An empty string means "first page"
// and is not an error. Anything else that does not decode to exactly one
// non-empty sort value and one UUID is rejected rather than ignored, so a
// corrupted token cannot silently restart pagination from the beginning.
func Parse(raw string) (Cursor, bool, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return Cursor{}, false, nil
	}
	decoded, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return Cursor{}, false, apperrors.New(apperrors.CodeInvalidArgument, "cursor is not a valid pagination token")
	}
	parts := strings.Split(string(decoded), separator)
	if len(parts) != 2 {
		return Cursor{}, false, apperrors.New(apperrors.CodeInvalidArgument, "cursor is not a valid pagination token")
	}
	sortValue, id := parts[0], parts[1]
	if strings.TrimSpace(sortValue) == "" || !uuidPattern.MatchString(id) {
		return Cursor{}, false, apperrors.New(apperrors.CodeInvalidArgument, "cursor is not a valid pagination token")
	}
	return Cursor{SortValue: sortValue, ID: strings.ToLower(id)}, true, nil
}

// ParseLimit validates a client page size. An out-of-range limit is an error
// rather than a silent clamp, matching the existing Question Bank behaviour.
func ParseLimit(raw string, defaultLimit, maxLimit int) (int, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return defaultLimit, nil
	}
	limit, err := strconv.Atoi(raw)
	if err != nil || limit < 1 || limit > maxLimit {
		return 0, apperrors.New(apperrors.CodeInvalidArgument, fmt.Sprintf("limit must be an integer between 1 and %d", maxLimit))
	}
	return limit, nil
}

// EncodeTime renders a timestamp sort value. Nanosecond precision matters:
// two rows created in the same millisecond must produce different cursors.
func EncodeTime(value time.Time) string {
	return value.UTC().Format(time.RFC3339Nano)
}

// FormatInt renders an integer sort value such as a version number.
func FormatInt(value int64) string {
	return strconv.FormatInt(value, 10)
}
