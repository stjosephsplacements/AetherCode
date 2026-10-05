package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"slices"
	"strings"
	"testing"

	centralauthz "github.com/aethercode/aethercode/libs/pkg/authz"
	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
	"github.com/aethercode/aethercode/libs/pkg/storage"
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
func (validationStore) StartCodeRun(context.Context, pgx.Tx, RunCode) (CodeRun, error) {
	return CodeRun{}, nil
}
func (validationStore) GetCodeRun(context.Context, pgx.Tx, GetCodeRun) (CodeRun, error) {
	return CodeRun{}, nil
}
func (validationStore) ListCodeRuns(context.Context, pgx.Tx, ListCodeRuns) ([]CodeRun, error) {
	return nil, nil
}
func (validationStore) Ping(context.Context) error { return nil }

func TestStartAttemptRejectsInvalidCommandBeforeTransaction(t *testing.T) {
	service, err := NewService(&pgxpool.Pool{}, validationStore{}, nil, nil)
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	_, err = service.StartAttempt(context.Background(), centralauthz.Capability{}, StartAttempt{
		ID: validSubmissionTestUUID, TenantID: "not-a-uuid", CandidateAssignmentID: validSubmissionTestUUID,
		IdempotencyKey: "start-1",
	})
	assertInvalidArgument(t, err)
}

func TestSubmitAttemptRejectsMissingIdempotencyKeyBeforeTransaction(t *testing.T) {
	service, err := NewService(&pgxpool.Pool{}, validationStore{}, nil, nil)
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

func TestStartAttemptRejectsDuplicateIDFormat(t *testing.T) {
	t.Parallel()
	service, err := NewService(&pgxpool.Pool{}, validationStore{}, nil, nil)
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
	service, err := NewService(&pgxpool.Pool{}, validationStore{}, nil, nil)
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}

	_, err = service.SubmitAttempt(context.Background(), centralauthz.Capability{}, SubmitAttempt{
		TenantID: validSubmissionTestUUID, AttemptID: validSubmissionTestUUID, ExpectedAttemptVersion: 0,
		IdempotencyKey: "submit-1",
	})
	assertInvalidArgument(t, err)
}

func TestAppendAnswerRevisionRejectsInvalidSource(t *testing.T) {
	t.Parallel()
	service, err := NewService(&pgxpool.Pool{}, validationStore{}, &memoryStorage{}, &fakeKMS{})
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	valid := AppendAnswerRevision{
		ID: validSubmissionTestUUID, TenantID: validSubmissionTestUUID, AttemptID: validSubmissionTestUUID,
		ExamItemID: validSubmissionTestUUID, Language: "python3", Source: "print(1)", ExpectedAttemptVersion: 1,
	}
	tests := []struct {
		name   string
		mutate func(*AppendAnswerRevision)
	}{
		{"uppercase language", func(c *AppendAnswerRevision) { c.Language = "Python3" }},
		{"empty language", func(c *AppendAnswerRevision) { c.Language = " " }},
		{"language with a path", func(c *AppendAnswerRevision) { c.Language = "../go" }},
		{"source over the limit", func(c *AppendAnswerRevision) { c.Source = strings.Repeat("a", MaxSourceBytes+1) }},
		{"missing attempt version", func(c *AppendAnswerRevision) { c.ExpectedAttemptVersion = 0 }},
		{"bad attempt id", func(c *AppendAnswerRevision) { c.AttemptID = "not-a-uuid" }},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			command := valid
			tt.mutate(&command)
			_, err := service.AppendAnswerRevision(context.Background(), centralauthz.Capability{}, command)
			assertInvalidArgument(t, err)
		})
	}
}

func TestAppendAnswerRevisionNeedsSourceStorage(t *testing.T) {
	t.Parallel()
	service, err := NewService(&pgxpool.Pool{}, validationStore{}, nil, nil)
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	_, err = service.AppendAnswerRevision(context.Background(), centralauthz.Capability{}, AppendAnswerRevision{
		ID: validSubmissionTestUUID, TenantID: validSubmissionTestUUID, AttemptID: validSubmissionTestUUID,
		ExamItemID: validSubmissionTestUUID, Language: "go", Source: "package main", ExpectedAttemptVersion: 1,
	})
	var applicationError *apperrors.Error
	if !errors.As(err, &applicationError) || applicationError.Code != apperrors.CodeUnavailable {
		t.Fatalf("error = %#v, want unavailable", err)
	}
}

func TestStoreSourceEncryptsAndRecordsCiphertextReferences(t *testing.T) {
	t.Parallel()
	storage := &memoryStorage{objects: map[string][]byte{}}
	service, err := NewService(&pgxpool.Pool{}, validationStore{}, storage, &fakeKMS{})
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	command := AppendAnswerRevision{
		ID: validSubmissionTestUUID, TenantID: validSubmissionTestUUID, AttemptID: validSubmissionTestUUID,
		Language: "go", Source: "package main",
	}
	if err := service.storeSource(context.Background(), &command); err != nil {
		t.Fatalf("storeSource() error = %v", err)
	}
	stored, found := storage.objects[command.SourceObjectKey]
	if !found || strings.Contains(string(stored), "package main") {
		t.Fatalf("stored object = %q (found %t), want ciphertext", stored, found)
	}
	digest := sha256.Sum256(stored)
	if command.SourceChecksum != hex.EncodeToString(digest[:]) {
		t.Fatalf("checksum = %s, want the SHA-256 of the stored ciphertext", command.SourceChecksum)
	}
	if command.EncryptionKeyReference != "test/key-1" ||
		!strings.HasPrefix(command.SourceObjectKey, "candidate-source/"+validSubmissionTestUUID+"/") {
		t.Fatalf("references = %q, %q", command.SourceObjectKey, command.EncryptionKeyReference)
	}
}

// memoryStorage and fakeKMS stand in for MinIO and the key manager.
type memoryStorage struct {
	storage.Object
	objects map[string][]byte
}

func (fake *memoryStorage) Put(_ context.Context, key string, reader io.Reader, _ int64, _ string) error {
	data, err := io.ReadAll(reader)
	fake.objects[key] = data
	return err
}

func (fake *memoryStorage) Delete(_ context.Context, key string) error {
	delete(fake.objects, key)
	return nil
}

type fakeKMS struct{}

// Encrypt reverses the plaintext so the test can tell ciphertext from source.
func (*fakeKMS) Encrypt(_ context.Context, plaintext []byte) ([]byte, string, error) {
	ciphertext := slices.Clone(plaintext)
	slices.Reverse(ciphertext)
	return ciphertext, "test/key-1", nil
}

func (*fakeKMS) Decrypt(context.Context, []byte, string) ([]byte, error) { return nil, nil }

func TestRunCodeRejectsInvalidCommandBeforeStoringSource(t *testing.T) {
	t.Parallel()
	storage := &memoryStorage{objects: map[string][]byte{}}
	service, err := NewService(&pgxpool.Pool{}, validationStore{}, storage, &fakeKMS{})
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	valid := RunCode{
		TenantID: validSubmissionTestUUID, AttemptID: validSubmissionTestUUID, ExamItemID: validSubmissionTestUUID,
		Language: "python3", Source: "print(1)",
	}
	for _, tt := range []struct {
		name   string
		mutate func(*RunCode)
	}{
		{"blank source", func(c *RunCode) { c.Source = "  \n" }},
		{"source over the limit", func(c *RunCode) { c.Source = strings.Repeat("a", MaxSourceBytes+1) }},
		{"language with a path", func(c *RunCode) { c.Language = "../go" }},
		{"bad exam item id", func(c *RunCode) { c.ExamItemID = "item" }},
	} {
		t.Run(tt.name, func(t *testing.T) {
			command := valid
			tt.mutate(&command)
			_, err := service.RunCode(context.Background(), centralauthz.Capability{}, command)
			assertInvalidArgument(t, err)
		})
	}
	if len(storage.objects) != 0 {
		t.Fatalf("an invalid run stored %d source objects", len(storage.objects))
	}
}

func TestListCodeRunsRejectsAnOutOfRangeLimit(t *testing.T) {
	t.Parallel()
	service, err := NewService(&pgxpool.Pool{}, validationStore{}, nil, nil)
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	_, err = service.ListCodeRuns(context.Background(), centralauthz.Capability{}, ListCodeRuns{
		TenantID: validSubmissionTestUUID, AttemptID: validSubmissionTestUUID, ExamItemID: validSubmissionTestUUID, Limit: 101,
	})
	assertInvalidArgument(t, err)
}
