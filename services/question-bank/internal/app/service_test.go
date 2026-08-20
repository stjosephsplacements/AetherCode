package app

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"

	centralauthz "github.com/aethercode/aethercode/libs/pkg/authz"
	"github.com/jackc/pgx/v5"
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
		EvaluationBundle: ObjectReference{
			ObjectKey:              "qbank/bundles/two-sum-v1.tar.zst",
			Checksum:               "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
			EncryptionKeyReference: "kms:question-bank/evaluation",
		},
		Tags: []Tag{{Name: " Arrays "}, {Name: "arrays"}, {Name: "Hash-Map"}},
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
	if content.EvaluationBundle.Checksum != "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" {
		t.Fatalf("checksum was not normalized: %q", content.EvaluationBundle.Checksum)
	}
}

func TestNormalizeVersionContentRejectsUnsafeObjectReference(t *testing.T) {
	content := validVersionContent()
	content.EvaluationBundle.ObjectKey = "../private/key"
	if err := normalizeVersionContent(&content); err == nil {
		t.Fatal("normalizeVersionContent() accepted a traversal object key")
	}

	content = validVersionContent()
	content.EvaluationBundle.EncryptionKeyReference = "plaintext-secret"
	if err := normalizeVersionContent(&content); err == nil {
		t.Fatal("normalizeVersionContent() accepted a non-reference encryption value")
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
			command := UpsertTestCaseManifest{
				WriteCommand:            WriteCommand{IdempotencyKey: "test-key"},
				ID:                      "01920a4d-1234-7abc-9876-543210fedcba",
				QuestionVersionID:       "01920a4d-5678-7def-1234-abcdef012345",
				ManifestKind:            "sample",
				TestCaseCount:           5,
				ExpectedQuestionVersion: 1,
				ObjectReference: ObjectReference{
					ObjectKey:              "qbank/manifests/test.json",
					Checksum:               testCase.checksum,
					EncryptionKeyReference: testCase.encryptKey,
				},
			}
			_, err := service.UpsertTestCaseManifest(context.TODO(), centralauthz.Capability{}, command)
			if testCase.expectInvalidArg {
				if err == nil {
					t.Fatal("UpsertTestCaseManifest() expected invalid argument error, got nil")
				}
			} else {
				if err == nil {
					t.Fatal("UpsertTestCaseManifest() expected error (validation passed, should fail at capability check)")
				}
			}
		})
	}
}

func TestUpsertTestCaseManifestRejectsOversizePayload(t *testing.T) {
	t.Parallel()
	store := &panicStore{}
	service := &Service{pool: nil, store: store}

	oversizeKey := make([]byte, 1025)
	for i := range oversizeKey {
		oversizeKey[i] = 'a'
	}
	command := UpsertTestCaseManifest{
		WriteCommand:            WriteCommand{IdempotencyKey: "test-key"},
		ID:                      "01920a4d-1234-7abc-9876-543210fedcba",
		QuestionVersionID:       "01920a4d-5678-7def-1234-abcdef012345",
		ManifestKind:            "hidden",
		TestCaseCount:           10,
		ExpectedQuestionVersion: 1,
		ObjectReference: ObjectReference{
			ObjectKey:              string(oversizeKey),
			Checksum:               "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			EncryptionKeyReference: "kms:question-bank/manifests",
		},
	}
	if _, err := service.UpsertTestCaseManifest(context.TODO(), centralauthz.Capability{}, command); err == nil {
		t.Fatal("UpsertTestCaseManifest() accepted oversize object key")
	}

	validCommand := UpsertTestCaseManifest{
		WriteCommand:            WriteCommand{IdempotencyKey: "test-key-valid"},
		ID:                      "01920a4d-1234-7abc-9876-543210fedcba",
		QuestionVersionID:       "01920a4d-5678-7def-1234-abcdef012345",
		ManifestKind:            "sample",
		TestCaseCount:           3,
		ExpectedQuestionVersion: 1,
		ObjectReference: ObjectReference{
			ObjectKey:              "qbank/manifests/valid.json",
			Checksum:               "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			EncryptionKeyReference: "kms:question-bank/manifests",
		},
	}
	if _, err := service.UpsertTestCaseManifest(context.TODO(), centralauthz.Capability{}, validCommand); err == nil {
		t.Log("validation passes before transaction as expected")
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
func (s *panicStore) UpsertTestCaseManifest(context.Context, pgx.Tx, UpsertTestCaseManifest) (QuestionVersion, error) {
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
func (s *panicStore) ListPublishedQuestions(context.Context, pgx.Tx, int) ([]QuestionDetail, error) {
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
		EvaluationBundle: ObjectReference{
			ObjectKey:              "qbank/bundles/question-v1.tar.zst",
			Checksum:               "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			EncryptionKeyReference: "kms:question-bank/evaluation",
		},
		Tags: []Tag{{Name: "arrays"}},
	}
}
