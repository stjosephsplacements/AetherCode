package talentcard

import (
	"encoding/base64"
	"errors"
	"strings"
	"testing"
)

func testSigner(t *testing.T, fill byte) *Signer {
	t.Helper()
	signer, err := NewSigner(base64.StdEncoding.EncodeToString([]byte(strings.Repeat(string([]byte{fill}), 32))))
	if err != nil {
		t.Fatal(err)
	}
	return signer
}

func TestSignAndVerifyRoundTrip(t *testing.T) {
	t.Parallel()
	signer := testSigner(t, 'a')
	top, speed := 12, 80
	token, err := signer.Sign(Claims{CardID: "c1", IssuedAt: 1, ExpiresAt: 2, Name: "A", ExamCount: 3, TopPercent: &top, SpeedIndex: &speed})
	if err != nil {
		t.Fatal(err)
	}
	claims, err := signer.Verify(token)
	if err != nil || claims.CardID != "c1" || *claims.TopPercent != 12 || claims.KeyID != signer.KeyID() {
		t.Fatalf("Verify() = %+v, %v", claims, err)
	}
}

func TestVerifyRejectsTamperingAndOtherKeys(t *testing.T) {
	t.Parallel()
	signer := testSigner(t, 'a')
	token, _ := signer.Sign(Claims{CardID: "c1", Name: "A"})
	parts := strings.Split(token, ".")
	forged := base64.RawURLEncoding.EncodeToString([]byte(`{"kid":"` + signer.KeyID() + `","card_id":"c1","name":"B"}`))
	for name, candidate := range map[string]string{
		"edited claims":   parts[0] + "." + forged + "." + parts[2],
		"wrong version":   "v2." + parts[1] + "." + parts[2],
		"missing part":    parts[0] + "." + parts[1],
		"garbage":         "not-a-token",
		"empty signature": parts[0] + "." + parts[1] + ".",
	} {
		if _, err := signer.Verify(candidate); !errors.Is(err, ErrInvalidToken) {
			t.Errorf("%s: err = %v, want ErrInvalidToken", name, err)
		}
	}
	if _, err := testSigner(t, 'b').Verify(token); !errors.Is(err, ErrInvalidToken) {
		t.Errorf("another key's token verified: %v", err)
	}
}

func TestNewSignerRejectsBadKeys(t *testing.T) {
	t.Parallel()
	for _, key := range []string{"", "not base64!", base64.StdEncoding.EncodeToString([]byte("short"))} {
		if _, err := NewSigner(key); err == nil {
			t.Errorf("NewSigner(%q) accepted a bad key", key)
		}
	}
}
