package app

import (
	"context"
	"encoding/json"

	centralauthz "github.com/aethercode/aethercode/libs/pkg/authz"
	"github.com/aethercode/aethercode/libs/pkg/database"
	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
	"github.com/jackc/pgx/v5"
)

// AttemptReview is the staff view of one attempt (ADR-0029): each question's
// latest code, its evaluations and the attempt's event log. The attempt,
// score, evaluations and events pass through as the database builds them.
type AttemptReview struct {
	Attempt json.RawMessage `json:"attempt"`
	Score   json.RawMessage `json:"score"`
	Items   []ReviewItem    `json:"items"`
	Events  json.RawMessage `json:"events"`
}

type ReviewItem struct {
	ExamItemID   string          `json:"exam_item_id"`
	Position     *int            `json:"position"`
	Title        *string         `json:"title"`
	MaximumScore string          `json:"maximum_score"`
	BestScore    *string         `json:"best_score"`
	LatestAnswer *ReviewAnswer   `json:"latest_answer"`
	Evaluations  json.RawMessage `json:"evaluations"`
}

type ReviewAnswer struct {
	Language       string `json:"language"`
	RevisionNumber int    `json:"revision_number"`
	SavedAt        string `json:"saved_at"`
	Source         string `json:"source"`
}

// StoredReview is get_attempt_review's JSON: answers are storage references.
type StoredReview struct {
	Attempt json.RawMessage    `json:"attempt"`
	Score   json.RawMessage    `json:"score"`
	Items   []StoredReviewItem `json:"items"`
	Events  json.RawMessage    `json:"events"`
}

type StoredReviewItem struct {
	ExamItemID   string  `json:"exam_item_id"`
	Position     *int    `json:"position"`
	Title        *string `json:"title"`
	MaximumScore string  `json:"maximum_score"`
	BestScore    *string `json:"best_score"`
	LatestAnswer *struct {
		StoredAnswerRef
		SavedAt string `json:"saved_at"`
	} `json:"latest_answer"`
	Evaluations json.RawMessage `json:"evaluations"`
}

// ReviewAttempt returns the staff review of an attempt, decrypting each latest answer.
func (service *Service) ReviewAttempt(contextValue context.Context, capability centralauthz.Capability, command GetAttempt) (AttemptReview, error) {
	command.TenantID = normalizeUUID(command.TenantID)
	command.AttemptID = normalizeUUID(command.AttemptID)
	if !isUUID(command.TenantID) || !isUUID(command.AttemptID) {
		return AttemptReview{}, apperrors.New(apperrors.CodeInvalidArgument, "tenant and attempt IDs must be UUIDs")
	}
	var stored StoredReview
	err := database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		var storeErr error
		stored, storeErr = service.store.GetAttemptReview(contextValue, transaction, command)
		return storeErr
	})
	if err != nil {
		return AttemptReview{}, err
	}
	review := AttemptReview{Attempt: stored.Attempt, Score: stored.Score, Events: stored.Events, Items: make([]ReviewItem, 0, len(stored.Items))}
	for _, item := range stored.Items {
		out := ReviewItem{
			ExamItemID: item.ExamItemID, Position: item.Position, Title: item.Title,
			MaximumScore: item.MaximumScore, BestScore: item.BestScore, Evaluations: item.Evaluations,
		}
		if item.LatestAnswer != nil {
			source, sourceErr := service.readSource(contextValue, item.LatestAnswer.StoredAnswerRef)
			if sourceErr != nil {
				return AttemptReview{}, sourceErr
			}
			out.LatestAnswer = &ReviewAnswer{
				Language: item.LatestAnswer.Language, RevisionNumber: item.LatestAnswer.RevisionNumber,
				SavedAt: item.LatestAnswer.SavedAt, Source: source,
			}
		}
		review.Items = append(review.Items, out)
	}
	return review, nil
}
