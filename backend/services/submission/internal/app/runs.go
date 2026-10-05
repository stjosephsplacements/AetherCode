package app

import (
	"context"
	"fmt"
	"strings"
	"time"

	centralauthz "github.com/aethercode/aethercode/libs/pkg/authz"
	"github.com/aethercode/aethercode/libs/pkg/database"
	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
	"github.com/aethercode/aethercode/libs/pkg/pagination"
	"github.com/jackc/pgx/v5"
)

// RunCode runs a candidate's source against one exam item's sample tests
// (ADR-0021). The source references are filled by the service when it
// encrypts and stores the source; a client can never supply them.
type RunCode struct {
	ID         string
	TenantID   string
	AttemptID  string
	ExamItemID string
	Language   string
	Source     string

	SourceObjectKey        string
	SourceChecksum         string
	EncryptionKeyReference string
}

type GetCodeRun struct {
	TenantID  string
	AttemptID string
	RunID     string
}

type ListCodeRuns struct {
	TenantID   string
	AttemptID  string
	ExamItemID string
	Limit      int
	CursorSort string
	CursorID   string
}

// CodeRun is one run. A listed run carries unit counts; a fetched run carries
// every unit with its input, expected output and output, which are sample
// tests and so never redacted.
type CodeRun struct {
	ID             string        `json:"id"`
	AttemptID      string        `json:"attempt_id"`
	ExamItemID     string        `json:"exam_item_id"`
	LanguageID     string        `json:"language_id"`
	LifecycleState string        `json:"lifecycle_state"`
	Verdict        *string       `json:"verdict"`
	PassedUnits    *int          `json:"passed_units,omitempty"`
	TotalUnits     *int          `json:"total_units,omitempty"`
	CreatedAt      time.Time     `json:"created_at"`
	CompletedAt    *time.Time    `json:"completed_at"`
	Units          []CodeRunUnit `json:"units,omitempty"`
}

type CodeRunUnit struct {
	UnitNumber      int     `json:"unit_number"`
	Verdict         string  `json:"verdict"`
	Stdin           *string `json:"stdin"`
	ExpectedOutput  *string `json:"expected_output"`
	Stdout          *string `json:"stdout"`
	Stderr          *string `json:"stderr"`
	CompileOutput   *string `json:"compile_output"`
	ExecutionTimeMS *int    `json:"execution_time_ms"`
	MemoryKiB       *int    `json:"memory_kib"`
}

// RunCode stores the source, then records a queued run that the dispatcher
// sends to Judge. The storage round trip happens before the transaction so no
// database transaction is held across it.
func (service *Service) RunCode(contextValue context.Context, capability centralauthz.Capability, command RunCode) (CodeRun, error) {
	command.TenantID = normalizeUUID(command.TenantID)
	command.AttemptID = normalizeUUID(command.AttemptID)
	command.ExamItemID = normalizeUUID(command.ExamItemID)
	command.Language = strings.TrimSpace(command.Language)
	if !isUUID(command.TenantID) || !isUUID(command.AttemptID) || !isUUID(command.ExamItemID) ||
		!languagePattern.MatchString(command.Language) || strings.TrimSpace(command.Source) == "" ||
		len(command.Source) > MaxSourceBytes {
		return CodeRun{}, apperrors.New(apperrors.CodeInvalidArgument, "code run fields are invalid")
	}
	runID, err := database.NewUUIDv7()
	if err != nil {
		return CodeRun{}, err
	}
	command.ID = runID
	command.SourceObjectKey = fmt.Sprintf("candidate-source/%s/%s/runs/%s", command.TenantID, command.AttemptID, runID)
	command.SourceChecksum, command.EncryptionKeyReference, err = service.encryptAndStore(contextValue, command.SourceObjectKey, command.Source)
	if err != nil {
		return CodeRun{}, err
	}

	var run CodeRun
	err = database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		var storeErr error
		run, storeErr = service.store.StartCodeRun(contextValue, transaction, command)
		return storeErr
	})
	if err != nil {
		// The run was not recorded, so nothing references the object.
		_ = service.storage.Delete(context.WithoutCancel(contextValue), command.SourceObjectKey)
	}
	return run, err
}

func (service *Service) GetCodeRun(contextValue context.Context, capability centralauthz.Capability, command GetCodeRun) (CodeRun, error) {
	command.TenantID = normalizeUUID(command.TenantID)
	command.AttemptID = normalizeUUID(command.AttemptID)
	command.RunID = normalizeUUID(command.RunID)
	if !isUUID(command.TenantID) || !isUUID(command.AttemptID) || !isUUID(command.RunID) {
		return CodeRun{}, apperrors.New(apperrors.CodeInvalidArgument, "tenant, attempt and run IDs must be UUIDs")
	}
	var run CodeRun
	err := database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		var storeErr error
		run, storeErr = service.store.GetCodeRun(contextValue, transaction, command)
		return storeErr
	})
	return run, err
}

func (service *Service) ListCodeRuns(contextValue context.Context, capability centralauthz.Capability, command ListCodeRuns) (Page[CodeRun], error) {
	command.TenantID = normalizeUUID(command.TenantID)
	command.AttemptID = normalizeUUID(command.AttemptID)
	command.ExamItemID = normalizeUUID(command.ExamItemID)
	if !isUUID(command.TenantID) || !isUUID(command.AttemptID) || !isUUID(command.ExamItemID) ||
		command.Limit < 1 || command.Limit > 100 {
		return Page[CodeRun]{}, apperrors.New(apperrors.CodeInvalidArgument, "code run listing is invalid")
	}
	probe := command
	probe.Limit = command.Limit + 1
	var runs []CodeRun
	err := database.WithTenantTx(contextValue, service.pool, capability, func(transaction pgx.Tx) error {
		var storeErr error
		runs, storeErr = service.store.ListCodeRuns(contextValue, transaction, probe)
		return storeErr
	})
	if err != nil {
		return Page[CodeRun]{}, err
	}
	page := Page[CodeRun]{Items: append([]CodeRun{}, runs...)}
	if len(runs) > command.Limit {
		page.Items = page.Items[:command.Limit]
		last := page.Items[command.Limit-1]
		page.NextCursor = pagination.Encode(pagination.EncodeTime(last.CreatedAt), last.ID)
	}
	return page, nil
}
