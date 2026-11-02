package app

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"regexp"
	"strings"

	centralauthz "github.com/aethercode/aethercode/libs/pkg/authz"
	"github.com/aethercode/aethercode/libs/pkg/database"
	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
	"github.com/aethercode/aethercode/libs/pkg/evalbundle"
	"github.com/jackc/pgx/v5"
)

// Practice problems (ADR-0041). Staff mark a question for tests or practice;
// students read and run only practice questions, outside any exam, with a
// tenant-scoped capability that every practice function binds to the signed
// actor. Hidden tests are graded but never shown.

// practiceFairnessKey groups practice jobs in Judge's admission limiter.
const practiceFairnessKey = "question-bank:practice"

// SetQuestionAudience moves a question between tests and practice.
type SetQuestionAudience struct {
	QuestionID string
	Audience   string
}

// StartPractice runs a student's code on a practice problem: "run" uses the
// sample tests, or Input when it is set; "submit" uses every test.
type StartPractice struct {
	QuestionID string
	Language   string
	Mode       string
	Source     string
	Input      *string
}

// PracticeSample is one sample test shown with a practice problem.
type PracticeSample struct {
	Input          string `json:"input"`
	ExpectedOutput string `json:"expected_output"`
}

// PracticeQuestion is a practice problem as a student sees it.
type PracticeQuestion struct {
	QuestionID        string           `json:"question_id"`
	QuestionVersionID string           `json:"question_version_id"`
	Title             string           `json:"title"`
	PromptMarkdown    string           `json:"prompt_markdown"`
	Difficulty        string           `json:"difficulty"`
	Languages         []string         `json:"languages"`
	TimeLimitMS       int              `json:"time_limit_ms"`
	MemoryLimitKiB    int              `json:"memory_limit_kib"`
	Tags              []string         `json:"tags"`
	Samples           []PracticeSample `json:"samples"`
	// Starters are the stubs students start from, by language (ADR-0063).
	Starters map[string]string `json:"starters,omitempty"`
}

type storedPracticeQuestion struct {
	PracticeQuestion
	Sample *BundleReference `json:"sample"`
}

type storedPracticeTarget struct {
	BundleObjectKey    string `json:"bundle_object_key"`
	BundleChecksum     string `json:"bundle_checksum"`
	BundleKeyReference string `json:"bundle_key_reference"`
	TimeLimitMS        int    `json:"time_limit_ms"`
	MemoryLimitKiB     int    `json:"memory_limit_kib"`
}

func (service *Service) SetQuestionAudience(contextValue context.Context, capability centralauthz.Capability, command SetQuestionAudience) error {
	if !isUUID(command.QuestionID) || (command.Audience != "test" && command.Audience != "practice") {
		return apperrors.New(apperrors.CodeInvalidArgument, "audience must be test or practice")
	}
	return database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		return service.store.SetQuestionAudience(contextValue, transaction, command.QuestionID, command.Audience)
	})
}

func (service *Service) practiceJSON(contextValue context.Context, capability centralauthz.Capability, read func(pgx.Tx) (json.RawMessage, error)) (json.RawMessage, error) {
	var raw json.RawMessage
	err := database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		var storeErr error
		raw, storeErr = read(transaction)
		return storeErr
	})
	return raw, err
}

// ListPracticeQuestions is the practice catalogue with the student's progress.
func (service *Service) ListPracticeQuestions(contextValue context.Context, capability centralauthz.Capability) (json.RawMessage, error) {
	return service.practiceJSON(contextValue, capability, func(transaction pgx.Tx) (json.RawMessage, error) {
		return service.store.ListPracticeQuestions(contextValue, transaction)
	})
}

// GetPracticeProgress is the student's practice totals.
func (service *Service) GetPracticeProgress(contextValue context.Context, capability centralauthz.Capability) (json.RawMessage, error) {
	return service.practiceJSON(contextValue, capability, func(transaction pgx.Tx) (json.RawMessage, error) {
		return service.store.GetPracticeProgress(contextValue, transaction)
	})
}

// ListPracticeSubmissions is the student's recent runs on one problem.
func (service *Service) ListPracticeSubmissions(contextValue context.Context, capability centralauthz.Capability, questionID string) (json.RawMessage, error) {
	if !isUUID(questionID) {
		return nil, apperrors.New(apperrors.CodeInvalidArgument, "question identifier is invalid")
	}
	return service.practiceJSON(contextValue, capability, func(transaction pgx.Tx) (json.RawMessage, error) {
		return service.store.ListPracticeSubmissions(contextValue, transaction, questionID)
	})
}

// GetPracticeQuestion returns a practice problem with its sample tests.
func (service *Service) GetPracticeQuestion(contextValue context.Context, capability centralauthz.Capability, questionID string) (PracticeQuestion, error) {
	if !isUUID(questionID) {
		return PracticeQuestion{}, apperrors.New(apperrors.CodeInvalidArgument, "question identifier is invalid")
	}
	raw, err := service.practiceJSON(contextValue, capability, func(transaction pgx.Tx) (json.RawMessage, error) {
		return service.store.GetPracticeQuestion(contextValue, transaction, questionID)
	})
	if err != nil {
		return PracticeQuestion{}, err
	}
	var stored storedPracticeQuestion
	if err := json.Unmarshal(raw, &stored); err != nil {
		return PracticeQuestion{}, fmt.Errorf("decode practice question: %w", err)
	}
	question := stored.PracticeQuestion
	if templates, err := service.loadTemplates(contextValue, question.QuestionVersionID); err == nil {
		question.Starters = templates.starters()
	}
	question.Samples = []PracticeSample{}
	if stored.Sample != nil {
		bundle, err := service.readBundle(contextValue, *stored.Sample)
		if err != nil {
			return PracticeQuestion{}, err
		}
		for _, test := range bundle.TestCases {
			question.Samples = append(question.Samples, PracticeSample{Input: test.Stdin, ExpectedOutput: test.ExpectedOutput})
		}
	}
	return question, nil
}

// GetPracticeSubmission returns one of the student's runs with its code.
func (service *Service) GetPracticeSubmission(contextValue context.Context, capability centralauthz.Capability, id string) (json.RawMessage, error) {
	if !isUUID(id) {
		return nil, apperrors.New(apperrors.CodeInvalidArgument, "practice run identifier is invalid")
	}
	raw, err := service.practiceJSON(contextValue, capability, func(transaction pgx.Tx) (json.RawMessage, error) {
		return service.store.GetPracticeSubmission(contextValue, transaction, id)
	})
	if err != nil {
		return nil, err
	}
	var submission map[string]json.RawMessage
	if err := json.Unmarshal(raw, &submission); err != nil {
		return nil, fmt.Errorf("decode practice run: %w", err)
	}
	var reference BundleReference
	if err := json.Unmarshal(submission["source"], &reference); err != nil {
		return nil, fmt.Errorf("decode practice source reference: %w", err)
	}
	source, err := service.readSealed(contextValue, reference, maxSolutionBytes<<2)
	if err != nil {
		return nil, err
	}
	if submission["source"], err = json.Marshal(string(source)); err != nil {
		return nil, err
	}
	return json.Marshal(submission)
}

// StartPractice stores the student's code (and own input), records the run
// and sends it to Judge. It returns the run's id, which the student polls.
func (service *Service) StartPractice(contextValue context.Context, capability centralauthz.Capability, command StartPractice) (string, error) {
	if service.modelChecks == nil {
		return "", apperrors.New(apperrors.CodeUnavailable, "practice is not available: the judge is not configured")
	}
	command.Language = strings.TrimSpace(command.Language)
	if !isUUID(command.QuestionID) || command.Language == "" || (command.Mode != "run" && command.Mode != "submit") {
		return "", apperrors.New(apperrors.CodeInvalidArgument, "a practice run needs a problem, a language and run or submit")
	}
	if strings.TrimSpace(command.Source) == "" || len(command.Source) > maxSolutionBytes {
		return "", apperrors.New(apperrors.CodeInvalidArgument, "write some code first; at most 64 KB")
	}
	if command.Input != nil && (command.Mode != "run" || len(*command.Input) > evalbundle.MaxOutputBytes) {
		return "", apperrors.New(apperrors.CodeInvalidArgument, "your own input is for runs only, at most 64 KB")
	}
	id, err := database.NewUUIDv7()
	if err != nil {
		return "", err
	}
	prefix := "qbank/practice/" + id
	source, err := service.sealObject(contextValue, prefix+".source", []byte(command.Source))
	if err != nil {
		return "", err
	}
	stored := []string{source.ObjectKey}
	var custom BundleReference
	if command.Input != nil {
		bundle, err := evalbundle.BuildSample([]evalbundle.TestCase{{Stdin: *command.Input, Weight: evalbundle.DefaultWeight}})
		if err != nil {
			service.deleteObjects(contextValue, stored)
			return "", apperrors.New(apperrors.CodeInvalidArgument, "your input cannot be run")
		}
		if custom, err = service.sealObject(contextValue, prefix+".bundle", bundle); err != nil {
			service.deleteObjects(contextValue, stored)
			return "", err
		}
		stored = append(stored, custom.ObjectKey)
	}

	raw, err := service.practiceJSON(contextValue, capability, func(transaction pgx.Tx) (json.RawMessage, error) {
		return service.store.StartPractice(contextValue, transaction, id, command, source)
	})
	if err != nil {
		service.deleteObjects(contextValue, stored)
		return "", err
	}
	var target storedPracticeTarget
	if err := json.Unmarshal(raw, &target); err != nil {
		return "", fmt.Errorf("decode practice target: %w", err)
	}
	bundle := BundleReference{ObjectKey: target.BundleObjectKey, Checksum: target.BundleChecksum, EncryptionKeyReference: target.BundleKeyReference}
	if command.Input != nil {
		bundle = custom
	}
	// A function-only problem runs the student's function inside its hidden wrapper (ADR-0063).
	runSource := source
	versionID := versionIDFromKey(target.BundleObjectKey)
	if versionID == "" {
		if resolved, versionErr := service.practiceVersionID(contextValue, capability, command.QuestionID); versionErr == nil {
			versionID = resolved
		} else {
			service.logger.Warn("resolve practice version for stubs", "error", versionErr)
		}
	}
	if versionID != "" {
		composed, wrapped, composeErr := service.composeFor(contextValue, versionID, command.Language, command.Source)
		if composeErr != nil {
			service.logger.Warn("compose practice stub", "version", versionID, "error", composeErr)
		} else if wrapped {
			if sealed, sealErr := service.sealObject(contextValue, prefix+".run", []byte(composed)); sealErr == nil {
				runSource = sealed
				stored = append(stored, sealed.ObjectKey)
			} else {
				service.logger.Warn("seal composed practice code", "error", sealErr)
			}
		}
	}
	job := ModelCheckJob{
		ID: id, Language: command.Language, Bundle: bundle, Source: runSource, FairnessKey: practiceFairnessKey,
		TimeLimitMS: target.TimeLimitMS, MemoryLimitKiB: target.MemoryLimitKiB,
	}
	if err := service.modelChecks.Submit(contextValue, job); err != nil {
		service.logger.Warn("submit practice run to Judge", "run_id", id, "error", err)
		if failErr := service.modelChecks.Fail(context.WithoutCancel(contextValue), id); failErr != nil {
			service.logger.Warn("mark practice run failed", "run_id", id, "error", failErr)
		}
		return "", apperrors.New(apperrors.CodeUnavailable, "the judge is busy; try again shortly")
	}
	return id, nil
}

// sealObject encrypts plaintext and stores it at objectKey.
func (service *Service) sealObject(contextValue context.Context, objectKey string, plaintext []byte) (BundleReference, error) {
	ciphertext, keyReference, err := service.kms.Encrypt(contextValue, plaintext)
	if err != nil {
		return BundleReference{}, fmt.Errorf("encrypt %s: %w", objectKey, err)
	}
	if err := service.storage.Put(contextValue, objectKey, bytes.NewReader(ciphertext), int64(len(ciphertext)), "application/octet-stream"); err != nil {
		return BundleReference{}, fmt.Errorf("store %s: %w", objectKey, err)
	}
	digest := sha256.Sum256(ciphertext)
	return BundleReference{ObjectKey: objectKey, Checksum: hex.EncodeToString(digest[:]), EncryptionKeyReference: keyReference}, nil
}

// readSealed fetches an encrypted object of at most limit bytes, checks it
// against its checksum and decrypts it.
func (service *Service) readSealed(contextValue context.Context, reference BundleReference, limit int) ([]byte, error) {
	object, _, err := service.storage.Get(contextValue, reference.ObjectKey)
	if err != nil {
		return nil, fmt.Errorf("fetch %s: %w", reference.ObjectKey, err)
	}
	defer func() { _ = object.Close() }()
	ciphertext, err := io.ReadAll(io.LimitReader(object, int64(limit)+1))
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", reference.ObjectKey, err)
	}
	if len(ciphertext) > limit {
		return nil, fmt.Errorf("%s exceeds %d bytes", reference.ObjectKey, limit)
	}
	digest := sha256.Sum256(ciphertext)
	if hex.EncodeToString(digest[:]) != strings.ToLower(reference.Checksum) {
		return nil, fmt.Errorf("%s does not match its checksum", reference.ObjectKey)
	}
	plaintext, err := service.kms.Decrypt(contextValue, ciphertext, reference.EncryptionKeyReference)
	if err != nil {
		return nil, fmt.Errorf("decrypt %s: %w", reference.ObjectKey, err)
	}
	return plaintext, nil
}

// practiceVersionID is the published version a practice problem currently resolves to.
func (service *Service) practiceVersionID(contextValue context.Context, capability centralauthz.Capability, questionID string) (string, error) {
	raw, err := service.practiceJSON(contextValue, capability, func(transaction pgx.Tx) (json.RawMessage, error) {
		return service.store.GetPracticeQuestion(contextValue, transaction, questionID)
	})
	if err != nil {
		return "", err
	}
	var stored storedPracticeQuestion
	if err := json.Unmarshal(raw, &stored); err != nil {
		return "", err
	}
	return stored.QuestionVersionID, nil
}

var versionInKey = regexp.MustCompile(`question-versions/([0-9a-fA-F-]{36})/`)

// versionIDFromKey reads the question version out of an evaluation bundle's object key, when it names one.
func versionIDFromKey(key string) string {
	if match := versionInKey.FindStringSubmatch(key); match != nil {
		return strings.ToLower(match[1])
	}
	return ""
}
