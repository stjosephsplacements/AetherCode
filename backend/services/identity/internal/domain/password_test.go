package domain

import (
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestHashAndVerifyPassword(t *testing.T) {
	t.Parallel()
	hash, err := HashPassword("AetherCode2026")
	if err != nil {
		t.Fatalf("HashPassword() error = %v", err)
	}
	if !VerifyPassword(hash, "AetherCode2026") {
		t.Fatal("VerifyPassword() rejected its own hash")
	}
	if VerifyPassword(hash, "wrong-password") {
		t.Fatal("VerifyPassword() accepted a wrong password")
	}
}

func TestValidatePassword(t *testing.T) {
	t.Parallel()
	for _, password := range []string{"short1", "onlyletterslong"} {
		if err := ValidatePassword(password); err == nil {
			t.Fatalf("ValidatePassword(%q) accepted an invalid password", password)
		}
	}
}

func TestDeriveDeliveryTokenIsPurposeBoundAndStable(t *testing.T) {
	t.Parallel()
	key := make([]byte, 32)
	for index := range key {
		key[index] = byte(index + 1)
	}
	verification, err := DeriveDeliveryToken(key, "email-verification", "019b11a0-0000-7000-8000-000000000001")
	if err != nil {
		t.Fatalf("DeriveDeliveryToken() error = %v", err)
	}
	again, err := DeriveDeliveryToken(key, "email-verification", "019b11a0-0000-7000-8000-000000000001")
	if err != nil || verification != again {
		t.Fatalf("delivery token derivation was not stable: %q / %q / %v", verification, again, err)
	}
	reset, err := DeriveDeliveryToken(key, DeliveryPurposeAccountRecovery, "019b11a0-0000-7000-8000-000000000001")
	if err != nil || reset == verification {
		t.Fatalf("delivery token purpose binding failed: %q / %q / %v", verification, reset, err)
	}
}

func TestGeneratePasswordSatisfiesPolicy(t *testing.T) {
	t.Parallel()
	seen := map[string]bool{}
	for range 200 {
		password, err := GeneratePassword()
		if err != nil {
			t.Fatalf("GeneratePassword() error = %v", err)
		}
		if err := ValidatePassword(password); err != nil {
			t.Fatalf("GeneratePassword() = %q violates policy: %v", password, err)
		}
		if strings.ContainsAny(password, "0O1lI") {
			t.Fatalf("GeneratePassword() = %q contains an ambiguous character", password)
		}
		seen[password] = true
	}
	if len(seen) != 200 {
		t.Fatalf("GeneratePassword() repeated a password in 200 draws")
	}
}

func TestGeneratedPasswordHashVerifiesAndIsLighter(t *testing.T) {
	t.Parallel()
	password, err := GeneratePassword()
	if err != nil {
		t.Fatal(err)
	}
	generated, err := HashGeneratedPassword(password)
	if err != nil {
		t.Fatal(err)
	}
	if !VerifyPassword(generated, password) || VerifyPassword(generated, password+"x") {
		t.Fatal("a generated-password hash must verify exactly its password")
	}
	if !strings.Contains(generated, "m=19456,t=2,p=1") {
		t.Fatalf("generated passwords use the OWASP minimum settings, got %s", generated)
	}
	chosen, err := HashPassword("A person chose this 2026")
	if err != nil || !strings.Contains(chosen, "m=19456,t=2,p=1") {
		t.Fatalf("a chosen password uses the OWASP minimum settings, got %s (%v)", chosen, err)
	}
}

func TestHashesWrittenWithTheOlderSettingsStillVerify(t *testing.T) {
	t.Parallel()
	// A hash written before the settings changed: 64 MiB, 3 passes, 4 lanes.
	old, err := hashPassword("A person chose this 2026", 64*1024, 3, 4)
	if err != nil {
		t.Fatal(err)
	}
	if !VerifyPassword(old, "A person chose this 2026") || VerifyPassword(old, "another password 2026") {
		t.Fatal("an older-settings hash must still verify exactly its password")
	}
	tooHeavy, err := hashPassword("A person chose this 2026", 128*1024, 1, 1)
	if err != nil {
		t.Fatal(err)
	}
	if VerifyPassword(tooHeavy, "A person chose this 2026") {
		t.Fatal("a hash asking for more than 64 MiB must be refused before any work is done")
	}
}

func TestArgonSlotsBoundConcurrentWork(t *testing.T) {
	t.Parallel()
	limit := cap(argonSlots)
	var running, peak atomic.Int32
	var wg sync.WaitGroup
	for range limit * 4 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			withArgonSlot(func() {
				now := running.Add(1)
				for {
					seen := peak.Load()
					if now <= seen || peak.CompareAndSwap(seen, now) {
						break
					}
				}
				time.Sleep(5 * time.Millisecond)
				running.Add(-1)
			})
		}()
	}
	wg.Wait()
	if got := int(peak.Load()); got > limit {
		t.Fatalf("%d computations ran at once, limit %d", got, limit)
	}
}
