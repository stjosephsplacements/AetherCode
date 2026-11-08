package app

import (
	"strings"
	"testing"
)

func TestNormalizeCategoryNameEdgeCases(t *testing.T) {
	t.Parallel()
	for _, testCase := range []struct {
		name    string
		input   string
		want    string
		wantErr bool
	}{
		// exactly 80 runes — the boundary the existing test does not check
		{name: "exactly 80 runes", input: strings.Repeat("a", 80), want: strings.Repeat("a", 80)},
		// non-NUL control character — existing test only covers NUL
		{name: "control character SOH", input: "bad\x01name", wantErr: true},
		// unicode name — length counted in runes, not bytes
		{name: "unicode name", input: "Αλγόριθμοι", want: "Αλγόριθμοι"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			got, err := NormalizeCategoryName(testCase.input)
			if (err != nil) != testCase.wantErr {
				t.Fatalf("NormalizeCategoryName(%q) error = %v, wantErr = %t", testCase.input, err, testCase.wantErr)
			}
			if !testCase.wantErr && got != testCase.want {
				t.Fatalf("NormalizeCategoryName(%q) = %q, want %q", testCase.input, got, testCase.want)
			}
		})
	}
}
