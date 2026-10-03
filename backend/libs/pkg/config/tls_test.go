package config

import "testing"

func TestLoadMTLSServerConfigRejectsMissingFiles(t *testing.T) {
	t.Parallel()

	if _, err := LoadMTLSServerConfig("", "", ""); err == nil {
		t.Fatal("LoadMTLSServerConfig accepted missing files")
	}
}
