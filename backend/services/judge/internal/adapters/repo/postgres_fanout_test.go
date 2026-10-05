package repo

import (
	"bytes"
	"context"
	"errors"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/aethercode/aethercode/libs/pkg/evalbundle"
)

type fakeStorage struct {
	objects map[string][]byte
	putErr  error
	// putFailAfter, when > 0, makes the (putFailAfter+1)th Put call fail
	// while every earlier call succeeds -- used to exercise the "some units
	// already stored, then one fails" partial-failure path. putErr (an
	// unconditional, always-fail error) takes precedence when both are set.
	putFailAfter int
	putCalls     int
	deletedKeys  []string
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
	s.putCalls++
	if s.putErr != nil {
		return s.putErr
	}
	if s.putFailAfter > 0 && s.putCalls > s.putFailAfter {
		return errors.New("storage unavailable")
	}
	data, err := io.ReadAll(r)
	if err != nil {
		return err
	}
	s.objects[key] = data
	return nil
}

func (s *fakeStorage) Delete(_ context.Context, key string) error {
	delete(s.objects, key)
	s.deletedKeys = append(s.deletedKeys, key)
	return nil
}
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

	refs, _, err := fanOutTestCases(context.Background(), storage, fakeKMS{}, "bundle-key", "bundle-key-ref", "job-123")
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

	if _, _, err := fanOutTestCases(context.Background(), storage, fakeKMS{}, "bundle-key", "ref", "job-123"); err == nil {
		t.Fatal("fanOutTestCases() error = nil, want the storage error propagated")
	}
}

func TestFanOutTestCasesCleansUpOrphanedObjectsOnPartialFailure(t *testing.T) {
	t.Parallel()
	storage := newFakeStorage()
	// The first two units store successfully; the third Put call fails, so
	// fan-out must clean up the two objects it already wrote in this attempt
	// before returning the original error.
	storage.putFailAfter = 2
	bundlePlaintext := []byte(`{"schema_version": 1, "test_cases": [
		{"stdin": "1\n", "expected_output": "1\n"},
		{"stdin": "2\n", "expected_output": "4\n"},
		{"stdin": "3\n", "expected_output": "9\n"},
		{"stdin": "4\n", "expected_output": "16\n"}
	]}`)
	bundleCiphertext, _, err := fakeKMS{}.Encrypt(context.Background(), bundlePlaintext)
	if err != nil {
		t.Fatalf("encrypt fixture bundle: %v", err)
	}
	storage.objects["bundle-key"] = bundleCiphertext

	_, _, err = fanOutTestCases(context.Background(), storage, fakeKMS{}, "bundle-key", "bundle-key-ref", "job-456")
	if err == nil {
		t.Fatal("fanOutTestCases() error = nil, want the storage error propagated")
	}
	if !strings.Contains(err.Error(), "storage unavailable") {
		t.Fatalf("fanOutTestCases() error = %v, want the original Put error surfaced, not masked by a cleanup error", err)
	}

	// Only the bundle object (seeded directly by the test, not via Put)
	// should remain; the two units stored before the failure must have been
	// deleted rather than left orphaned in storage.
	if len(storage.objects) != 1 {
		t.Fatalf("fanOutTestCases() left %d objects in storage after cleanup, want 1 (only the bundle)", len(storage.objects))
	}
	if _, ok := storage.objects["bundle-key"]; !ok {
		t.Fatal("fanOutTestCases() cleanup removed the bundle object; it must only remove unit objects it stored itself")
	}
	if len(storage.deletedKeys) != 2 {
		t.Fatalf("fanOutTestCases() issued %d cleanup deletes, want 2 (one per successfully stored unit)", len(storage.deletedKeys))
	}
}

func TestFanOutTestCasesCarriesBundleWeights(t *testing.T) {
	t.Parallel()
	storage := newFakeStorage()
	// v1 bundles weigh 1; v2 bundles carry an explicit weight per case.
	for name, wantWeights := range map[string][]int{
		`{"schema_version": 1, "test_cases": [{"stdin": "1", "expected_output": "1"}, {"stdin": "2", "expected_output": "2"}]}`:                             {1, 1},
		`{"schema_version": 2, "test_cases": [{"stdin": "1", "expected_output": "1", "weight": 7}, {"stdin": "2", "expected_output": "2", "weight": 100}]}`: {7, 100},
	} {
		bundleCiphertext, _, err := fakeKMS{}.Encrypt(context.Background(), []byte(name))
		if err != nil {
			t.Fatalf("encrypt fixture bundle: %v", err)
		}
		storage.objects["bundle-key"] = bundleCiphertext

		refs, _, err := fanOutTestCases(context.Background(), storage, fakeKMS{}, "bundle-key", "ref", "job-weights")
		if err != nil {
			t.Fatalf("fanOutTestCases() error = %v", err)
		}
		for i, ref := range refs {
			if ref.Weight != wantWeights[i] {
				t.Errorf("unit %d weight = %d, want %d", i, ref.Weight, wantWeights[i])
			}
		}
	}
}

func TestFetchDecrypted(t *testing.T) {
	t.Parallel()
	storage := newFakeStorage()
	ciphertext, keyRef, err := fakeKMS{}.Encrypt(context.Background(), []byte("print(1)"))
	if err != nil {
		t.Fatalf("encrypt fixture: %v", err)
	}
	storage.objects["source"] = ciphertext
	storage.objects["huge"] = make([]byte, maxObjectCiphertextBytes+1)

	got, err := fetchDecrypted(context.Background(), storage, fakeKMS{}, "source", keyRef)
	if err != nil || string(got) != "print(1)" {
		t.Fatalf("fetchDecrypted() = %q, %v; want the decrypted source", got, err)
	}
	if _, err := fetchDecrypted(context.Background(), storage, fakeKMS{}, "missing", keyRef); err == nil {
		t.Error("fetchDecrypted() on a missing object: error = nil")
	}
	// An oversized object is truncated at the read bound, never read whole.
	plaintext, err := fetchDecrypted(context.Background(), storage, fakeKMS{}, "huge", keyRef)
	if err != nil {
		t.Fatalf("fetchDecrypted() on oversized object: %v", err)
	}
	if len(plaintext) != maxObjectCiphertextBytes {
		t.Errorf("read %d bytes of an oversized object, want exactly the %d-byte bound", len(plaintext), maxObjectCiphertextBytes)
	}
}

func TestFanOutTestCasesReportsSampleBundles(t *testing.T) {
	t.Parallel()
	cases := []evalbundle.TestCase{{Stdin: "1\n", ExpectedOutput: "1\n", Weight: 1}}
	for _, testCase := range []struct {
		name  string
		build func([]evalbundle.TestCase) ([]byte, error)
		want  bool
	}{
		{name: "an evaluation bundle returns no output", build: evalbundle.Build},
		{name: "a sample bundle returns output", build: evalbundle.BuildSample, want: true},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			storage := newFakeStorage()
			plaintext, err := testCase.build(cases)
			if err != nil {
				t.Fatal(err)
			}
			ciphertext, _, err := fakeKMS{}.Encrypt(context.Background(), plaintext)
			if err != nil {
				t.Fatal(err)
			}
			storage.objects["bundle-key"] = ciphertext
			_, sample, err := fanOutTestCases(context.Background(), storage, fakeKMS{}, "bundle-key", "ref", "job-sample")
			if err != nil || sample != testCase.want {
				t.Fatalf("fanOutTestCases() sample = %t (err %v), want %t", sample, err, testCase.want)
			}
		})
	}
}
