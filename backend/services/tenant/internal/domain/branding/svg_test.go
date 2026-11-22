package branding

import "testing"

func TestSanitizeSVGRejectsScript(t *testing.T) {
	t.Parallel()
	_, err := SanitizeSVG([]byte(`<svg><script>alert(1)</script></svg>`))
	if err == nil {
		t.Fatal("expected svg script to be rejected")
	}
}

func TestSanitizeSVGAllowsSimpleLogo(t *testing.T) {
	t.Parallel()
	out, err := SanitizeSVG([]byte(`<svg xmlns="http://www.w3.org/2000/svg"><circle cx="4" cy="4" r="4"/></svg>`))
	if err != nil || len(out) == 0 {
		t.Fatalf("expected simple svg, got err=%v len=%d", err, len(out))
	}
}
