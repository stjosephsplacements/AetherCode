package repo

import (
	"bytes"
	"context"
	"errors"
	"io"
	"testing"
	"time"
)

type fakeStorage struct {
	objects map[string][]byte
	putErr  error
}

func newFakeStorage() *fakeStorage { return &fakeStorage{objects: make(map[string][]byte)} }

func (s *fakeStorage) Get(_ context.Context, key string) (io.ReadCloser, int64, error) {
	data, ok := s.objects[key]
	if !ok {
		return nil, 0, errors.New("object not found")
	}
	return io.NopCloser(bytes.NewReader(data)), int64(len(data)), nil
}

func (s *fakeStorage) Put(_ context.Context, key string, r io.Reader, _ int64, _ string) error {
	if s.putErr != nil {
		return s.putErr
	}
	data, err := io.ReadAll(r)
	if err != nil {
		return err
	}
	s.objects[key] = data
	return nil
}

func (s *fakeStorage) Delete(context.Context, string) error         { return nil }
func (s *fakeStorage) Exists(context.Context, string) (bool, error) { return false, nil }
func (s *fakeStorage) PresignGet(context.Context, string, time.Duration) (string, error) {
	return "", nil
}

type fakeKMS struct{}

// fakeKMS "encrypts" by reversing bytes and "decrypts" by reversing back —
// deterministic, reversible, and obviously not real encryption; sufficient
// for testing that plaintext survives an encrypt-then-decrypt round trip
// through the fan-out logic without depending on a real KMS.
func (fakeKMS) Encrypt(_ context.Context, plaintext []byte) ([]byte, string, error) {
	reversed := make([]byte, len(plaintext))
	for i, b := range plaintext {
		reversed[len(plaintext)-1-i] = b
	}
	return reversed, "fake-key-ref", nil
}

func (fakeKMS) Decrypt(_ context.Context, ciphertext []byte, _ string) ([]byte, error) {
	reversed := make([]byte, len(ciphertext))
	for i, b := range ciphertext {
		reversed[len(ciphertext)-1-i] = b
	}
	return reversed, nil
}

func TestFanOutTestCasesCreatesOneObjectPerTestCase(t *testing.T) {
	t.Parallel()
	storage := newFakeStorage()
	bundlePlaintext := []byte(`{"schema_version": 1, "test_cases": [
		{"stdin": "1\n", "expected_output": "1\n"},
		{"stdin": "2\n", "expected_output": "4\n"},
		{"stdin": "3\n", "expected_output": "9\n"}
	]}`)
	bundleCiphertext, _, err := fakeKMS{}.Encrypt(context.Background(), bundlePlaintext)
	if err != nil {
		t.Fatalf("encrypt fixture bundle: %v", err)
	}
	storage.objects["bundle-key"] = bundleCiphertext

	refs, err := fanOutTestCases(context.Background(), storage, fakeKMS{}, "bundle-key", "bundle-key-ref", "job-123")
	if err != nil {
		t.Fatalf("fanOutTestCases() error = %v", err)
	}
	if len(refs) != 3 {
		t.Fatalf("fanOutTestCases() returned %d refs, want 3", len(refs))
	}
	// Every ref must point at a distinct, independently stored object.
	seen := make(map[string]bool)
	for _, ref := range refs {
		if seen[ref.ObjectKey] {
			t.Fatalf("duplicate object key %q across units", ref.ObjectKey)
		}
		seen[ref.ObjectKey] = true
		if _, ok := storage.objects[ref.ObjectKey]; !ok {
			t.Fatalf("ref %q does not correspond to a stored object", ref.ObjectKey)
		}
	}
}

func TestFanOutTestCasesPropagatesStorageError(t *testing.T) {
	t.Parallel()
	storage := newFakeStorage()
	storage.putErr = errors.New("storage unavailable")
	bundlePlaintext := []byte(`{"schema_version": 1, "test_cases": [{"stdin": "1", "expected_output": "1"}]}`)
	bundleCiphertext, _, _ := fakeKMS{}.Encrypt(context.Background(), bundlePlaintext)
	storage.objects["bundle-key"] = bundleCiphertext

	if _, err := fanOutTestCases(context.Background(), storage, fakeKMS{}, "bundle-key", "ref", "job-123"); err == nil {
		t.Fatal("fanOutTestCases() error = nil, want the storage error propagated")
	}
}
