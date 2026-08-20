// Package app contains Question Bank's global, transaction-scoped authoring
// workflows. PostgreSQL aggregate functions own multi-table mutations so a
// single signed resource capability remains exact under FORCE RLS.
package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"

	centralauthz "github.com/aethercode/aethercode/libs/pkg/authz"
	"github.com/aethercode/aethercode/libs/pkg/database"
	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
	"github.com/aethercode/aethercode/libs/pkg/kms"
	"github.com/aethercode/aethercode/libs/pkg/pagination"
	"github.com/aethercode/aethercode/libs/pkg/storage"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	maximumTags              = 50
	maximumSupportedLanguage = 32
	maximumPromptRunes       = 200000
	maximumObjectKeyBytes    = 1024
	maximumKeyReferenceBytes = 1024
)

var (
	questionSlugPattern = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)
	languagePattern     = regexp.MustCompile(`^[a-z0-9][a-z0-9+_.-]{0,79}$`)
	checksumPattern     = regexp.MustCompile(`^[0-9a-f]{64}$`)
	objectKeyPattern    = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._/=@+-]*$`)
	keyReferencePattern = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9+.-]*:[A-Za-z0-9._:/=@+-]+$`)
)

// Store is the service-owned PostgreSQL port. Implementations receive an
// already authorized transaction and must never create an unscoped one.
type Store interface {
	ClaimIdempotency(context.Context, pgx.Tx, IdempotencyClaim) (json.RawMessage, bool, error)
	CompleteIdempotency(context.Context, pgx.Tx, IdempotencyClaim, int, json.RawMessage) error
	CreateQuestion(context.Context, pgx.Tx, CreateQuestion) (QuestionDetail, error)
	CreateDraftQuestionVersion(context.Context, pgx.Tx, CreateDraftQuestionVersion) (QuestionDetail, error)
	UpsertTestCaseManifest(context.Context, pgx.Tx, UpsertTestCaseManifest) (QuestionVersion, error)
	AddQuestionAsset(context.Context, pgx.Tx, AddQuestionAsset) (QuestionVersion, error)
	ReplaceQuestionVersionTags(context.Context, pgx.Tx, ReplaceQuestionVersionTags) (QuestionVersion, error)
	PublishQuestionVersion(context.Context, pgx.Tx, PublishQuestionVersion) (QuestionDetail, error)
	ArchiveQuestion(context.Context, pgx.Tx, ArchiveQuestion) (QuestionDetail, error)
	GetPublishedQuestion(context.Context, pgx.Tx, string) (QuestionDetail, error)
	GetQuestionVersion(context.Context, pgx.Tx, string) (QuestionVersion, error)
	GetQuestionIncludeDeleted(context.Context, pgx.Tx, string) (Question, error)
	GetQuestionVersionIncludeDeleted(context.Context, pgx.Tx, string) (QuestionVersion, error)
	ListPublishedQuestions(context.Context, pgx.Tx, ListPublishedQuestions) ([]QuestionDetail, error)
	ListQuestionVersions(context.Context, pgx.Tx, ListQuestionVersions) ([]QuestionVersion, error)
	SoftDeleteQuestion(context.Context, pgx.Tx, DeleteQuestion) error
	HardDeleteQuestion(context.Context, pgx.Tx, DeleteQuestion) error
	SoftDeleteQuestionVersion(context.Context, pgx.Tx, DeleteQuestionVersion) error
	HardDeleteQuestionVersion(context.Context, pgx.Tx, DeleteQuestionVersion) error
	// GetAssetObjectRef returns the storage key, encryption key reference, and
	// content-type for a specific asset attached to a question version.
	GetAssetObjectRef(context.Context, pgx.Tx, string, string) (objectKey, encKeyRef, contentType string, err error)
	// GetBundleObjectRef returns the storage key and encryption key reference for
	// the evaluation bundle of a question version.
	GetBundleObjectRef(context.Context, pgx.Tx, string) (objectKey, encKeyRef string, err error)
	Ping(context.Context) error
}

// AssetContent is the decrypted content of a question asset or bundle.
type AssetContent struct {
	Data        []byte
	ContentType string
}

// GetAssetCmd identifies one asset to retrieve.
type GetAssetCmd struct {
	QuestionVersionID string
	AssetKind         string
}

// GetBundleCmd identifies the evaluation bundle to retrieve.
type GetBundleCmd struct {
	QuestionVersionID string
}

type ObjectReference struct {
	ObjectKey              string `json:"object_key"`
	Checksum               string `json:"checksum"`
	EncryptionKeyReference string `json:"encryption_key_reference"`
}

// Tag is the normalized global tag associated with a version. It deliberately
// contains no tenant ownership because Question Bank content is global.
type Tag struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type VersionContent struct {
	Title              string          `json:"title"`
	PromptMarkdown     string          `json:"prompt_markdown"`
	Difficulty         string          `json:"difficulty"`
	SupportedLanguages []string        `json:"supported_languages"`
	TimeLimitMS        int             `json:"time_limit_ms"`
	MemoryLimitKiB     int             `json:"memory_limit_kib"`
	EvaluationBundle   ObjectReference `json:"evaluation_bundle"`
	Tags               []Tag           `json:"tags"`
}

type Question struct {
	ID             string     `json:"id"`
	Slug           string     `json:"slug"`
	LifecycleState string     `json:"lifecycle_state"`
	CreatedAt      time.Time  `json:"created_at"`
	ArchivedAt     *time.Time `json:"archived_at,omitempty"`
	Version        int64      `json:"version"`
}

// QuestionVersion is intentionally metadata-only. Encrypted object keys,
// checksums, and KMS references are accepted on writes but never returned by
// the browser-facing API; object access is separately controlled.
type QuestionVersion struct {
	ID                  string     `json:"id"`
	QuestionID          string     `json:"question_id"`
	VersionNumber       int        `json:"version_number"`
	Title               string     `json:"title"`
	PromptMarkdown      string     `json:"prompt_markdown"`
	Difficulty          string     `json:"difficulty"`
	SupportedLanguages  []string   `json:"supported_languages"`
	TimeLimitMS         int        `json:"time_limit_ms"`
	MemoryLimitKiB      int        `json:"memory_limit_kib"`
	Status              string     `json:"status"`
	PublishedAt         *time.Time `json:"published_at,omitempty"`
	CreatedAt           time.Time  `json:"created_at"`
	Version             int64      `json:"version"`
	Tags                []Tag      `json:"tags"`
	SampleTestCaseCount int        `json:"sample_test_case_count"`
	HiddenTestCaseCount int        `json:"hidden_test_case_count"`
	AssetCount          int        `json:"asset_count"`
}

type QuestionDetail struct {
	Question        Question        `json:"question"`
	QuestionVersion QuestionVersion `json:"question_version"`
}

// Page is the generic keyset-paginated response used by collection endpoints.
type Page[T any] struct {
	Items      []T    `json:"items"`
	NextCursor string `json:"next_cursor,omitempty"`
}

// ListPublishedQuestions is Class B: Question Bank content is tenant-global, so
// require_read_context plus RLS is the whole authorization story.
type ListPublishedQuestions struct {
	Limit      int
	CursorSort string
	CursorID   string
	Difficulty string
	Tag        string
	Language   string
}

// ListQuestionVersions lists versions of a specific question with cursor pagination.
type ListQuestionVersions struct {
	QuestionID string
	Limit      int
	CursorSort string
	CursorID   string
	Status     string
}

type WriteCommand struct {
	IdempotencyKey string
}

type CreateQuestion struct {
	WriteCommand
	ID        string
	VersionID string
	EventID   string
	Slug      string
	Content   VersionContent
}

type CreateDraftQuestionVersion struct {
	WriteCommand
	ID                       string
	EventID                  string
	QuestionID               string
	ExpectedQuestionRevision int64
	Content                  VersionContent
}

type UpsertTestCaseManifest struct {
	WriteCommand
	ID                      string
	QuestionVersionID       string
	ManifestKind            string
	ObjectReference         ObjectReference
	TestCaseCount           int
	ExpectedQuestionVersion int64
}

type AddQuestionAsset struct {
	WriteCommand
	ID                      string
	QuestionVersionID       string
	AssetKind               string
	ObjectReference         ObjectReference
	ContentType             string
	ByteSize                int64
	ExpectedQuestionVersion int64
}

type ReplaceQuestionVersionTags struct {
	WriteCommand
	QuestionVersionID       string
	ExpectedQuestionVersion int64
	Tags                    []Tag
}

type PublishQuestionVersion struct {
	WriteCommand
	QuestionVersionID       string
	EventID                 string
	ExpectedQuestionVersion int64
}

type ArchiveQuestion struct {
	WriteCommand
	QuestionID               string
	EventID                  string
	ExpectedQuestionRevision int64
}

type DeleteQuestion struct {
	ID      string
	ActorID string
	Reason  string
}

type DeleteQuestionVersion struct {
	ID      string
	ActorID string
	Reason  string
}

// IdempotencyClaim is private persistence data. The operation includes the
// actor to prevent one global author from consuming another author's key.
type IdempotencyClaim struct {
	Operation   string
	Key         string
	RequestHash string
}

type Service struct {
	pool    *pgxpool.Pool
	store   Store
	storage storage.Object
	kms     kms.KeyManager
}

// NewService creates a new Question Bank service. storage and kms may both be
// nil; content retrieval endpoints return 503 Unavailable until they are wired.
func NewService(pool *pgxpool.Pool, store Store, storage storage.Object, kms kms.KeyManager) (*Service, error) {
	if pool == nil || store == nil {
		return nil, fmt.Errorf("question-bank database pool and store are required")
	}
	return &Service{pool: pool, store: store, storage: storage, kms: kms}, nil
}

func (service *Service) CreateQuestion(contextValue context.Context, capability centralauthz.Capability, command CreateQuestion) (QuestionDetail, error) {
	command.Slug = strings.ToLower(strings.TrimSpace(command.Slug))
	if !isUUID(command.ID) || !isUUID(command.VersionID) || !isUUID(command.EventID) || !questionSlugPattern.MatchString(command.Slug) {
		return QuestionDetail{}, apperrors.New(apperrors.CodeInvalidArgument, "question identifiers or slug are invalid")
	}
	if err := normalizeVersionContent(&command.Content); err != nil {
		return QuestionDetail{}, err
	}
	return runWrite(service, contextValue, capability, "question.create", command.IdempotencyKey,
		struct {
			Slug    string                    `json:"slug"`
			Content versionContentFingerprint `json:"content"`
		}{Slug: command.Slug, Content: fingerprintVersionContent(command.Content)}, 201,
		func(transaction pgx.Tx) (QuestionDetail, error) {
			return service.store.CreateQuestion(contextValue, transaction, command)
		},
	)
}

func (service *Service) CreateDraftQuestionVersion(contextValue context.Context, capability centralauthz.Capability, command CreateDraftQuestionVersion) (QuestionDetail, error) {
	if !isUUID(command.ID) || !isUUID(command.EventID) || !isUUID(command.QuestionID) || command.ExpectedQuestionRevision <= 0 {
		return QuestionDetail{}, apperrors.New(apperrors.CodeInvalidArgument, "question version identifiers or expected revision are invalid")
	}
	if err := normalizeVersionContent(&command.Content); err != nil {
		return QuestionDetail{}, err
	}
	return runWrite(service, contextValue, capability, "question.version.create", command.IdempotencyKey,
		struct {
			QuestionID               string                    `json:"question_id"`
			ExpectedQuestionRevision int64                     `json:"expected_question_revision"`
			Content                  versionContentFingerprint `json:"content"`
		}{QuestionID: command.QuestionID, ExpectedQuestionRevision: command.ExpectedQuestionRevision, Content: fingerprintVersionContent(command.Content)}, 201,
		func(transaction pgx.Tx) (QuestionDetail, error) {
			return service.store.CreateDraftQuestionVersion(contextValue, transaction, command)
		},
	)
}

func (service *Service) UpsertTestCaseManifest(contextValue context.Context, capability centralauthz.Capability, command UpsertTestCaseManifest) (QuestionVersion, error) {
	command.ManifestKind = strings.ToLower(strings.TrimSpace(command.ManifestKind))
	if !isUUID(command.ID) || !isUUID(command.QuestionVersionID) || command.ExpectedQuestionVersion <= 0 || command.TestCaseCount <= 0 || (command.ManifestKind != "sample" && command.ManifestKind != "hidden") {
		return QuestionVersion{}, apperrors.New(apperrors.CodeInvalidArgument, "test manifest fields are invalid")
	}
	if err := normalizeObjectReference(&command.ObjectReference); err != nil {
		return QuestionVersion{}, err
	}
	return runWrite(service, contextValue, capability, "question.manifest.upsert", command.IdempotencyKey,
		struct {
			QuestionVersionID       string          `json:"question_version_id"`
			ManifestKind            string          `json:"manifest_kind"`
			ObjectReference         ObjectReference `json:"object_reference"`
			TestCaseCount           int             `json:"test_case_count"`
			ExpectedQuestionVersion int64           `json:"expected_question_version"`
		}{command.QuestionVersionID, command.ManifestKind, command.ObjectReference, command.TestCaseCount, command.ExpectedQuestionVersion}, 200,
		func(transaction pgx.Tx) (QuestionVersion, error) {
			return service.store.UpsertTestCaseManifest(contextValue, transaction, command)
		},
	)
}

func (service *Service) AddQuestionAsset(contextValue context.Context, capability centralauthz.Capability, command AddQuestionAsset) (QuestionVersion, error) {
	command.AssetKind = strings.ToLower(strings.TrimSpace(command.AssetKind))
	command.ContentType = strings.TrimSpace(command.ContentType)
	if !isUUID(command.ID) || !isUUID(command.QuestionVersionID) || command.ExpectedQuestionVersion <= 0 || command.ByteSize <= 0 || len(command.ContentType) == 0 || len(command.ContentType) > 180 || (command.AssetKind != "attachment" && command.AssetKind != "starter_code" && command.AssetKind != "reference_solution") {
		return QuestionVersion{}, apperrors.New(apperrors.CodeInvalidArgument, "question asset fields are invalid")
	}
	if err := normalizeObjectReference(&command.ObjectReference); err != nil {
		return QuestionVersion{}, err
	}
	return runWrite(service, contextValue, capability, "question.asset.create", command.IdempotencyKey,
		struct {
			QuestionVersionID       string          `json:"question_version_id"`
			AssetKind               string          `json:"asset_kind"`
			ObjectReference         ObjectReference `json:"object_reference"`
			ContentType             string          `json:"content_type"`
			ByteSize                int64           `json:"byte_size"`
			ExpectedQuestionVersion int64           `json:"expected_question_version"`
		}{command.QuestionVersionID, command.AssetKind, command.ObjectReference, command.ContentType, command.ByteSize, command.ExpectedQuestionVersion}, 201,
		func(transaction pgx.Tx) (QuestionVersion, error) {
			return service.store.AddQuestionAsset(contextValue, transaction, command)
		},
	)
}

func (service *Service) ReplaceQuestionVersionTags(contextValue context.Context, capability centralauthz.Capability, command ReplaceQuestionVersionTags) (QuestionVersion, error) {
	if !isUUID(command.QuestionVersionID) || command.ExpectedQuestionVersion <= 0 {
		return QuestionVersion{}, apperrors.New(apperrors.CodeInvalidArgument, "question version identifier or expected revision is invalid")
	}
	if err := normalizeTags(&command.Tags); err != nil {
		return QuestionVersion{}, err
	}
	return runWrite(service, contextValue, capability, "question.tags.replace", command.IdempotencyKey,
		struct {
			QuestionVersionID       string   `json:"question_version_id"`
			ExpectedQuestionVersion int64    `json:"expected_question_version"`
			Tags                    []string `json:"tags"`
		}{command.QuestionVersionID, command.ExpectedQuestionVersion, tagNames(command.Tags)}, 200,
		func(transaction pgx.Tx) (QuestionVersion, error) {
			return service.store.ReplaceQuestionVersionTags(contextValue, transaction, command)
		},
	)
}

func (service *Service) PublishQuestionVersion(contextValue context.Context, capability centralauthz.Capability, command PublishQuestionVersion) (QuestionDetail, error) {
	if !isUUID(command.QuestionVersionID) || !isUUID(command.EventID) || command.ExpectedQuestionVersion <= 0 {
		return QuestionDetail{}, apperrors.New(apperrors.CodeInvalidArgument, "question version publication fields are invalid")
	}
	return runWrite(service, contextValue, capability, "question.version.publish", command.IdempotencyKey,
		struct {
			QuestionVersionID       string `json:"question_version_id"`
			ExpectedQuestionVersion int64  `json:"expected_question_version"`
		}{command.QuestionVersionID, command.ExpectedQuestionVersion}, 200,
		func(transaction pgx.Tx) (QuestionDetail, error) {
			return service.store.PublishQuestionVersion(contextValue, transaction, command)
		},
	)
}

func (service *Service) ArchiveQuestion(contextValue context.Context, capability centralauthz.Capability, command ArchiveQuestion) (QuestionDetail, error) {
	if !isUUID(command.QuestionID) || !isUUID(command.EventID) || command.ExpectedQuestionRevision <= 0 {
		return QuestionDetail{}, apperrors.New(apperrors.CodeInvalidArgument, "question archive fields are invalid")
	}
	return runWrite(service, contextValue, capability, "question.archive", command.IdempotencyKey,
		struct {
			QuestionID               string `json:"question_id"`
			ExpectedQuestionRevision int64  `json:"expected_question_revision"`
		}{command.QuestionID, command.ExpectedQuestionRevision}, 200,
		func(transaction pgx.Tx) (QuestionDetail, error) {
			return service.store.ArchiveQuestion(contextValue, transaction, command)
		},
	)
}

func (service *Service) GetPublishedQuestion(contextValue context.Context, capability centralauthz.Capability, questionID string) (QuestionDetail, error) {
	if !isUUID(questionID) {
		return QuestionDetail{}, apperrors.New(apperrors.CodeInvalidArgument, "question ID must be a UUID")
	}
	var result QuestionDetail
	err := database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		var err error
		result, err = service.store.GetPublishedQuestion(contextValue, transaction, questionID)
		return err
	})
	return result, err
}

func (service *Service) GetQuestionVersion(contextValue context.Context, capability centralauthz.Capability, questionVersionID string) (QuestionVersion, error) {
	if !isUUID(questionVersionID) {
		return QuestionVersion{}, apperrors.New(apperrors.CodeInvalidArgument, "question version ID must be a UUID")
	}
	var result QuestionVersion
	err := database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		var err error
		result, err = service.store.GetQuestionVersion(contextValue, transaction, questionVersionID)
		return err
	})
	return result, err
}

func (service *Service) ListPublishedQuestions(contextValue context.Context, capability centralauthz.Capability, command ListPublishedQuestions) (Page[QuestionDetail], error) {
	if command.Limit < 1 || command.Limit > 100 {
		return Page[QuestionDetail]{}, apperrors.New(apperrors.CodeInvalidArgument, "question listing limit must be between 1 and 100")
	}
	if command.CursorSort != "" {
		if _, err := time.Parse(time.RFC3339Nano, command.CursorSort); err != nil {
			return Page[QuestionDetail]{}, apperrors.New(apperrors.CodeInvalidArgument, "cursor contains an invalid timestamp")
		}
	}
	var page Page[QuestionDetail]
	err := database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		probe := command
		probe.Limit = command.Limit + 1
		questions, err := service.store.ListPublishedQuestions(contextValue, transaction, probe)
		if err != nil {
			return err
		}
		page = Page[QuestionDetail]{Items: []QuestionDetail{}}
		if len(questions) > command.Limit {
			questions = questions[:command.Limit]
			last := questions[len(questions)-1]
			if last.QuestionVersion.PublishedAt == nil {
				return fmt.Errorf("list questions: published question has nil published_at")
			}
			page.NextCursor = pagination.Encode(pagination.EncodeTime(*last.QuestionVersion.PublishedAt), last.QuestionVersion.ID)
		}
		page.Items = append(page.Items, questions...)
		return nil
	})
	if err != nil {
		return Page[QuestionDetail]{}, err
	}
	return page, nil
}

func (service *Service) ListQuestionVersions(contextValue context.Context, capability centralauthz.Capability, command ListQuestionVersions) (Page[QuestionVersion], error) {
	if command.Limit < 1 || command.Limit > 100 {
		return Page[QuestionVersion]{}, apperrors.New(apperrors.CodeInvalidArgument, "question version listing limit must be between 1 and 100")
	}
	if command.CursorSort != "" {
		if _, err := strconv.ParseInt(command.CursorSort, 10, 64); err != nil {
			return Page[QuestionVersion]{}, apperrors.New(apperrors.CodeInvalidArgument, "cursor contains an invalid version number")
		}
	}
	var page Page[QuestionVersion]
	err := database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		probe := command
		probe.Limit = command.Limit + 1
		versions, err := service.store.ListQuestionVersions(contextValue, transaction, probe)
		if err != nil {
			return err
		}
		page = Page[QuestionVersion]{Items: []QuestionVersion{}}
		if len(versions) > command.Limit {
			versions = versions[:command.Limit]
			last := versions[len(versions)-1]
			page.NextCursor = pagination.Encode(pagination.FormatInt(int64(last.VersionNumber)), last.ID)
		}
		page.Items = append(page.Items, versions...)
		return nil
	})
	if err != nil {
		return Page[QuestionVersion]{}, err
	}
	return page, nil
}

func runWrite[T any](
	service *Service,
	contextValue context.Context,
	capability centralauthz.Capability,
	operation, key string,
	fingerprint any,
	status int,
	work func(pgx.Tx) (T, error),
) (T, error) {
	var result T
	key = strings.TrimSpace(key)
	if !validIdempotencyKey(key) {
		return result, apperrors.New(apperrors.CodeInvalidArgument, "Idempotency-Key is required and must contain 1 to 255 printable characters")
	}
	serialized, err := json.Marshal(fingerprint)
	if err != nil {
		return result, fmt.Errorf("encode idempotency fingerprint: %w", err)
	}
	fingerprintHash := sha256.Sum256(serialized)
	claim := IdempotencyClaim{
		Operation:   operation + ":" + strings.ToLower(strings.TrimSpace(capability.ActorID)),
		Key:         key,
		RequestHash: hex.EncodeToString(fingerprintHash[:]),
	}
	err = database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		cached, completed, claimErr := service.store.ClaimIdempotency(contextValue, transaction, claim)
		if claimErr != nil {
			return claimErr
		}
		if completed {
			if err := json.Unmarshal(cached, &result); err != nil {
				return fmt.Errorf("decode idempotent response: %w", err)
			}
			return nil
		}
		result, err = work(transaction)
		if err != nil {
			return err
		}
		response, err := json.Marshal(result)
		if err != nil {
			return fmt.Errorf("encode idempotent response: %w", err)
		}
		return service.store.CompleteIdempotency(contextValue, transaction, claim, status, response)
	})
	return result, err
}

func normalizeVersionContent(content *VersionContent) error {
	if content == nil {
		return apperrors.New(apperrors.CodeInvalidArgument, "question version content is required")
	}
	content.Title = strings.TrimSpace(content.Title)
	content.PromptMarkdown = strings.TrimSpace(content.PromptMarkdown)
	content.Difficulty = strings.ToLower(strings.TrimSpace(content.Difficulty))
	if runeCount(content.Title) < 1 || runeCount(content.Title) > 300 || runeCount(content.PromptMarkdown) < 1 || runeCount(content.PromptMarkdown) > maximumPromptRunes || (content.Difficulty != "easy" && content.Difficulty != "medium" && content.Difficulty != "hard") || content.TimeLimitMS < 50 || content.TimeLimitMS > 600000 || content.MemoryLimitKiB < 1024 || content.MemoryLimitKiB > 4194304 {
		return apperrors.New(apperrors.CodeInvalidArgument, "question version content is invalid")
	}
	if err := normalizeLanguages(&content.SupportedLanguages); err != nil {
		return err
	}
	if err := normalizeObjectReference(&content.EvaluationBundle); err != nil {
		return err
	}
	return normalizeTags(&content.Tags)
}

// versionContentFingerprint excludes generated tag IDs. An identical retry
// must bind to the same idempotency record even though the first attempt
// assigns UUIDv7 IDs to new global tags.
type versionContentFingerprint struct {
	Title              string          `json:"title"`
	PromptMarkdown     string          `json:"prompt_markdown"`
	Difficulty         string          `json:"difficulty"`
	SupportedLanguages []string        `json:"supported_languages"`
	TimeLimitMS        int             `json:"time_limit_ms"`
	MemoryLimitKiB     int             `json:"memory_limit_kib"`
	EvaluationBundle   ObjectReference `json:"evaluation_bundle"`
	Tags               []string        `json:"tags"`
}

func fingerprintVersionContent(content VersionContent) versionContentFingerprint {
	return versionContentFingerprint{
		Title: content.Title, PromptMarkdown: content.PromptMarkdown,
		Difficulty: content.Difficulty, SupportedLanguages: content.SupportedLanguages,
		TimeLimitMS: content.TimeLimitMS, MemoryLimitKiB: content.MemoryLimitKiB,
		EvaluationBundle: content.EvaluationBundle, Tags: tagNames(content.Tags),
	}
}

func tagNames(tags []Tag) []string {
	names := make([]string, len(tags))
	for index, tag := range tags {
		names[index] = tag.Name
	}
	return names
}

func normalizeLanguages(languages *[]string) error {
	if languages == nil || len(*languages) == 0 || len(*languages) > maximumSupportedLanguage {
		return apperrors.New(apperrors.CodeInvalidArgument, "supported languages must contain 1 to 32 values")
	}
	seen := make(map[string]struct{}, len(*languages))
	for index, language := range *languages {
		language = strings.ToLower(strings.TrimSpace(language))
		if !languagePattern.MatchString(language) {
			return apperrors.New(apperrors.CodeInvalidArgument, "supported language is invalid")
		}
		if _, duplicate := seen[language]; duplicate {
			return apperrors.New(apperrors.CodeInvalidArgument, "supported languages must be unique")
		}
		seen[language] = struct{}{}
		(*languages)[index] = language
	}
	sort.Strings(*languages)
	return nil
}

func normalizeTags(tags *[]Tag) error {
	if tags == nil {
		return apperrors.New(apperrors.CodeInvalidArgument, "tags are required")
	}
	if len(*tags) > maximumTags {
		return apperrors.New(apperrors.CodeInvalidArgument, "a question version may have at most 50 tags")
	}
	seen := make(map[string]struct{}, len(*tags))
	normalized := make([]Tag, 0, len(*tags))
	for _, tag := range *tags {
		tag.Name = strings.ToLower(strings.TrimSpace(tag.Name))
		if runeCount(tag.Name) < 1 || runeCount(tag.Name) > 80 || containsControl(tag.Name) {
			return apperrors.New(apperrors.CodeInvalidArgument, "tag is invalid")
		}
		if _, duplicate := seen[tag.Name]; duplicate {
			continue
		}
		id, err := database.NewUUIDv7()
		if err != nil {
			return fmt.Errorf("generate tag ID: %w", err)
		}
		tag.ID = id
		seen[tag.Name] = struct{}{}
		normalized = append(normalized, tag)
	}
	sort.Slice(normalized, func(left, right int) bool { return normalized[left].Name < normalized[right].Name })
	*tags = normalized
	return nil
}

func normalizeObjectReference(reference *ObjectReference) error {
	if reference == nil {
		return apperrors.New(apperrors.CodeInvalidArgument, "encrypted object reference is required")
	}
	reference.ObjectKey = strings.TrimSpace(reference.ObjectKey)
	reference.Checksum = strings.ToLower(strings.TrimSpace(reference.Checksum))
	reference.EncryptionKeyReference = strings.TrimSpace(reference.EncryptionKeyReference)
	if len(reference.ObjectKey) > maximumObjectKeyBytes || !objectKeyPattern.MatchString(reference.ObjectKey) || strings.Contains(reference.ObjectKey, "..") || !checksumPattern.MatchString(reference.Checksum) || len(reference.EncryptionKeyReference) > maximumKeyReferenceBytes || !keyReferencePattern.MatchString(reference.EncryptionKeyReference) {
		return apperrors.New(apperrors.CodeInvalidArgument, "encrypted object reference is invalid")
	}
	return nil
}

func validIdempotencyKey(key string) bool {
	if len(key) < 1 || len(key) > 255 {
		return false
	}
	for _, character := range key {
		if character < 33 || character > 126 {
			return false
		}
	}
	return true
}

func containsControl(value string) bool {
	for _, character := range value {
		if unicode.IsControl(character) {
			return true
		}
	}
	return false
}

func runeCount(value string) int { return len([]rune(value)) }

func (service *Service) DeleteQuestion(contextValue context.Context, capability centralauthz.Capability, command DeleteQuestion) error {
	command.Reason = strings.TrimSpace(command.Reason)
	if !isUUID(command.ID) || !isUUID(command.ActorID) || command.Reason == "" {
		return apperrors.New(apperrors.CodeInvalidArgument, "question ID, actor ID, and deletion reason are required")
	}

	return database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		_, err := service.store.GetPublishedQuestion(contextValue, transaction, command.ID)
		if err != nil {
			return fmt.Errorf("get question: %w", err)
		}

		if err := service.store.SoftDeleteQuestion(contextValue, transaction, command); err != nil {
			return fmt.Errorf("soft delete question: %w", err)
		}

		return nil
	})
}

func (service *Service) HardDeleteQuestion(contextValue context.Context, capability centralauthz.Capability, command DeleteQuestion) error {
	command.Reason = strings.TrimSpace(command.Reason)
	if !isUUID(command.ID) || !isUUID(command.ActorID) || command.Reason == "" {
		return apperrors.New(apperrors.CodeInvalidArgument, "question ID, actor ID, and deletion reason are required")
	}

	return database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		_, err := service.store.GetQuestionIncludeDeleted(contextValue, transaction, command.ID)
		if err != nil {
			return fmt.Errorf("get question: %w", err)
		}

		if err := service.store.HardDeleteQuestion(contextValue, transaction, command); err != nil {
			return fmt.Errorf("hard delete question: %w", err)
		}

		return nil
	})
}

func (service *Service) DeleteQuestionVersion(contextValue context.Context, capability centralauthz.Capability, command DeleteQuestionVersion) error {
	command.Reason = strings.TrimSpace(command.Reason)
	if !isUUID(command.ID) || !isUUID(command.ActorID) || command.Reason == "" {
		return apperrors.New(apperrors.CodeInvalidArgument, "question version ID, actor ID, and deletion reason are required")
	}

	return database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		_, err := service.store.GetQuestionVersion(contextValue, transaction, command.ID)
		if err != nil {
			return fmt.Errorf("get question version: %w", err)
		}

		if err := service.store.SoftDeleteQuestionVersion(contextValue, transaction, command); err != nil {
			return fmt.Errorf("soft delete question version: %w", err)
		}

		return nil
	})
}

func (service *Service) HardDeleteQuestionVersion(contextValue context.Context, capability centralauthz.Capability, command DeleteQuestionVersion) error {
	command.Reason = strings.TrimSpace(command.Reason)
	if !isUUID(command.ID) || !isUUID(command.ActorID) || command.Reason == "" {
		return apperrors.New(apperrors.CodeInvalidArgument, "question version ID, actor ID, and deletion reason are required")
	}

	return database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		_, err := service.store.GetQuestionVersionIncludeDeleted(contextValue, transaction, command.ID)
		if err != nil {
			return fmt.Errorf("get question version: %w", err)
		}

		if err := service.store.HardDeleteQuestionVersion(contextValue, transaction, command); err != nil {
			return fmt.Errorf("hard delete question version: %w", err)
		}

		return nil
	})
}

// GetAsset fetches, decrypts, and returns a named asset for a question version.
// Returns CodeUnavailable when storage or KMS is not configured.
func (service *Service) GetAsset(contextValue context.Context, capability centralauthz.Capability, cmd GetAssetCmd) (AssetContent, error) {
	if service.storage == nil || service.kms == nil {
		return AssetContent{}, apperrors.New(apperrors.CodeUnavailable, "content storage is not configured on this instance")
	}
	if !isUUID(cmd.QuestionVersionID) {
		return AssetContent{}, apperrors.New(apperrors.CodeInvalidArgument, "question version ID must be a UUID")
	}
	cmd.AssetKind = strings.TrimSpace(cmd.AssetKind)
	if cmd.AssetKind != "attachment" && cmd.AssetKind != "starter_code" && cmd.AssetKind != "reference_solution" {
		return AssetContent{}, apperrors.New(apperrors.CodeInvalidArgument, "asset_kind must be attachment, starter_code, or reference_solution")
	}

	var objectKey, encKeyRef, contentType string
	err := database.WithTenantTx(contextValue, service.pool, capability, func(tx pgx.Tx) error {
		var err error
		objectKey, encKeyRef, contentType, err = service.store.GetAssetObjectRef(contextValue, tx, cmd.QuestionVersionID, cmd.AssetKind)
		return err
	})
	if err != nil {
		return AssetContent{}, err
	}

	reader, err := service.storage.Get(contextValue, objectKey)
	if err != nil {
		return AssetContent{}, fmt.Errorf("storage get asset: %w", err)
	}
	defer func() { _ = reader.Close() }()

	ciphertext, err := io.ReadAll(reader)
	if err != nil {
		return AssetContent{}, fmt.Errorf("read asset: %w", err)
	}

	plaintext, err := service.kms.Decrypt(contextValue, ciphertext, encKeyRef)
	if err != nil {
		return AssetContent{}, fmt.Errorf("decrypt asset: %w", err)
	}
	return AssetContent{Data: plaintext, ContentType: contentType}, nil
}

// GetBundle fetches, decrypts, and returns the evaluation bundle for a question version.
// Returns CodeUnavailable when storage or KMS is not configured.
func (service *Service) GetBundle(contextValue context.Context, capability centralauthz.Capability, cmd GetBundleCmd) ([]byte, error) {
	if service.storage == nil || service.kms == nil {
		return nil, apperrors.New(apperrors.CodeUnavailable, "content storage is not configured on this instance")
	}
	if !isUUID(cmd.QuestionVersionID) {
		return nil, apperrors.New(apperrors.CodeInvalidArgument, "question version ID must be a UUID")
	}

	var objectKey, encKeyRef string
	err := database.WithTenantTx(contextValue, service.pool, capability, func(tx pgx.Tx) error {
		var err error
		objectKey, encKeyRef, err = service.store.GetBundleObjectRef(contextValue, tx, cmd.QuestionVersionID)
		return err
	})
	if err != nil {
		return nil, err
	}

	reader, err := service.storage.Get(contextValue, objectKey)
	if err != nil {
		return nil, fmt.Errorf("storage get bundle: %w", err)
	}
	defer func() { _ = reader.Close() }()

	ciphertext, err := io.ReadAll(reader)
	if err != nil {
		return nil, fmt.Errorf("read bundle: %w", err)
	}

	plaintext, err := service.kms.Decrypt(contextValue, ciphertext, encKeyRef)
	if err != nil {
		return nil, fmt.Errorf("decrypt bundle: %w", err)
	}
	return plaintext, nil
}

func isUUID(value string) bool {
	value = strings.ToLower(strings.TrimSpace(value))
	if len(value) != 36 {
		return false
	}
	for index, character := range value {
		if index == 8 || index == 13 || index == 18 || index == 23 {
			if character != '-' {
				return false
			}
			continue
		}
		//nolint:staticcheck // QF1001: the negated-range form reads more clearly for character validation
		if !(character >= '0' && character <= '9') && !(character >= 'a' && character <= 'f') {
			return false
		}
	}
	return true
}
