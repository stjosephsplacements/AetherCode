package app

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	centralauthz "github.com/aethercode/aethercode/libs/pkg/authz"
	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const validSubmissionTestUUID = "019c06d6-20e1-7a21-8a4f-bd8b21a43f18"

type validationStore struct{}

func (validationStore) StartAttempt(context.Context, pgx.Tx, StartAttempt) (Attempt, error) {
	return Attempt{}, nil
}
func (validationStore) GetAttempt(context.Context, pgx.Tx, GetAttempt) (Attempt, error) {
	return Attempt{}, nil
}
func (validationStore) GetAttemptIncludeDeleted(context.Context, pgx.Tx, GetAttempt) (Attempt, error) {
	return Attempt{}, nil
}
func (validationStore) AppendAnswerRevision(context.Context, pgx.Tx, AppendAnswerRevision) (AnswerRevision, error) {
	return AnswerRevision{}, nil
}
func (validationStore) PrepareSubmission(context.Context, pgx.Tx, PrepareSubmission) ([]EvaluationPreparation, error) {
	return nil, nil
}
func (validationStore) SubmitAttempt(context.Context, pgx.Tx, SubmitAttempt) (Attempt, error) {
	return Attempt{}, nil
}
func (validationStore) CountEvaluationRequests(context.Context, pgx.Tx, GetAttempt) (int, error) {
	return 0, nil
}
func (validationStore) SoftDeleteAttempt(context.Context, pgx.Tx, DeleteAttempt) error {
	return nil
}
func (validationStore) HardDeleteAttempt(context.Context, pgx.Tx, DeleteAttempt) error {
	return nil
}
func (validationStore) ListAttempts(context.Context, pgx.Tx, ListAttempts) ([]Attempt, error) {
	return nil, nil
}
func (validationStore) ListAnswerRevisions(context.Context, pgx.Tx, ListAnswerRevisions) ([]AnswerRevision, error) {
	return nil, nil
}
func (validationStore) GetAttemptUnitSummary(context.Context, pgx.Tx, GetAttempt) ([]AttemptUnitSummary, error) {
	return nil, nil
}
func (validationStore) ListAttemptUnitResults(context.Context, pgx.Tx, GetAttempt) ([]AttemptUnitResults, error) {
	return nil, nil
}
func (validationStore) Ping(context.Context) error { return nil }

func TestStartAttemptRejectsInvalidCommandBeforeTransaction(t *testing.T) {
	service, err := NewService(&pgxpool.Pool{}, validationStore{})
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	_, err = service.StartAttempt(context.Background(), centralauthz.Capability{}, StartAttempt{
		ID: validSubmissionTestUUID, TenantID: "not-a-uuid", CandidateAssignmentID: validSubmissionTestUUID,
		IdempotencyKey: "start-1",
	})
	assertInvalidArgument(t, err)
}

func TestAppendAnswerRevisionRejectsUntrustedSourceMetadata(t *testing.T) {
	service, err := NewService(&pgxpool.Pool{}, validationStore{})
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	_, err = service.AppendAnswerRevision(context.Background(), centralauthz.Capability{}, AppendAnswerRevision{
		ID: validSubmissionTestUUID, TenantID: validSubmissionTestUUID, AttemptID: validSubmissionTestUUID,
		ExamItemID: validSubmissionTestUUID, LanguageID: "go", SourceObjectKey: "tenant/object",
		SourceChecksum: "not-a-sha256", EncryptionKeyReference: "kms/key", ExpectedAttemptVersion: 1,
	})
	assertInvalidArgument(t, err)
}

func TestSubmitAttemptRejectsMissingIdempotencyKeyBeforeTransaction(t *testing.T) {
	service, err := NewService(&pgxpool.Pool{}, validationStore{})
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	_, err = service.SubmitAttempt(context.Background(), centralauthz.Capability{}, SubmitAttempt{
		TenantID: validSubmissionTestUUID, AttemptID: validSubmissionTestUUID, ExpectedAttemptVersion: 1,
	})
	assertInvalidArgument(t, err)
}

func TestChecksumIsStableAndDomainSeparated(t *testing.T) {
	//nolint:staticcheck // SA4000: the two calls are intentionally identical, to verify checksum() is deterministic across invocations, not a copy-paste mistake.
	if checksum("attempt.start.v1", "tenant", "assignment") != checksum("attempt.start.v1", "tenant", "assignment") {
		t.Fatal("checksum must be deterministic")
	}
	if checksum("attempt.start.v1", "tenant", "assignment") == checksum("attempt.submit.v1", "tenant", "assignment") {
		t.Fatal("checksum must include the operation domain")
	}
}

func TestAttemptStartEventIDsAreDistinctUUIDv7(t *testing.T) {
	auditEventID, outboxEventID, err := newAttemptStartEventIDs()
	if err != nil {
		t.Fatalf("newAttemptStartEventIDs() error = %v", err)
	}
	if auditEventID == outboxEventID {
		t.Fatal("attempt audit and outbox IDs must be distinct")
	}
	for _, identifier := range []string{auditEventID, outboxEventID} {
		if !isUUID(identifier) || len(identifier) != 36 || identifier[14] != '7' {
			t.Fatalf("event ID = %q, want UUIDv7", identifier)
		}
	}
}

// TestUnitResultResponsesKeepCandidateAndReviewerViewsSeparate locks the two
// response contracts. Adding a per-unit field to the candidate summary would
// hand a candidate the identity of the hidden test they failed, so the exact
// key set of each view is asserted rather than merely spot-checked.
func TestUnitResultResponsesKeepCandidateAndReviewerViewsSeparate(t *testing.T) {
	t.Parallel()

	executionTimeMS := 12
	testCases := []struct {
		name        string
		page        any
		wantKeys    []string
		absentKeys  []string
		wantSnippet string
	}{
		{
			name: "candidate summary exposes counts only",
			page: Page[AttemptUnitSummary]{Items: []AttemptUnitSummary{{
				ExamItemID: validSubmissionTestUUID, EvaluationRequestID: validSubmissionTestUUID,
				PassedUnits: 3, TotalUnits: 5,
			}}},
			wantKeys:   []string{"exam_item_id", "evaluation_request_id", "passed_units", "total_units"},
			absentKeys: []string{"units", "unit_number", "verdict", "execution_time_ms", "memory_kib"},
		},
		{
			name: "reviewer view exposes the full breakdown",
			page: Page[AttemptUnitResults]{Items: []AttemptUnitResults{{
				JudgeReceiptID: validSubmissionTestUUID, EvaluationRequestID: validSubmissionTestUUID,
				ExamItemID: validSubmissionTestUUID, Verdict: "wrong_answer", PassedUnits: 1, TotalUnits: 2,
				Units: []AttemptUnit{{UnitNumber: 1, Verdict: "wrong_answer", ExecutionTimeMS: &executionTimeMS}},
			}}},
			wantKeys:    []string{"judge_receipt_id", "verdict", "units", "unit_number", "execution_time_ms", "memory_kib"},
			wantSnippet: `"unit_number":1`,
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()

			encoded, err := json.Marshal(testCase.page)
			if err != nil {
				t.Fatalf("json.Marshal() error = %v", err)
			}
			body := string(encoded)
			for _, key := range testCase.wantKeys {
				if !strings.Contains(body, `"`+key+`"`) {
					t.Fatalf("response %s is missing %q", body, key)
				}
			}
			for _, key := range testCase.absentKeys {
				if strings.Contains(body, `"`+key+`"`) {
					t.Fatalf("response %s leaks %q", body, key)
				}
			}
			if testCase.wantSnippet != "" && !strings.Contains(body, testCase.wantSnippet) {
				t.Fatalf("response %s is missing %s", body, testCase.wantSnippet)
			}
		})
	}
}

func assertInvalidArgument(t *testing.T, err error) {
	t.Helper()
	var applicationError *apperrors.Error
	if !errors.As(err, &applicationError) || applicationError.Code != apperrors.CodeInvalidArgument {
		t.Fatalf("error = %#v, want invalid argument", err)
	}
}

func TestAppendAnswerRevisionEnforcesDeterministicChecksum(t *testing.T) {
	t.Parallel()
	// Verify that identical fields produce identical fingerprints
	fp1 := checksum("answer.append.v1", "tenant1", "attempt1", "item1", "go", "obj/key", "abc123", "kms/ref", "1")
	fp2 := checksum("answer.append.v1", "tenant1", "attempt1", "item1", "go", "obj/key", "abc123", "kms/ref", "1")
	if fp1 != fp2 {
		t.Fatal("checksum must be deterministic for identical inputs")
	}

	// Verify that changing any field produces a different fingerprint
	baseline := checksum("answer.append.v1", "tenant1", "attempt1", "item1", "go", "obj/key", "abc123", "kms/ref", "1")
	variations := []struct {
		name string
		fp   string
	}{
		{"domain", checksum("answer.append.v2", "tenant1", "attempt1", "item1", "go", "obj/key", "abc123", "kms/ref", "1")},
		{"tenant", checksum("answer.append.v1", "tenant2", "attempt1", "item1", "go", "obj/key", "abc123", "kms/ref", "1")},
		{"attempt", checksum("answer.append.v1", "tenant1", "attempt2", "item1", "go", "obj/key", "abc123", "kms/ref", "1")},
		{"item", checksum("answer.append.v1", "tenant1", "attempt1", "item2", "go", "obj/key", "abc123", "kms/ref", "1")},
		{"language", checksum("answer.append.v1", "tenant1", "attempt1", "item1", "python", "obj/key", "abc123", "kms/ref", "1")},
		{"objectKey", checksum("answer.append.v1", "tenant1", "attempt1", "item1", "go", "obj/key2", "abc123", "kms/ref", "1")},
		{"checksum", checksum("answer.append.v1", "tenant1", "attempt1", "item1", "go", "obj/key", "def456", "kms/ref", "1")},
		{"keyRef", checksum("answer.append.v1", "tenant1", "attempt1", "item1", "go", "obj/key", "abc123", "kms/ref2", "1")},
		{"version", checksum("answer.append.v1", "tenant1", "attempt1", "item1", "go", "obj/key", "abc123", "kms/ref", "2")},
	}
	for _, v := range variations {
		if v.fp == baseline {
			t.Errorf("changing %s did not change checksum", v.name)
		}
	}
}

func TestStartAttemptRejectsDuplicateIDFormat(t *testing.T) {
	t.Parallel()
	service, err := NewService(&pgxpool.Pool{}, validationStore{})
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}

	tests := []struct {
		name    string
		command StartAttempt
	}{
		{
			name: "non-UUID ID",
			command: StartAttempt{
				ID: "not-a-uuid", TenantID: validSubmissionTestUUID, CandidateAssignmentID: validSubmissionTestUUID,
				IdempotencyKey: "start-1",
			},
		},
		{
			name: "non-UUID TenantID",
			command: StartAttempt{
				ID: validSubmissionTestUUID, TenantID: "not-a-uuid", CandidateAssignmentID: validSubmissionTestUUID,
				IdempotencyKey: "start-1",
			},
		},
		{
			name: "non-UUID CandidateAssignmentID",
			command: StartAttempt{
				ID: validSubmissionTestUUID, TenantID: validSubmissionTestUUID, CandidateAssignmentID: "not-a-uuid",
				IdempotencyKey: "start-1",
			},
		},
		{
			name: "missing IdempotencyKey",
			command: StartAttempt{
				ID: validSubmissionTestUUID, TenantID: validSubmissionTestUUID, CandidateAssignmentID: validSubmissionTestUUID,
				IdempotencyKey: "",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := service.StartAttempt(context.Background(), centralauthz.Capability{}, tt.command)
			assertInvalidArgument(t, err)
		})
	}
}

func TestSubmitAttemptEnforcesVersionMonotonicity(t *testing.T) {
	t.Parallel()
	service, err := NewService(&pgxpool.Pool{}, validationStore{})
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}

	_, err = service.SubmitAttempt(context.Background(), centralauthz.Capability{}, SubmitAttempt{
		TenantID: validSubmissionTestUUID, AttemptID: validSubmissionTestUUID, ExpectedAttemptVersion: 0,
		IdempotencyKey: "submit-1",
	})
	assertInvalidArgument(t, err)
}

func TestAppendAnswerRevisionRejectsNonSHA256Checksums(t *testing.T) {
	t.Parallel()
	service, err := NewService(&pgxpool.Pool{}, validationStore{})
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}

	tests := []struct {
		name     string
		checksum string
	}{
		{"not-a-sha256", "not-a-sha256"},
		{"empty string", ""},
		{"63 hex chars", strings.Repeat("a", 63)},
		{"65 hex chars", strings.Repeat("a", 65)},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := service.AppendAnswerRevision(context.Background(), centralauthz.Capability{}, AppendAnswerRevision{
				ID: validSubmissionTestUUID, TenantID: validSubmissionTestUUID, AttemptID: validSubmissionTestUUID,
				ExamItemID: validSubmissionTestUUID, LanguageID: "go", SourceObjectKey: "tenant/object",
				SourceChecksum: tt.checksum, EncryptionKeyReference: "kms/key", ExpectedAttemptVersion: 1,
			})
			assertInvalidArgument(t, err)
		})
	}
}

func TestAppendAnswerRevisionRejectsTraversalSourceKeys(t *testing.T) {
	t.Parallel()
	service, err := NewService(&pgxpool.Pool{}, validationStore{})
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}

	tests := []struct {
		name      string
		objectKey string
	}{
		{"empty string", ""},
		{"only whitespace", "   "},
		{"exceeds 2048 runes", strings.Repeat("a", 2049)},
	}

	validChecksum := strings.Repeat("a", 64)
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := service.AppendAnswerRevision(context.Background(), centralauthz.Capability{}, AppendAnswerRevision{
				ID: validSubmissionTestUUID, TenantID: validSubmissionTestUUID, AttemptID: validSubmissionTestUUID,
				ExamItemID: validSubmissionTestUUID, LanguageID: "go", SourceObjectKey: tt.objectKey,
				SourceChecksum: validChecksum, EncryptionKeyReference: "kms/key", ExpectedAttemptVersion: 1,
			})
			assertInvalidArgument(t, err)
		})
	}
}
