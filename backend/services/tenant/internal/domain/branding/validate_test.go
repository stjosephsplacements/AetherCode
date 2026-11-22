package branding

import "testing"

func TestUsableAccentBounds(t *testing.T) {
	t.Parallel()
	if !UsableAccent("#336699") {
		t.Fatal("mid-tone accent should be accepted")
	}
	if UsableAccent("#ffffff") || UsableAccent("#000000") || UsableAccent("blue") {
		t.Fatal("invalid accents should be rejected")
	}
}

func TestDetectImageTypePNG(t *testing.T) {
	t.Parallel()
	contentType, err := DetectImageType([]byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'})
	if err != nil || contentType != "image/png" {
		t.Fatalf("png detection failed: %v %q", err, contentType)
	}
}

func TestDetectImageTypeRejectsUnknown(t *testing.T) {
	t.Parallel()
	if _, err := DetectImageType([]byte("not an image")); err == nil {
		t.Fatal("expected unknown bytes to be rejected")
	}
}