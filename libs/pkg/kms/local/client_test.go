package local_test

import (
	"bytes"
	"context"
	"strings"
	"testing"

	"github.com/aethercode/aethercode/libs/pkg/kms/local"
)

func testKey() []byte {
	key := make([]byte, 32)
	for i := range key {
		key[i] = byte(i + 1)
	}
	return key
}

func TestRoundtrip(t *testing.T) {
	t.Parallel()
	client := local.New(local.Config{Key: testKey()})
	plaintext := []byte("hello, AetherCode KMS!")

	ciphertext, keyRef, err := client.Encrypt(context.Background(), plaintext)
	if err != nil {
		t.Fatalf("Encrypt: %v", err)
	}
	if bytes.Equal(ciphertext, plaintext) {
		t.Fatal("ciphertext must differ from plaintext")
	}
	if !strings.HasPrefix(keyRef, "local:") {
		t.Fatalf("keyRef must start with 'local:', got %q", keyRef)
	}

	decrypted, err := client.Decrypt(context.Background(), ciphertext, keyRef)
	if err != nil {
		t.Fatalf("Decrypt: %v", err)
	}
	if !bytes.Equal(decrypted, plaintext) {
		t.Fatalf("decrypted mismatch: got %q, want %q", decrypted, plaintext)
	}
}

func TestEncryptIsNonDeterministic(t *testing.T) {
	t.Parallel()
	client := local.New(local.Config{Key: testKey()})
	plaintext := []byte("same plaintext")

	ct1, _, err := client.Encrypt(context.Background(), plaintext)
	if err != nil {
		t.Fatalf("first Encrypt: %v", err)
	}
	ct2, _, err := client.Encrypt(context.Background(), plaintext)
	if err != nil {
		t.Fatalf("second Encrypt: %v", err)
	}
	if bytes.Equal(ct1, ct2) {
		t.Fatal("two encryptions of the same plaintext must produce distinct ciphertexts")
	}
}

func TestDecryptWrongKeyRef(t *testing.T) {
	t.Parallel()
	client := local.New(local.Config{Key: testKey()})
	ciphertext, _, err := client.Encrypt(context.Background(), []byte("data"))
	if err != nil {
		t.Fatalf("Encrypt: %v", err)
	}
	_, err = client.Decrypt(context.Background(), ciphertext, "wrong:ref")
	if err == nil {
		t.Fatal("Decrypt with wrong keyRef must return an error")
	}
}

func TestDecryptTamperedCiphertext(t *testing.T) {
	t.Parallel()
	client := local.New(local.Config{Key: testKey()})
	ciphertext, keyRef, err := client.Encrypt(context.Background(), []byte("sensitive"))
	if err != nil {
		t.Fatalf("Encrypt: %v", err)
	}
	// Flip one byte in the tag area.
	ciphertext[len(ciphertext)-1] ^= 0xff
	_, err = client.Decrypt(context.Background(), ciphertext, keyRef)
	if err == nil {
		t.Fatal("Decrypt of tampered ciphertext must return an error")
	}
}

func TestDecryptTooShort(t *testing.T) {
	t.Parallel()
	client := local.New(local.Config{Key: testKey()})
	_, keyRef, err := client.Encrypt(context.Background(), []byte("x"))
	if err != nil {
		t.Fatalf("Encrypt: %v", err)
	}
	_, err = client.Decrypt(context.Background(), []byte("short"), keyRef)
	if err == nil {
		t.Fatal("Decrypt of too-short ciphertext must return an error")
	}
}
