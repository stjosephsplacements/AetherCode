package main

import (
	"crypto/rand"
	"encoding/hex"
	"strings"
	"testing"
)

func TestLoadLaunchSettingsRejectsWeakOrMalformedPasswords(t *testing.T) {
	for name, password := range map[string]string{
		"too short":       "abc123",
		"not hexadecimal": strings.Repeat("g", 48),
		"patterned":       strings.Repeat("ab", 24),
	} {
		t.Run(name, func(t *testing.T) {
			t.Setenv("SEB_LAUNCH_BASE_URL", "https://exam.example.edu")
			t.Setenv("SEB_LAUNCH_PASSWORD", password)

			if _, err := loadLaunchSettings(); err == nil {
				t.Fatal("loadLaunchSettings() accepted a weak or malformed password")
			}
		})
	}
}

func TestLoadLaunchSettingsAcceptsGeneratedPasswordFormat(t *testing.T) {
	key := make([]byte, 24)
	if _, err := rand.Read(key); err != nil {
		t.Fatal(err)
	}
	password := hex.EncodeToString(key)
	t.Setenv("SEB_LAUNCH_BASE_URL", "https://exam.example.edu")
	t.Setenv("SEB_LAUNCH_PASSWORD", password)

	settings, err := loadLaunchSettings()
	if err != nil {
		t.Fatalf("loadLaunchSettings() error = %v", err)
	}
	if settings.Password != password {
		t.Fatal("loadLaunchSettings() returned a different password")
	}
}

func TestLoadLaunchSettingsAllowVMDefaultsToFalseAndRejectsNonBooleans(t *testing.T) {
	key := make([]byte, 24)
	if _, err := rand.Read(key); err != nil {
		t.Fatal(err)
	}
	t.Setenv("SEB_LAUNCH_BASE_URL", "https://exam.example.edu")
	t.Setenv("SEB_LAUNCH_PASSWORD", hex.EncodeToString(key))
	t.Setenv("SEB_ALLOW_VM", "")
	if settings, err := loadLaunchSettings(); err != nil || settings.AllowVM {
		t.Fatalf("unset SEB_ALLOW_VM = %v, %v; want false", settings.AllowVM, err)
	}
	t.Setenv("SEB_ALLOW_VM", "true")
	if settings, err := loadLaunchSettings(); err != nil || !settings.AllowVM {
		t.Fatalf("SEB_ALLOW_VM=true = %v, %v", settings.AllowVM, err)
	}
	t.Setenv("AETHERCODE_ENV", "production")
	if _, err := loadLaunchSettings(); err == nil {
		t.Fatal("SEB_ALLOW_VM=true was accepted in production")
	}
	t.Setenv("AETHERCODE_ENV", "staging")
	t.Setenv("SEB_ALLOW_VM", "maybe")
	if _, err := loadLaunchSettings(); err == nil {
		t.Fatal("a non-boolean SEB_ALLOW_VM was accepted")
	}
}
