package app

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	centralauthz "github.com/aethercode/aethercode/libs/pkg/authz"
	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
	"github.com/aethercode/aethercode/libs/pkg/evalbundle"
	"github.com/aethercode/aethercode/libs/pkg/kms"
	"github.com/aethercode/aethercode/libs/pkg/storage"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestNormalizeVersionContentNormalizesStableAuthoringInput(t *testing.T) {
	content := VersionContent{
		Title:          "  Two Sum  ",
		PromptMarkdown: "  Find a pair.  ",
		Difficulty:     "MEDIUM",
		SupportedLanguages: []string{
			"Go", "python3",
		},
		TimeLimitMS:    1000,
		MemoryLimitKiB: 65536,
		Tags:           []Tag{{Name: " Arrays "}, {Name: "arrays"}, {Name: "Hash-Map"}},
	}

	if err := normalizeVersionContent(&content); err != nil {
		t.Fatalf("normalizeVersionContent() error = %v", err)
	}
	if content.Title != "Two Sum" || content.PromptMarkdown != "Find a pair." || content.Difficulty != "medium" {
		t.Fatalf("content was not normalized: %#v", content)
	}
	if got, want := len(content.SupportedLanguages), 2; got != want || content.SupportedLanguages[0] != "go" || content.SupportedLanguages[1] != "python3" {
		t.Fatalf("supported languages = %#v", content.SupportedLanguages)
	}
	if got, want := len(content.Tags), 2; got != want || content.Tags[0].Name != "arrays" || content.Tags[1].Name != "hash-map" || !isUUID(content.Tags[0].ID) || !isUUID(content.Tags[1].ID) {
		t.Fatalf("tags = %#v", content.Tags)
	}
}

func TestNormalizeVersionContentRejectsEmptyLanguagesAndDuplicateLanguages(t *testing.T) {
	content := validVersionContent()
	content.SupportedLanguages = nil
	if err := normalizeVersionContent(&content); err == nil {
		t.Fatal("normalizeVersionContent() accepted no languages")
	}

	content = validVersionContent()
	content.SupportedLanguages = []string{"go", "GO"}
	if err := normalizeVersionContent(&content); err == nil {
		t.Fatal("normalizeVersionContent() accepted duplicate normalized languages")
	}
}

func TestFingerprintExcludesGeneratedTagIDs(t *testing.T) {
	first := validVersionContent()
	second := validVersionContent()
	if err := normalizeVersionContent(&first); err != nil {
		t.Fatal(err)
	}
	if err := normalizeVersionContent(&second); err != nil {
		t.Fatal(err)
	}
	firstFingerprint := fingerprintVersionContent(first)
	secondFingerprint := fingerprintVersionContent(second)
	if !reflect.DeepEqual(firstFingerprint, secondFingerprint) {
		t.Fatalf("fingerprint includes generated IDs: %#v != %#v", firstFingerprint, secondFingerprint)
	}
}

func TestValidIdempotencyKey(t *testing.T) {
	for _, testCase := range []struct {
		name  string
		key   string
		valid bool
	}{
		{name: "valid", key: "question-create:01JTEST", valid: true},
		{name: "empty", key: "", valid: false},
		{name: "space", key: "contains space", valid: false},
		{name: "newline", key: "line\nbreak", valid: false},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			if got := validIdempotencyKey(testCase.key); got != testCase.valid {
				t.Fatalf("validIdempotencyKey(%q) = %v, want %v", testCase.key, got, testCase.valid)
			}
		})
	}
}

func TestPublishQuestionVersionRequiresValidQuestionAndVersionIDs(t *testing.T) {
	t.Parallel()
	for _, testCase := range []struct {
		name              string
		questionVersionID string
		eventID           string
		expectInvalidArg  bool
	}{
		{name: "valid UUIDs pass initial validation", questionVersionID: "01920a4d-1234-7abc-9876-543210fedcba", eventID: "01920a4d-5678-7def-1234-abcdef012345", expectInvalidArg: false},
		{name: "invalid QuestionVersionID", questionVersionID: "not-a-uuid", eventID: "01920a4d-5678-7def-1234-abcdef012345", expectInvalidArg: true},
		{name: "invalid EventID", questionVersionID: "01920a4d-1234-7abc-9876-543210fedcba", eventID: "invalid", expectInvalidArg: true},
		{name: "empty QuestionVersionID", questionVersionID: "", eventID: "01920a4d-5678-7def-1234-abcdef012345", expectInvalidArg: true},
		{name: "empty EventID", questionVersionID: "01920a4d-1234-7abc-9876-543210fedcba", eventID: "", expectInvalidArg: true},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			store := &panicStore{}
			service := &Service{pool: nil, store: store}
			command := PublishQuestionVersion{
				WriteCommand:            WriteCommand{IdempotencyKey: "test-key"},
				QuestionVersionID:       testCase.questionVersionID,
				EventID:                 testCase.eventID,
				ExpectedQuestionVersion: 1,
			}
			_, err := service.PublishQuestionVersion(context.TODO(), centralauthz.Capability{}, command)
			if testCase.expectInvalidArg {
				if err == nil {
					t.Fatal("PublishQuestionVersion() expected invalid argument error, got nil")
				}
			} else {
				if err == nil {
					t.Fatal("PublishQuestionVersion() expected error (validation passed, should fail at capability check)")
				}
			}
		})
	}
}

func TestAddQuestionAssetRejectsTraversalObjectKeys(t *testing.T) {
	t.Parallel()
	for _, testCase := range []struct {
		name             string
		objectKey        string
		expectInvalidArg bool
	}{
		{name: "valid key passes object validation", objectKey: "qbank/assets/source.enc", expectInvalidArg: false},
		{name: "traversal with ..", objectKey: "../private/key", expectInvalidArg: true},
		{name: "traversal in middle", objectKey: "qbank/../secrets/data", expectInvalidArg: true},
		{name: "absolute path", objectKey: "/etc/passwd", expectInvalidArg: true},
		{name: "empty key", objectKey: "", expectInvalidArg: true},
		{name: "multiple traversal", objectKey: "../../root", expectInvalidArg: true},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			store := &panicStore{}
			service := &Service{pool: nil, store: store}
			command := AddQuestionAsset{
				WriteCommand:            WriteCommand{IdempotencyKey: "test-key"},
				ID:                      "01920a4d-1234-7abc-9876-543210fedcba",
				QuestionVersionID:       "01920a4d-5678-7def-1234-abcdef012345",
				AssetKind:               "attachment",
				ContentType:             "text/plain",
				ByteSize:                1024,
				ExpectedQuestionVersion: 1,
				ObjectReference: ObjectReference{
					ObjectKey:              testCase.objectKey,
					Checksum:               "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
					EncryptionKeyReference: "kms:question-bank/assets",
				},
			}
			_, err := service.AddQuestionAsset(context.TODO(), centralauthz.Capability{}, command)
			if testCase.expectInvalidArg {
				if err == nil {
					t.Fatal("AddQuestionAsset() expected invalid argument error, got nil")
				}
			} else {
				if err == nil {
					t.Fatal("AddQuestionAsset() expected error (validation passed, should fail at capability check)")
				}
			}
		})
	}
}

func TestObjectReferenceRequiresBothChecksumAndEncryptionKey(t *testing.T) {
	t.Parallel()
	for _, testCase := range []struct {
		name             string
		checksum         string
		encryptKey       string
		expectInvalidArg bool
	}{
		{name: "both present pass validation", checksum: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", encryptKey: "kms:question-bank/test", expectInvalidArg: false},
		{name: "missing checksum", checksum: "", encryptKey: "kms:question-bank/test", expectInvalidArg: true},
		{name: "invalid checksum", checksum: "invalid", encryptKey: "kms:question-bank/test", expectInvalidArg: true},
		{name: "missing encryption key", checksum: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", encryptKey: "", expectInvalidArg: true},
		{name: "invalid encryption key pattern", checksum: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", encryptKey: "plaintext", expectInvalidArg: true},
		{name: "both missing", checksum: "", encryptKey: "", expectInvalidArg: true},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			store := &panicStore{}
			service := &Service{pool: nil, store: store}
			command := AddQuestionAsset{
				WriteCommand:            WriteCommand{IdempotencyKey: "test-key"},
				ID:                      "01920a4d-1234-7abc-9876-543210fedcba",
				QuestionVersionID:       "01920a4d-5678-7def-1234-abcdef012345",
				AssetKind:               "attachment",
				ContentType:             "text/plain",
				ByteSize:                1024,
				ExpectedQuestionVersion: 1,
				ObjectReference: ObjectReference{
					ObjectKey:              "qbank/assets/test.json",
					Checksum:               testCase.checksum,
					EncryptionKeyReference: testCase.encryptKey,
				},
			}
			_, err := service.AddQuestionAsset(context.TODO(), centralauthz.Capability{}, command)
			if testCase.expectInvalidArg {
				if err == nil {
					t.Fatal("AddQuestionAsset() expected invalid argument error, got nil")
				}
			} else {
				if err == nil {
					t.Fatal("AddQuestionAsset() expected error (validation passed, should fail at capability check)")
				}
			}
		})
	}
}

func TestCreateDraftQuestionVersionRejectsWithoutExpectedParentVersion(t *testing.T) {
	t.Parallel()
	for _, testCase := range []struct {
		name             string
		expectedVersion  int64
		expectInvalidArg bool
	}{
		{name: "valid positive version passes validation", expectedVersion: 1, expectInvalidArg: false},
		{name: "zero version", expectedVersion: 0, expectInvalidArg: true},
		{name: "negative version", expectedVersion: -1, expectInvalidArg: true},
		{name: "high version passes validation", expectedVersion: 42, expectInvalidArg: false},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			store := &panicStore{}
			service := &Service{pool: nil, store: store}
			command := CreateDraftQuestionVersion{
				WriteCommand:             WriteCommand{IdempotencyKey: "test-key"},
				ID:                       "01920a4d-1234-7abc-9876-543210fedcba",
				EventID:                  "01920a4d-5678-7def-1234-abcdef012345",
				QuestionID:               "01920a4d-9abc-7def-5678-0123456789ab",
				ExpectedQuestionRevision: testCase.expectedVersion,
				Content:                  validVersionContent(),
			}
			_, err := service.CreateDraftQuestionVersion(context.TODO(), centralauthz.Capability{}, command)
			if testCase.expectInvalidArg {
				if err == nil {
					t.Fatal("CreateDraftQuestionVersion() expected invalid argument error, got nil")
				}
			} else {
				if err == nil {
					t.Fatal("CreateDraftQuestionVersion() expected error (validation passed, should fail at capability check)")
				}
			}
		})
	}
}

type panicStore struct{}

func (s *panicStore) ClaimIdempotency(context.Context, pgx.Tx, IdempotencyClaim) (json.RawMessage, bool, error) {
	panic("store method called before validation")
}
func (s *panicStore) CompleteIdempotency(context.Context, pgx.Tx, IdempotencyClaim, int, json.RawMessage) error {
	panic("store method called before validation")
}
func (s *panicStore) CreateQuestion(context.Context, pgx.Tx, CreateQuestion) (QuestionDetail, error) {
	panic("store method called before validation")
}
func (s *panicStore) CreateDraftQuestionVersion(context.Context, pgx.Tx, CreateDraftQuestionVersion) (QuestionDetail, error) {
	panic("store method called before validation")
}
func (s *panicStore) SetQuestionVersionTests(context.Context, pgx.Tx, StoreQuestionVersionTests) (QuestionVersion, []string, error) {
	panic("store method called before validation")
}
func (s *panicStore) AddQuestionAsset(context.Context, pgx.Tx, AddQuestionAsset) (QuestionVersion, error) {
	panic("store method called before validation")
}
func (s *panicStore) ReplaceQuestionVersionTags(context.Context, pgx.Tx, ReplaceQuestionVersionTags) (QuestionVersion, error) {
	panic("store method called before validation")
}
func (s *panicStore) PublishQuestionVersion(context.Context, pgx.Tx, PublishQuestionVersion) (QuestionDetail, error) {
	panic("store method called before validation")
}
func (s *panicStore) ArchiveQuestion(context.Context, pgx.Tx, ArchiveQuestion) (QuestionDetail, error) {
	panic("store method called before validation")
}
func (s *panicStore) GetPublishedQuestion(context.Context, pgx.Tx, string) (QuestionDetail, error) {
	panic("store method called before validation")
}
func (s *panicStore) GetQuestionVersion(context.Context, pgx.Tx, string) (QuestionVersion, error) {
	panic("store method called before validation")
}
func (s *panicStore) ListPublishedQuestions(context.Context, pgx.Tx, ListPublishedQuestions) ([]QuestionDetail, error) {
	panic("store method called before validation")
}
func (s *panicStore) ListQuestionVersions(context.Context, pgx.Tx, ListQuestionVersions) ([]QuestionVersion, error) {
	panic("store method called before validation")
}
func (s *panicStore) GetQuestionIncludeDeleted(context.Context, pgx.Tx, string) (Question, error) {
	panic("store method called before validation")
}
func (s *panicStore) GetQuestionVersionIncludeDeleted(context.Context, pgx.Tx, string) (QuestionVersion, error) {
	panic("store method called before validation")
}
func (s *panicStore) SoftDeleteQuestion(context.Context, pgx.Tx, DeleteQuestion) error {
	panic("store method called before validation")
}
func (s *panicStore) HardDeleteQuestion(context.Context, pgx.Tx, DeleteQuestion) error {
	panic("store method called before validation")
}
func (s *panicStore) SoftDeleteQuestionVersion(context.Context, pgx.Tx, DeleteQuestionVersion) error {
	panic("store method called before validation")
}
func (s *panicStore) HardDeleteQuestionVersion(context.Context, pgx.Tx, DeleteQuestionVersion) error {
	panic("store method called before validation")
}
func (s *panicStore) GetAssetObjectRef(context.Context, pgx.Tx, string, string) (string, string, string, error) {
	panic("store method called before validation")
}
func (s *panicStore) Ping(context.Context) error {
	panic("store method called before validation")
}

func validVersionContent() VersionContent {
	return VersionContent{
		Title:              "Question",
		PromptMarkdown:     "Solve the problem.",
		Difficulty:         "easy",
		SupportedLanguages: []string{"go"},
		TimeLimitMS:        1000,
		MemoryLimitKiB:     65536,
		Tags:               []Tag{{Name: "arrays"}},
	}
}

// fakeStorage is an in-memory storage.Object that records what is stored.
type fakeStorage struct {
	mu      sync.Mutex
	objects map[string][]byte
}

func newFakeStorage() *fakeStorage { return &fakeStorage{objects: map[string][]byte{}} }

func (s *fakeStorage) Put(_ context.Context, key string, r io.Reader, _ int64, _ string) error {
	data, err := io.ReadAll(r)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.objects[key] = data
	return nil
}
func (s *fakeStorage) Get(_ context.Context, key string) (io.ReadCloser, int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	data, ok := s.objects[key]
	if !ok {
		return nil, 0, errors.New("not found")
	}
	return io.NopCloser(bytes.NewReader(data)), int64(len(data)), nil
}
func (s *fakeStorage) Delete(_ context.Context, key string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.objects, key)
	return nil
}
func (s *fakeStorage) Exists(_ context.Context, key string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, ok := s.objects[key]
	return ok, nil
}
func (s *fakeStorage) PresignGet(context.Context, string, time.Duration) (string, error) {
	return "", errors.New("not supported")
}

// fakeKMS "encrypts" by prefixing, so ciphertext differs from plaintext.
type fakeKMS struct{}

func (k *fakeKMS) Encrypt(_ context.Context, p []byte) ([]byte, string, error) {
	return append([]byte("enc:"), p...), "local:test", nil
}
func (k *fakeKMS) Decrypt(_ context.Context, c []byte, _ string) ([]byte, error) {
	return bytes.TrimPrefix(c, []byte("enc:")), nil
}

func testService(objectStorage *fakeStorage) *Service {
	return &Service{pool: nil, store: &panicStore{}, storage: objectStorage, kms: &fakeKMS{}, logger: slog.New(slog.DiscardHandler)}
}

func TestNewServiceRequiresStorageAndKMS(t *testing.T) {
	t.Parallel()
	logger := slog.New(slog.DiscardHandler)
	pool := &pgxpool.Pool{}
	for _, testCase := range []struct {
		name    string
		storage storage.Object
		kms     kms.KeyManager
	}{
		{name: "no storage", kms: &fakeKMS{}},
		{name: "no kms", storage: newFakeStorage()},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			if _, err := NewService(pool, &panicStore{}, testCase.storage, testCase.kms, logger); err == nil {
				t.Fatal("NewService() error = nil, want an error")
			}
		})
	}
	if _, err := NewService(pool, &panicStore{}, newFakeStorage(), &fakeKMS{}, logger); err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
}

func TestGetAssetRejectsUnknownKinds(t *testing.T) {
	t.Parallel()
	for _, kind := range []string{"test_cases", "bundle", ""} {
		_, err := testService(newFakeStorage()).GetAsset(context.TODO(), centralauthz.Capability{}, GetAssetCmd{
			QuestionVersionID: "01920a4d-1234-7abc-9876-543210fedcba",
			AssetKind:         kind,
		})
		if err == nil || !strings.Contains(err.Error(), "asset_kind must be") {
			t.Fatalf("GetAsset(%q) error = %v, want asset_kind validation error", kind, err)
		}
	}
}

func TestGetAssetAcceptsEncryptedKinds(t *testing.T) {
	t.Parallel()
	for _, kind := range []string{"attachment", "starter_code", "reference_solution"} {
		_, err := testService(newFakeStorage()).GetAsset(context.TODO(), centralauthz.Capability{}, GetAssetCmd{
			QuestionVersionID: "01920a4d-1234-7abc-9876-543210fedcba",
			AssetKind:         kind,
		})
		if err == nil || strings.Contains(err.Error(), "asset_kind must be") {
			t.Fatalf("GetAsset(%q) error = %v, want a capability error after validation", kind, err)
		}
	}
}

const testQuestionVersionID = "01920a4d-1234-7abc-9876-543210fedcba"

func TestSetQuestionVersionTestsValidation(t *testing.T) {
	t.Parallel()
	sample := TestCase{Input: "1", ExpectedOutput: "1", Sample: true, Weight: 1}
	hidden := TestCase{Input: "2", ExpectedOutput: "2", Weight: 1}
	tooMany := make([]TestCase, 501)
	for index := range tooMany {
		tooMany[index] = TestCase{Input: "x", ExpectedOutput: "x", Sample: index == 0, Weight: 1}
	}
	oversize := strings.Repeat("a", maximumTestTextBytes+1)
	for _, testCase := range []struct {
		name     string
		version  string
		expected int64
		tests    []TestCase
	}{
		{name: "invalid version ID", version: "nope", expected: 1, tests: []TestCase{sample, hidden}},
		{name: "invalid expected version", version: testQuestionVersionID, expected: 0, tests: []TestCase{sample, hidden}},
		{name: "no tests", version: testQuestionVersionID, expected: 1},
		{name: "too many tests", version: testQuestionVersionID, expected: 1, tests: tooMany},
		{name: "no hidden test", version: testQuestionVersionID, expected: 1, tests: []TestCase{sample}},
		{name: "no sample test", version: testQuestionVersionID, expected: 1, tests: []TestCase{hidden}},
		{name: "weight zero", version: testQuestionVersionID, expected: 1, tests: []TestCase{sample, {Input: "2", ExpectedOutput: "2"}}},
		{name: "weight above 100", version: testQuestionVersionID, expected: 1, tests: []TestCase{sample, {Input: "2", ExpectedOutput: "2", Weight: 101}}},
		{name: "oversize input", version: testQuestionVersionID, expected: 1, tests: []TestCase{sample, {Input: oversize, ExpectedOutput: "2", Weight: 1}}},
		{name: "oversize output", version: testQuestionVersionID, expected: 1, tests: []TestCase{sample, {Input: "2", ExpectedOutput: oversize, Weight: 1}}},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			objectStorage := newFakeStorage()
			_, err := testService(objectStorage).SetQuestionVersionTests(context.TODO(), centralauthz.Capability{}, SetQuestionVersionTests{
				QuestionVersionID: testCase.version, ExpectedQuestionVersion: testCase.expected, Tests: testCase.tests,
			})
			var appError *apperrors.Error
			if !errors.As(err, &appError) || appError.Code != apperrors.CodeInvalidArgument {
				t.Fatalf("SetQuestionVersionTests() error = %v, want invalid argument", err)
			}
			if len(objectStorage.objects) != 0 {
				t.Fatalf("validation failure stored %d objects", len(objectStorage.objects))
			}
		})
	}
}

func TestStoreBundlesBuildsThreeBundles(t *testing.T) {
	t.Parallel()
	evaluation, sample, hidden, err := splitTests([]TestCase{
		{Input: "s1", ExpectedOutput: "o1", Sample: true, Weight: 1},
		{Input: "h1", ExpectedOutput: "o2", Weight: 5},
		{Input: "s2", ExpectedOutput: "o3", Sample: true, Weight: 2},
		{Input: "h2", ExpectedOutput: "o4", Weight: 100},
	})
	if err != nil {
		t.Fatalf("splitTests() error = %v", err)
	}
	objectStorage := newFakeStorage()
	service := testService(objectStorage)
	for _, bundle := range []struct {
		kind  string
		cases []evalbundle.TestCase
		want  []evalbundle.TestCase
	}{
		{"evaluation", evaluation, []evalbundle.TestCase{{Stdin: "s1", ExpectedOutput: "o1", Weight: 1}, {Stdin: "h1", ExpectedOutput: "o2", Weight: 5}, {Stdin: "s2", ExpectedOutput: "o3", Weight: 2}, {Stdin: "h2", ExpectedOutput: "o4", Weight: 100}}},
		{"sample", sample, []evalbundle.TestCase{{Stdin: "s1", ExpectedOutput: "o1", Weight: 1}, {Stdin: "s2", ExpectedOutput: "o3", Weight: 2}}},
		{"hidden", hidden, []evalbundle.TestCase{{Stdin: "h1", ExpectedOutput: "o2", Weight: 5}, {Stdin: "h2", ExpectedOutput: "o4", Weight: 100}}},
	} {
		objectKey, reference, err := service.storeBundle(context.TODO(), testQuestionVersionID, bundle.kind, bundle.cases)
		if err != nil {
			t.Fatalf("storeBundle(%s) error = %v", bundle.kind, err)
		}
		if prefix := "qbank/question-versions/" + testQuestionVersionID + "/"; !strings.HasPrefix(objectKey, prefix) || !strings.HasSuffix(objectKey, "-"+bundle.kind+".bundle") {
			t.Fatalf("object key %q does not match the expected layout", objectKey)
		}
		stored := objectStorage.objects[objectKey]
		if digest := sha256.Sum256(stored); reference.Checksum != hex.EncodeToString(digest[:]) {
			t.Fatalf("%s checksum %q is not the SHA-256 of the stored ciphertext", bundle.kind, reference.Checksum)
		}
		if reference.EncryptionKeyReference != "local:test" || reference.ObjectKey != objectKey {
			t.Fatalf("%s reference = %+v", bundle.kind, reference)
		}
		plaintext, _ := (&fakeKMS{}).Decrypt(context.TODO(), stored, "")
		got, err := evalbundle.Parse(plaintext)
		if err != nil || !reflect.DeepEqual(got.TestCases, bundle.want) {
			t.Fatalf("%s bundle = %+v (err %v), want %+v", bundle.kind, got, err, bundle.want)
		}
		if got.Sample != (bundle.kind == "sample") {
			t.Fatalf("%s bundle Sample = %t; only the sample bundle may return output", bundle.kind, got.Sample)
		}
	}
}

func TestSetQuestionVersionTestsDeletesObjectsWhenDatabaseStepFails(t *testing.T) {
	t.Parallel()
	objectStorage := newFakeStorage()
	// A zero capability fails before any database access, standing in for a
	// failed transaction after the three bundles were already uploaded.
	_, err := testService(objectStorage).SetQuestionVersionTests(context.TODO(), centralauthz.Capability{}, SetQuestionVersionTests{
		QuestionVersionID: testQuestionVersionID, ExpectedQuestionVersion: 1,
		Tests: []TestCase{{Input: "1", ExpectedOutput: "1", Sample: true, Weight: 1}, {Input: "2", ExpectedOutput: "2", Weight: 1}},
	})
	if err == nil {
		t.Fatal("SetQuestionVersionTests() error = nil, want a capability error")
	}
	if len(objectStorage.objects) != 0 {
		t.Fatalf("%d orphaned objects remain after a failed database step", len(objectStorage.objects))
	}
}
