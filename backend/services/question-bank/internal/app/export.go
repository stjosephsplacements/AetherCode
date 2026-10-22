package app

import (
	"context"
	"encoding/json"

	centralauthz "github.com/aethercode/aethercode/libs/pkg/authz"
	"github.com/aethercode/aethercode/libs/pkg/database"
	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
	"github.com/aethercode/aethercode/libs/pkg/evalbundle"
	"github.com/jackc/pgx/v5"
)

// QuestionExportFormat names the portable question file (ADR-0032). The
// staff frontend imports it through the ordinary authoring endpoints.
const QuestionExportFormat = "aethercode.question.v1"

// maxBundleBytes bounds one encrypted bundle: up to 100 tests of 1 MiB input
// and output each, plus the envelope.
const maxBundleBytes = 210 << 20

// QuestionExport is a question with every test, hidden ones included.
type QuestionExport struct {
	Format             string       `json:"format"`
	Title              string       `json:"title"`
	PromptMarkdown     string       `json:"prompt_markdown"`
	Difficulty         string       `json:"difficulty"`
	SupportedLanguages []string     `json:"supported_languages"`
	TimeLimitMS        int          `json:"time_limit_ms"`
	MemoryLimitKiB     int          `json:"memory_limit_kib"`
	Tests              []ExportTest `json:"tests"`
}

type ExportTest struct {
	Input          string `json:"input"`
	ExpectedOutput string `json:"expected_output"`
	Sample         bool   `json:"sample"`
	Weight         int    `json:"weight"`
}

// StoredExport is export_question_version's JSON.
type StoredExport struct {
	Title              string           `json:"title"`
	PromptMarkdown     string           `json:"prompt_markdown"`
	Difficulty         string           `json:"difficulty"`
	SupportedLanguages []string         `json:"supported_languages"`
	TimeLimitMS        int              `json:"time_limit_ms"`
	MemoryLimitKiB     int              `json:"memory_limit_kib"`
	Evaluation         *BundleReference `json:"evaluation"`
	Sample             *BundleReference `json:"sample"`
}

// BundleReference locates one encrypted bundle. Unlike ObjectReference it
// decodes the key reference: it comes from the database, never a client.
type BundleReference struct {
	ObjectKey              string `json:"object_key"`
	Checksum               string `json:"checksum"`
	EncryptionKeyReference string `json:"encryption_key_reference"`
}

// ExportQuestionVersion records the export and returns the question with its
// tests. Only college and platform administrators obtain the capability.
func (service *Service) ExportQuestionVersion(contextValue context.Context, capability centralauthz.Capability, questionVersionID string) (QuestionExport, error) {
	if !isUUID(questionVersionID) {
		return QuestionExport{}, apperrors.New(apperrors.CodeInvalidArgument, "question version identifier is invalid")
	}
	eventID, err := database.NewUUIDv7()
	if err != nil {
		return QuestionExport{}, err
	}
	var stored StoredExport
	err = database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		var storeErr error
		stored, storeErr = service.store.ExportQuestionVersion(contextValue, transaction, eventID, questionVersionID)
		return storeErr
	})
	if err != nil {
		return QuestionExport{}, err
	}
	if stored.Evaluation == nil || stored.Sample == nil {
		return QuestionExport{}, apperrors.New(apperrors.CodeConflict, "this question has no tests to export yet")
	}
	evaluation, err := service.readBundle(contextValue, *stored.Evaluation)
	if err != nil {
		return QuestionExport{}, err
	}
	sample, err := service.readBundle(contextValue, *stored.Sample)
	if err != nil {
		return QuestionExport{}, err
	}
	languages := stored.SupportedLanguages
	if languages == nil {
		languages = []string{}
	}
	return QuestionExport{
		Format: QuestionExportFormat, Title: stored.Title, PromptMarkdown: stored.PromptMarkdown, Difficulty: stored.Difficulty,
		SupportedLanguages: languages, TimeLimitMS: stored.TimeLimitMS, MemoryLimitKiB: stored.MemoryLimitKiB,
		Tests: markSamples(evaluation.TestCases, sample.TestCases),
	}, nil
}

// markSamples flags the evaluation tests that are samples. The sample bundle
// holds them in the evaluation bundle's order, so one pass matches them.
func markSamples(all, samples []evalbundle.TestCase) []ExportTest {
	tests := make([]ExportTest, len(all))
	next := 0
	for index, test := range all {
		isSample := next < len(samples) && samples[next] == test
		if isSample {
			next++
		}
		tests[index] = ExportTest{Input: test.Stdin, ExpectedOutput: test.ExpectedOutput, Sample: isSample, Weight: test.Weight}
	}
	return tests
}

// readBundle fetches, verifies, decrypts and parses one test bundle.
func (service *Service) readBundle(contextValue context.Context, reference BundleReference) (evalbundle.Bundle, error) {
	plaintext, err := service.readSealed(contextValue, reference, maxBundleBytes)
	if err != nil {
		return evalbundle.Bundle{}, err
	}
	return evalbundle.Parse(plaintext)
}

// DecodeStoredExport decodes export_question_version's JSON.
func DecodeStoredExport(raw json.RawMessage) (StoredExport, error) {
	var stored StoredExport
	err := json.Unmarshal(raw, &stored)
	return stored, err
}
