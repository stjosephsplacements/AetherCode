package repo

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
	"github.com/aethercode/aethercode/services/question-bank/internal/app"
	"github.com/jackc/pgx/v5"
)

// ResolvePublishedQuestionVersion reads through the SECURITY DEFINER function
// installed by migration 000012, outside any request capability.
func (repository *Postgres) ResolvePublishedQuestionVersion(contextValue context.Context, questionVersionID string) (app.ResolvedQuestionVersion, error) {
	resolved := app.ResolvedQuestionVersion{QuestionVersionID: questionVersionID}
	var languages, choices []byte
	var evaluationKey, evaluationSHA, evaluationKeyReference, sampleKey, sampleSHA, sampleKeyReference *string
	var sampleCount, hiddenCount *int
	var correct []int32
	err := repository.pool.QueryRow(contextValue, `
		SELECT out_question_id::text, out_version_number, out_title, out_supported_languages,
		       out_time_limit_ms, out_memory_limit_kib,
		       out_evaluation_object_key, out_evaluation_checksum, out_evaluation_key_reference,
		       out_sample_object_key, out_sample_checksum, out_sample_key_reference,
		       out_sample_count, out_hidden_count, out_prompt_markdown,
		       out_kind, out_choices, out_correct_choices, out_multiple_choice
		FROM qbank.resolve_published_question_version($1)
	`, questionVersionID).Scan(
		&resolved.QuestionID, &resolved.VersionNumber, &resolved.Title, &languages,
		&resolved.TimeLimitMS, &resolved.MemoryLimitKiB,
		&evaluationKey, &evaluationSHA, &evaluationKeyReference,
		&sampleKey, &sampleSHA, &sampleKeyReference,
		&sampleCount, &hiddenCount, &resolved.PromptMarkdown,
		&resolved.Kind, &choices, &correct, &resolved.MultipleChoice,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return app.ResolvedQuestionVersion{}, apperrors.New(apperrors.CodeNotFound, "published question version not found")
	}
	if err != nil {
		return app.ResolvedQuestionVersion{}, fmt.Errorf("resolve published question version: %w", err)
	}
	if err := json.Unmarshal(languages, &resolved.SupportedLanguages); err != nil {
		return app.ResolvedQuestionVersion{}, fmt.Errorf("decode supported languages: %w", err)
	}
	if choices != nil {
		if err := json.Unmarshal(choices, &resolved.Choices); err != nil {
			return app.ResolvedQuestionVersion{}, fmt.Errorf("decode choices: %w", err)
		}
	}
	for _, index := range correct {
		resolved.CorrectChoices = append(resolved.CorrectChoices, int(index))
	}
	text := func(value *string) string {
		if value == nil {
			return ""
		}
		return *value
	}
	count := func(value *int) int {
		if value == nil {
			return 0
		}
		return *value
	}
	resolved.Evaluation = app.ResolvedBundle{ObjectKey: text(evaluationKey), SHA256: text(evaluationSHA), KeyReference: text(evaluationKeyReference),
		TestCaseCount: count(sampleCount) + count(hiddenCount)}
	resolved.Sample = app.ResolvedBundle{ObjectKey: text(sampleKey), SHA256: text(sampleSHA), KeyReference: text(sampleKeyReference),
		TestCaseCount: count(sampleCount)}
	return resolved, nil
}
