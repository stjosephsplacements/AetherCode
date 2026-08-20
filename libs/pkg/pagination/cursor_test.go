package pagination

import (
	"strings"
	"testing"
	"time"
)

const testID = "018f4b0d-08f8-7c09-9ba7-efdf9c223377"

func TestEncodeParseRoundTrip(t *testing.T) {
	t.Parallel()
	moment := time.Date(2026, time.August, 20, 10, 11, 12, 123456789, time.UTC)
	encoded := Encode(EncodeTime(moment), testID)
	if strings.ContainsAny(encoded, "+/=") {
		t.Fatalf("Encode() = %q, want unpadded base64url", encoded)
	}
	cursor, present, err := Parse(encoded)
	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}
	if !present {
		t.Fatal("Parse() present = false, want true")
	}
	if cursor.ID != testID {
		t.Fatalf("Parse() ID = %q, want %q", cursor.ID, testID)
	}
	if cursor.SortValue != EncodeTime(moment) {
		t.Fatalf("Parse() SortValue = %q, want %q", cursor.SortValue, EncodeTime(moment))
	}
}

func TestParseEmptyIsAbsentNotError(t *testing.T) {
	t.Parallel()
	cursor, present, err := Parse("")
	if err != nil {
		t.Fatalf("Parse(\"\") error = %v, want nil", err)
	}
	if present {
		t.Fatal("Parse(\"\") present = true, want false")
	}
	if cursor != (Cursor{}) {
		t.Fatalf("Parse(\"\") cursor = %+v, want zero value", cursor)
	}
}

func TestParseRejectsMalformedCursors(t *testing.T) {
	t.Parallel()
	testCases := []struct {
		name string
		raw  string
	}{
		{name: "not base64", raw: "!!!not-base64!!!"},
		{name: "missing separator", raw: Encode("", "")},
		{name: "too many segments", raw: encodeRaw("a|b|c")},
		{name: "empty sort value", raw: encodeRaw("|" + testID)},
		{name: "non-uuid id", raw: encodeRaw("2026-08-20T10:11:12Z|not-a-uuid")},
		{name: "empty id", raw: encodeRaw("2026-08-20T10:11:12Z|")},
	}
	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			if _, _, err := Parse(testCase.raw); err == nil {
				t.Fatalf("Parse(%q) error = nil, want an error", testCase.raw)
			}
		})
	}
}

func TestParseLimitBounds(t *testing.T) {
	t.Parallel()
	testCases := []struct {
		name      string
		raw       string
		want      int
		wantError bool
	}{
		{name: "empty uses default", raw: "", want: 20},
		{name: "valid", raw: "50", want: 50},
		{name: "minimum", raw: "1", want: 1},
		{name: "maximum", raw: "100", want: 100},
		{name: "zero rejected", raw: "0", wantError: true},
		{name: "negative rejected", raw: "-1", wantError: true},
		{name: "above maximum rejected", raw: "101", wantError: true},
		{name: "non-numeric rejected", raw: "twenty", wantError: true},
	}
	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			got, err := ParseLimit(testCase.raw, 20, 100)
			if testCase.wantError {
				if err == nil {
					t.Fatalf("ParseLimit(%q) error = nil, want an error", testCase.raw)
				}
				return
			}
			if err != nil {
				t.Fatalf("ParseLimit(%q) error = %v", testCase.raw, err)
			}
			if got != testCase.want {
				t.Fatalf("ParseLimit(%q) = %d, want %d", testCase.raw, got, testCase.want)
			}
		})
	}
}

func TestFormatIntIsDecimal(t *testing.T) {
	t.Parallel()
	if got := FormatInt(42); got != "42" {
		t.Fatalf("FormatInt(42) = %q, want \"42\"", got)
	}
}
