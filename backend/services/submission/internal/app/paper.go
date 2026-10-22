package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"

	centralauthz "github.com/aethercode/aethercode/libs/pkg/authz"
	"github.com/aethercode/aethercode/libs/pkg/database"
	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
	"github.com/jackc/pgx/v5"
)

// maxSourceCiphertextBytes bounds one stored answer: 64 KiB of source plus the
// envelope's overhead.
const maxSourceCiphertextBytes = 1 << 20

// Paper is what a candidate reads during their attempt (ADR-0023): the exam,
// each item's statement and limits, and their latest saved answer so a reload
// or a crashed browser resumes where it left off.
type Paper struct {
	AttemptID            string      `json:"attempt_id"`
	ExamID               string      `json:"exam_id"`
	Title                string      `json:"title"`
	InstructionsMarkdown string      `json:"instructions_markdown"`
	Items                []PaperItem `json:"items"`
}

type PaperItem struct {
	ExamItemID         string       `json:"exam_item_id"`
	Position           int          `json:"position"`
	Title              string       `json:"title"`
	PromptMarkdown     string       `json:"prompt_markdown"`
	MaximumScore       string       `json:"maximum_score"`
	SupportedLanguages []string     `json:"supported_languages"`
	TimeLimitMS        int          `json:"time_limit_ms"`
	MemoryLimitKiB     int          `json:"memory_limit_kib"`
	LatestAnswer       *PaperAnswer `json:"latest_answer"`
	// Kind is "coding" or "mcq" (ADR-0035). An mcq item lists its options in
	// this candidate's order, each with its authored index, and the saved
	// selection; the answer key never reaches the candidate.
	Kind           string        `json:"kind"`
	Choices        []PaperChoice `json:"choices,omitempty"`
	MultipleChoice bool          `json:"multiple_choice"`
	LatestChoice   []int         `json:"latest_choice"`
}

type PaperChoice struct {
	Index int    `json:"index"`
	Text  string `json:"text"`
}

type PaperAnswer struct {
	Language       string `json:"language"`
	Source         string `json:"source"`
	RevisionNumber int    `json:"revision_number"`
}

// StoredPaper is the paper as the database returns it: latest answers are
// storage references the service decrypts. Fields absent on assignments
// snapshotted before Assessment migration 000026 are empty.
type StoredPaper struct {
	AttemptID            string            `json:"attempt_id"`
	ExamID               string            `json:"exam_id"`
	Title                *string           `json:"title"`
	InstructionsMarkdown *string           `json:"instructions_markdown"`
	Items                []StoredPaperItem `json:"items"`
}

type StoredPaperItem struct {
	ExamItemID         string           `json:"exam_item_id"`
	Position           *int             `json:"position"`
	Title              *string          `json:"title"`
	PromptMarkdown     *string          `json:"prompt_markdown"`
	MaximumScore       string           `json:"maximum_score"`
	SupportedLanguages []string         `json:"supported_languages"`
	TimeLimitMS        *int             `json:"time_limit_ms"`
	MemoryLimitKiB     *int             `json:"memory_limit_kib"`
	LatestAnswer       *StoredAnswerRef `json:"latest_answer"`
	Kind               string           `json:"kind"`
	Choices            []PaperChoice    `json:"choices"`
	MultipleChoice     bool             `json:"multiple_choice"`
	LatestChoice       []int            `json:"latest_choice"`
}

type StoredAnswerRef struct {
	Language               string `json:"language"`
	RevisionNumber         int    `json:"revision_number"`
	SourceObjectKey        string `json:"source_object_key"`
	SourceChecksum         string `json:"source_checksum"`
	EncryptionKeyReference string `json:"encryption_key_reference"`
}

// GetAttemptPaper returns the paper of an attempt the calling candidate owns.
func (service *Service) GetAttemptPaper(contextValue context.Context, capability centralauthz.Capability, command GetAttempt) (Paper, error) {
	command.TenantID = normalizeUUID(command.TenantID)
	command.AttemptID = normalizeUUID(command.AttemptID)
	if !isUUID(command.TenantID) || !isUUID(command.AttemptID) {
		return Paper{}, apperrors.New(apperrors.CodeInvalidArgument, "tenant and attempt IDs must be UUIDs")
	}
	var stored StoredPaper
	err := database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		var storeErr error
		stored, storeErr = service.store.GetAttemptPaper(contextValue, transaction, command)
		return storeErr
	})
	if err != nil {
		return Paper{}, err
	}
	return buildPaper(contextValue, stored, service.readSource)
}

// buildPaper turns the stored paper into the candidate's view, decrypting each
// latest answer with readSource. Items snapshotted before Assessment migration
// 000026 have no title or statement; they are named by position.
func buildPaper(contextValue context.Context, stored StoredPaper, readSource func(context.Context, StoredAnswerRef) (string, error)) (Paper, error) {
	paper := Paper{AttemptID: stored.AttemptID, ExamID: stored.ExamID, Title: deref(stored.Title), InstructionsMarkdown: deref(stored.InstructionsMarkdown)}
	for index, item := range stored.Items {
		out := PaperItem{
			ExamItemID: item.ExamItemID, Position: index + 1, Title: deref(item.Title), PromptMarkdown: deref(item.PromptMarkdown),
			MaximumScore: item.MaximumScore, SupportedLanguages: item.SupportedLanguages,
			Kind: item.Kind, Choices: item.Choices, MultipleChoice: item.MultipleChoice, LatestChoice: item.LatestChoice,
		}
		if out.Kind == "" {
			out.Kind = "coding"
		}
		if item.Position != nil {
			out.Position = *item.Position
		}
		if out.Title == "" {
			out.Title = fmt.Sprintf("Question %d", out.Position)
		}
		if item.TimeLimitMS != nil && item.MemoryLimitKiB != nil {
			out.TimeLimitMS, out.MemoryLimitKiB = *item.TimeLimitMS, *item.MemoryLimitKiB
		}
		if out.SupportedLanguages == nil {
			out.SupportedLanguages = []string{}
		}
		if item.LatestAnswer != nil {
			source, err := readSource(contextValue, *item.LatestAnswer)
			if err != nil {
				return Paper{}, err
			}
			out.LatestAnswer = &PaperAnswer{Language: item.LatestAnswer.Language, Source: source, RevisionNumber: item.LatestAnswer.RevisionNumber}
		}
		paper.Items = append(paper.Items, out)
	}
	if paper.Items == nil {
		paper.Items = []PaperItem{}
	}
	return paper, nil
}

// readSource fetches, verifies and decrypts one saved answer.
func (service *Service) readSource(contextValue context.Context, reference StoredAnswerRef) (string, error) {
	if service.storage == nil || service.kms == nil {
		return "", apperrors.New(apperrors.CodeUnavailable, "candidate source storage is not configured")
	}
	object, _, err := service.storage.Get(contextValue, reference.SourceObjectKey)
	if err != nil {
		return "", fmt.Errorf("fetch candidate source: %w", err)
	}
	defer func() { _ = object.Close() }()
	ciphertext, err := io.ReadAll(io.LimitReader(object, maxSourceCiphertextBytes+1))
	if err != nil {
		return "", fmt.Errorf("read candidate source: %w", err)
	}
	if len(ciphertext) > maxSourceCiphertextBytes {
		return "", fmt.Errorf("candidate source object exceeds %d bytes", maxSourceCiphertextBytes)
	}
	digest := sha256.Sum256(ciphertext)
	if hex.EncodeToString(digest[:]) != reference.SourceChecksum {
		return "", fmt.Errorf("candidate source object does not match its checksum")
	}
	plaintext, err := service.kms.Decrypt(contextValue, ciphertext, reference.EncryptionKeyReference)
	if err != nil {
		return "", fmt.Errorf("decrypt candidate source: %w", err)
	}
	return string(plaintext), nil
}

func deref(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
