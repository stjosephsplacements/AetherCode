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

// timestampLayout is a fixed-width RFC3339 nanosecond layout. time.RFC3339Nano
// trims trailing zero fractional digits, which breaks string ordering: a
// zero-nanosecond instant ("...12Z") would sort after a later instant with a
// nonzero fraction ("...12.5Z") because '.' (0x2E) sorts before 'Z' (0x5A).
// Values produced by this layout still parse with time.RFC3339Nano.
const timestampLayout = "2006-01-02T15:04:05.000000000Z07:00"

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
	// Split on the LAST separator, not the first: a UUID can never contain
	// the separator, but sortValue is caller-supplied and may. Splitting on
	// the first occurrence would misread a sort value like "a|b" as sortValue
	// "a" and id "b|<uuid>", which then fails UUID validation.
	payload := string(decoded)
	lastIndex := strings.LastIndex(payload, separator)
	if lastIndex < 0 {
		return Cursor{}, false, apperrors.New(apperrors.CodeInvalidArgument, "cursor is not a valid pagination token")
	}
	sortValue, id := payload[:lastIndex], payload[lastIndex+len(separator):]
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
// two rows created in the same millisecond must produce different cursors. A
// fixed-width layout is used so that string comparison of two encoded values
// agrees with chronological order regardless of trailing zero digits.
func EncodeTime(value time.Time) string {
	return value.UTC().Format(timestampLayout)
}

// FormatInt renders an integer sort value such as a version number.
func FormatInt(value int64) string {
	return strconv.FormatInt(value, 10)
}
