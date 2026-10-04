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
	var languages []byte
	var sampleCount, hiddenCount int
	err := repository.pool.QueryRow(contextValue, `
		SELECT out_question_id::text, out_version_number, out_title, out_supported_languages,
		       out_time_limit_ms, out_memory_limit_kib,
		       out_evaluation_object_key, out_evaluation_checksum, out_evaluation_key_reference,
		       out_sample_object_key, out_sample_checksum, out_sample_key_reference,
		       out_sample_count, out_hidden_count
		FROM qbank.resolve_published_question_version($1)
	`, questionVersionID).Scan(
		&resolved.QuestionID, &resolved.VersionNumber, &resolved.Title, &languages,
		&resolved.TimeLimitMS, &resolved.MemoryLimitKiB,
		&resolved.Evaluation.ObjectKey, &resolved.Evaluation.SHA256, &resolved.Evaluation.KeyReference,
		&resolved.Sample.ObjectKey, &resolved.Sample.SHA256, &resolved.Sample.KeyReference,
		&sampleCount, &hiddenCount,
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
	resolved.Sample.TestCaseCount = sampleCount
	resolved.Evaluation.TestCaseCount = sampleCount + hiddenCount
	return resolved, nil
}
