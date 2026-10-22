package app

import (
	"context"
	"sync"

	centralauthz "github.com/aethercode/aethercode/libs/pkg/authz"
	"github.com/aethercode/aethercode/libs/pkg/database"
	"github.com/aethercode/aethercode/services/submission/internal/domain/similarity"
	"github.com/jackc/pgx/v5"
)

const (
	// A pair is reported when they share this much of the smaller program's
	// distinctive code; fingerprints over half the class shares are ignored.
	similarityThreshold      = 0.6
	similarityCommonFraction = 0.5
	maxPairsPerQuestion      = 100
	// sourceReads bounds concurrent object reads while building a report.
	sourceReads = 16
)

// StoredLatestAnswer is one attempt's latest saved answer to one question.
type StoredLatestAnswer struct {
	StoredAnswerRef
	AttemptID   string  `json:"attempt_id"`
	CandidateID string  `json:"candidate_id"`
	ExamItemID  string  `json:"exam_item_id"`
	Position    *int    `json:"position"`
	Title       *string `json:"title"`
}

// QuestionSimilarity lists one question's suspiciously similar pairs (ADR-0031).
type QuestionSimilarity struct {
	ExamItemID string           `json:"exam_item_id"`
	Position   *int             `json:"position"`
	Title      *string          `json:"title"`
	Programs   int              `json:"programs"`
	Pairs      []SimilarityPair `json:"pairs"`
}

type SimilarityPair struct {
	Score  float64           `json:"score"`
	Shared int               `json:"shared"`
	A      SimilarityProgram `json:"a"`
	B      SimilarityProgram `json:"b"`
}

type SimilarityProgram struct {
	AttemptID   string `json:"attempt_id"`
	CandidateID string `json:"candidate_id"`
	Language    string `json:"language"`
}

// SimilarityReport compares every student's latest code, question by question.
func (service *Service) SimilarityReport(contextValue context.Context, capability centralauthz.Capability, command ExamVersionCommand) ([]QuestionSimilarity, error) {
	if err := command.validate(); err != nil {
		return nil, err
	}
	var answers []StoredLatestAnswer
	err := database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		var storeErr error
		answers, storeErr = service.store.ListExamLatestAnswers(contextValue, transaction, command)
		return storeErr
	})
	if err != nil {
		return nil, err
	}
	sources, err := service.readSources(contextValue, answers)
	if err != nil {
		return nil, err
	}

	report := []QuestionSimilarity{}
	byItem := map[string]int{}
	programs := map[string][]similarity.Program{}
	who := map[string]SimilarityProgram{}
	for index, answer := range answers {
		if _, seen := byItem[answer.ExamItemID]; !seen {
			byItem[answer.ExamItemID] = len(report)
			report = append(report, QuestionSimilarity{ExamItemID: answer.ExamItemID, Position: answer.Position, Title: answer.Title, Pairs: []SimilarityPair{}})
		}
		programs[answer.ExamItemID] = append(programs[answer.ExamItemID], similarity.Program{ID: answer.AttemptID, Source: sources[index]})
		who[answer.ExamItemID+"/"+answer.AttemptID] = SimilarityProgram{AttemptID: answer.AttemptID, CandidateID: answer.CandidateID, Language: answer.Language}
	}
	for itemID, index := range byItem {
		report[index].Programs = len(programs[itemID])
		for _, pair := range similarity.Pairs(programs[itemID], similarityThreshold, similarityCommonFraction) {
			if len(report[index].Pairs) == maxPairsPerQuestion {
				break
			}
			report[index].Pairs = append(report[index].Pairs, SimilarityPair{
				Score: pair.Score, Shared: pair.Shared, A: who[itemID+"/"+pair.A], B: who[itemID+"/"+pair.B],
			})
		}
	}
	return report, nil
}

// readSources decrypts every answer, at most sourceReads at a time.
func (service *Service) readSources(contextValue context.Context, answers []StoredLatestAnswer) ([]string, error) {
	sources := make([]string, len(answers))
	errs := make([]error, len(answers))
	slots := make(chan struct{}, sourceReads)
	var group sync.WaitGroup
	for index := range answers {
		group.Add(1)
		slots <- struct{}{}
		go func() {
			defer group.Done()
			defer func() { <-slots }()
			sources[index], errs[index] = service.readSource(contextValue, answers[index].StoredAnswerRef)
		}()
	}
	group.Wait()
	for _, err := range errs {
		if err != nil {
			return nil, err
		}
	}
	return sources, nil
}
