package app

import (
	"context"

	"github.com/jackc/pgx/v5"
	centralauthz "github.com/stjosephsplacements/AetherCode/libs/pkg/authz"
	"github.com/stjosephsplacements/AetherCode/libs/pkg/database"
	apperrors "github.com/stjosephsplacements/AetherCode/libs/pkg/errors"
	"github.com/stjosephsplacements/AetherCode/services/submission/internal/domain/similarity"
)

// SimilarityAlign is token alignment for two attempts on one question.
type SimilarityAlign struct {
	TokensA []string `json:"tokens_a"`
	TokensB []string `json:"tokens_b"`
	Shared  []bool   `json:"shared"`
	Score   float64  `json:"score"`
	SharedN int      `json:"shared_fingerprints"`
}

// SimilarityAlignReport compares two latest answers on one exam item (ADR-0081 C).
func (service *Service) SimilarityAlignReport(
	contextValue context.Context,
	capability centralauthz.Capability,
	command ExamVersionCommand,
	examItemID, attemptA, attemptB string,
) (SimilarityAlign, error) {
	if err := command.validate(); err != nil {
		return SimilarityAlign{}, err
	}
	examItemID, attemptA, attemptB = normalizeUUID(examItemID), normalizeUUID(attemptA), normalizeUUID(attemptB)
	if !isUUID(examItemID) || !isUUID(attemptA) || !isUUID(attemptB) {
		return SimilarityAlign{}, apperrors.New(apperrors.CodeInvalidArgument, "identifiers are invalid")
	}
	var answers []StoredLatestAnswer
	err := database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		var storeErr error
		answers, storeErr = service.store.ListExamLatestAnswers(contextValue, transaction, command)
		return storeErr
	})
	if err != nil {
		return SimilarityAlign{}, err
	}
	var sourceA, sourceB string
	programs := []similarity.Program{}
	for index, answer := range answers {
		if answer.ExamItemID != examItemID {
			continue
		}
		text, readErr := service.readSource(contextValue, answer.StoredAnswerRef)
		if readErr != nil {
			return SimilarityAlign{}, readErr
		}
		programs = append(programs, similarity.Program{ID: answer.AttemptID, Source: text})
		switch answer.AttemptID {
		case attemptA:
			sourceA = text
		case attemptB:
			sourceB = text
		}
		_ = index
	}
	if sourceA == "" || sourceB == "" {
		return SimilarityAlign{}, apperrors.New(apperrors.CodeNotFound, "one or both attempts have no saved code for this question")
	}
	tokensA, tokensB, shared := similarity.AlignTokens(sourceA, sourceB)
	report := SimilarityAlign{TokensA: tokensA, TokensB: tokensB, Shared: shared}
	for _, pair := range similarity.Pairs(programs, similarityThreshold, similarityCommonFraction) {
		if (pair.A == attemptA && pair.B == attemptB) || (pair.A == attemptB && pair.B == attemptA) {
			report.Score = pair.Score
			report.SharedN = pair.Shared
			break
		}
	}
	return report, nil
}
