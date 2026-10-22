package app

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"

	centralauthz "github.com/aethercode/aethercode/libs/pkg/authz"
	"github.com/aethercode/aethercode/libs/pkg/database"
	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
	"github.com/jackc/pgx/v5"
)

// maxSolutionBytes matches the largest answer a candidate may save.
const maxSolutionBytes = 64 << 10

// ModelCheckRunner sends checks to Judge (ADR-0033). Nil turns checks off.
type ModelCheckRunner interface {
	Submit(context.Context, ModelCheckJob) error
	Fail(context.Context, string) error
}

// ModelCheckJob is what Judge needs to run a check or a practice run.
type ModelCheckJob struct {
	ID string
	// FairnessKey groups the job in Judge's admission limiter; empty means
	// model checks.
	FairnessKey    string
	Language       string
	Bundle         BundleReference
	Source         BundleReference
	TimeLimitMS    int
	MemoryLimitKiB int
}

// StartModelCheck runs an author's reference solution on every test of a
// version, hidden ones included; the outcome appears in ListModelChecks.
type StartModelCheck struct {
	QuestionVersionID string
	Language          string
	Source            string
}

type storedCheckTarget struct {
	EvaluationBundleObjectKey string `json:"evaluation_bundle_object_key"`
	EvaluationBundleChecksum  string `json:"evaluation_bundle_checksum"`
	EncryptionKeyReference    string `json:"encryption_key_reference"`
	TimeLimitMS               int    `json:"time_limit_ms"`
	MemoryLimitKiB            int    `json:"memory_limit_kib"`
}

// UseModelChecks enables model-solution checks.
func (service *Service) UseModelChecks(runner ModelCheckRunner) {
	service.modelChecks = runner
}

func (service *Service) StartModelCheck(contextValue context.Context, capability centralauthz.Capability, command StartModelCheck) (string, error) {
	if service.modelChecks == nil {
		return "", apperrors.New(apperrors.CodeUnavailable, "model-solution checks are not configured")
	}
	command.Language = strings.TrimSpace(command.Language)
	if !isUUID(command.QuestionVersionID) || command.Language == "" || strings.TrimSpace(command.Source) == "" || len(command.Source) > maxSolutionBytes {
		return "", apperrors.New(apperrors.CodeInvalidArgument, "a check needs a language and a solution of at most 64 KB")
	}
	id, err := database.NewUUIDv7()
	if err != nil {
		return "", err
	}
	ciphertext, keyReference, err := service.kms.Encrypt(contextValue, []byte(command.Source))
	if err != nil {
		return "", fmt.Errorf("encrypt model solution: %w", err)
	}
	objectKey := fmt.Sprintf("qbank/question-versions/%s/model-checks/%s.source", strings.ToLower(command.QuestionVersionID), id)
	if err := service.storage.Put(contextValue, objectKey, bytes.NewReader(ciphertext), int64(len(ciphertext)), "application/octet-stream"); err != nil {
		return "", fmt.Errorf("store model solution: %w", err)
	}
	digest := sha256.Sum256(ciphertext)
	source := BundleReference{ObjectKey: objectKey, Checksum: hex.EncodeToString(digest[:]), EncryptionKeyReference: keyReference}

	var raw json.RawMessage
	err = database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		var storeErr error
		raw, storeErr = service.store.StartModelCheck(contextValue, transaction, id, command, source)
		return storeErr
	})
	if err != nil {
		service.deleteObjects(contextValue, []string{objectKey})
		return "", err
	}
	var target storedCheckTarget
	if err := json.Unmarshal(raw, &target); err != nil {
		return "", fmt.Errorf("decode model check target: %w", err)
	}
	job := ModelCheckJob{
		ID: id, Language: command.Language, Source: source,
		Bundle:         BundleReference{ObjectKey: target.EvaluationBundleObjectKey, Checksum: target.EvaluationBundleChecksum, EncryptionKeyReference: target.EncryptionKeyReference},
		TimeLimitMS:    target.TimeLimitMS,
		MemoryLimitKiB: target.MemoryLimitKiB,
	}
	if err := service.modelChecks.Submit(contextValue, job); err != nil {
		if failErr := service.modelChecks.Fail(context.WithoutCancel(contextValue), id); failErr != nil {
			service.logger.Warn("mark model check failed", "check_id", id, "error", failErr)
		}
		return "", apperrors.New(apperrors.CodeUnavailable, "the judge is unavailable; try again shortly")
	}
	return id, nil
}

func (service *Service) ListModelChecks(contextValue context.Context, capability centralauthz.Capability, questionVersionID string) (json.RawMessage, error) {
	if !isUUID(questionVersionID) {
		return nil, apperrors.New(apperrors.CodeInvalidArgument, "question version identifier is invalid")
	}
	var raw json.RawMessage
	err := database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		var storeErr error
		raw, storeErr = service.store.ListModelChecks(contextValue, transaction, questionVersionID)
		return storeErr
	})
	return raw, err
}
