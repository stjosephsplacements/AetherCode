package launchfile

import (
	"crypto/sha256"
	"encoding/hex"
	"testing"
)

func TestKeyOfIsSEBJSON(t *testing.T) {
	t.Parallel()
	plist := `<?xml version="1.0"?><plist version="1.0"><dict>
	<key>b</key><true/><key>A</key><integer>1</integer>
	<key>empty</key><dict></dict>
	<key>list</key><array><string>x</string><false/></array>
	<key>salt</key><data></data>
	<key>nested</key><dict><key>z</key><string>q</string><key>Y</key><real>1.5</real></dict>
	</dict></plist>`
	sum := sha256.Sum256([]byte(`{"A":1,"b":true,"list":["x",false],"nested":{"Y":1.5,"z":"q"},"salt":""}`))
	got, err := keyOf([]byte(plist))
	if err != nil {
		t.Fatalf("keyOf() error = %v", err)
	}
	if want := hex.EncodeToString(sum[:]); got != want {
		t.Fatalf("keyOf() = %s, want %s", got, want)
	}
}

func TestConfigKeyDependsOnTheStartURL(t *testing.T) {
	t.Parallel()
	settings := Settings{StartURL: "https://x/exam/1", QuitURL: "https://x/student", Password: "p"}
	first, err := ConfigKey(settings)
	if err != nil || len(first) != 64 {
		t.Fatalf("ConfigKey() = %q, %v", first, err)
	}
	again, _ := ConfigKey(settings)
	settings.StartURL = "https://x/exam/2"
	other, _ := ConfigKey(settings)
	if first != again || first == other {
		t.Fatalf("ConfigKey not deterministic or ignores start URL: %s %s %s", first, again, other)
	}
}
