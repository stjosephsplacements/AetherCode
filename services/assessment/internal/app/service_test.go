package app

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	centralauthz "github.com/aethercode/aethercode/libs/pkg/authz"
	apperrors "github.com/aethercode/aethercode/libs/pkg/errors"
)

func TestCanonicalJSONObjectNormalizesAndChecksumsPolicy(t *testing.T) {
	t.Parallel()
	canonical, checksum, err := canonicalJSONObject(json.RawMessage(` { "b": 2, "a": 1 } `), 1024)
	if err != nil {
		t.Fatalf("canonicalJSONObject() error = %v", err)
	}
	if got, want := string(canonical), `{"a":1,"b":2}`; got != want {
		t.Fatalf("canonical = %s, want %s", got, want)
	}
	digest := sha256.Sum256(canonical)
	if got, want := checksum, hex.EncodeToString(digest[:]); got != want {
		t.Fatalf("checksum = %s, want %s", got, want)
	}
}

func TestCanonicalJSONObjectRejectsArraysAndOversizePayloads(t *testing.T) {
	t.Parallel()
	for _, payload := range []json.RawMessage{json.RawMessage(`[]`), json.RawMessage(`null`), json.RawMessage(`{"very_long":"value"}`)} {
		maximum := 1024
		if string(payload) == `{"very_long":"value"}` {
			maximum = 8
		}
		if _, _, err := canonicalJSONObject(payload, maximum); err == nil {
			t.Fatalf("canonicalJSONObject(%s) accepted invalid object", payload)
		}
	}
}

func TestValidationRejectsInvalidScoreAndExamWindow(t *testing.T) {
	t.Parallel()
	for _, score := range []string{"0", "0.0000", "01", "1.00001", "x", ""} {
		if validScore(score) {
			t.Fatalf("validScore(%q) = true", score)
		}
	}
	if !validScore("0.0001") || !validScore("10000000.0000") {
		t.Fatal("validScore rejected a permitted positive numeric value")
	}

	service := &Service{}
	start := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	_, err := service.CreateExamVersion(t.Context(), centralauthz.Capability{}, CreateExamVersion{
		ID:                     "bad",
		TenantID:               "bad",
		ExamID:                 "bad",
		ExpectedExamVersion:    1,
		Title:                  "Exam",
		InstructionsMarkdown:   "Instructions",
		OpensAt:                start,
		ClosesAt:               start,
		DurationSeconds:        60,
		ProctorPolicyVersionID: "bad",
	})
	if err == nil {
		t.Fatal("CreateExamVersion accepted an invalid window before opening a transaction")
	}
}

func TestValidIdempotencyKey(t *testing.T) {
	t.Parallel()
	for _, testCase := range []struct {
		key   string
		valid bool
	}{
		{key: "assessment-create:01JTEST", valid: true},
		{key: "", valid: false},
		{key: "contains space", valid: false},
		{key: "line\nbreak", valid: false},
	} {
		if got := validIdempotencyKey(testCase.key); got != testCase.valid {
			t.Fatalf("validIdempotencyKey(%q) = %t, want %t", testCase.key, got, testCase.valid)
		}
	}
}

func TestRevokeCandidateAssignmentRejectsMissingOptimisticVersion(t *testing.T) {
	t.Parallel()
	service := &Service{}
	_, err := service.RevokeCandidateAssignment(t.Context(), centralauthz.Capability{}, RevokeCandidateAssignment{
		TenantID:              "00000000-0000-7000-8000-000000000001",
		CandidateAssignmentID: "00000000-0000-7000-8000-000000000002",
		ExpectedVersion:       0,
	})
	if err == nil {
		t.Fatal("RevokeCandidateAssignment accepted a missing optimistic version before opening a transaction")
	}
}

func assertInvalid(t *testing.T, err error) {
	t.Helper()
	var appErr *apperrors.Error
	if !errors.As(err, &appErr) || appErr.Code != apperrors.CodeInvalidArgument {
		t.Fatalf("error = %v, want invalid argument", err)
	}
}

func TestMaterializeDirectCandidateAssignmentRejectsInvalidFields(t *testing.T) {
	t.Parallel()
	service := &Service{pool: nil, store: nil}
	validUUID := "00000000-0000-7000-8000-000000000001"
	testCases := []struct {
		name    string
		command MaterializeDirectCandidateAssignment
	}{
		{
			name: "non-UUID ID",
			command: MaterializeDirectCandidateAssignment{
				WriteCommand:     WriteCommand{IdempotencyKey: "test:key"},
				ID:               "bad",
				TenantID:         validUUID,
				AssignmentRuleID: validUUID,
				CandidateID:      validUUID,
			},
		},
		{
			name: "non-UUID TenantID",
			command: MaterializeDirectCandidateAssignment{
				WriteCommand:     WriteCommand{IdempotencyKey: "test:key"},
				ID:               validUUID,
				TenantID:         "bad",
				AssignmentRuleID: validUUID,
				CandidateID:      validUUID,
			},
		},
		{
			name: "non-UUID AssignmentRuleID",
			command: MaterializeDirectCandidateAssignment{
				WriteCommand:     WriteCommand{IdempotencyKey: "test:key"},
				ID:               validUUID,
				TenantID:         validUUID,
				AssignmentRuleID: "bad",
				CandidateID:      validUUID,
			},
		},
		{
			name: "non-UUID CandidateID",
			command: MaterializeDirectCandidateAssignment{
				WriteCommand:     WriteCommand{IdempotencyKey: "test:key"},
				ID:               validUUID,
				TenantID:         validUUID,
				AssignmentRuleID: validUUID,
				CandidateID:      "bad",
			},
		},
		{
			name: "missing idempotency key",
			command: MaterializeDirectCandidateAssignment{
				WriteCommand:     WriteCommand{IdempotencyKey: ""},
				ID:               validUUID,
				TenantID:         validUUID,
				AssignmentRuleID: validUUID,
				CandidateID:      validUUID,
			},
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			_, err := service.MaterializeDirectCandidateAssignment(t.Context(), centralauthz.Capability{}, tc.command)
			assertInvalid(t, err)
		})
	}
}

func TestPublishExamVersionEnforcesOptimisticConcurrency(t *testing.T) {
	t.Parallel()
	service := &Service{pool: nil, store: nil}
	validUUID := "00000000-0000-7000-8000-000000000001"

	testCases := []struct {
		name    string
		command PublishExamVersion
	}{
		{
			name: "ExpectedContentVersion zero",
			command: PublishExamVersion{
				WriteCommand:           WriteCommand{IdempotencyKey: "test:key"},
				TenantID:               validUUID,
				ExamVersionID:          validUUID,
				ExpectedContentVersion: 0,
			},
		},
		{
			name: "ExpectedContentVersion negative",
			command: PublishExamVersion{
				WriteCommand:           WriteCommand{IdempotencyKey: "test:key"},
				TenantID:               validUUID,
				ExamVersionID:          validUUID,
				ExpectedContentVersion: -1,
			},
		},
		{
			name: "non-UUID ExamVersionID",
			command: PublishExamVersion{
				WriteCommand:           WriteCommand{IdempotencyKey: "test:key"},
				TenantID:               validUUID,
				ExamVersionID:          "bad",
				ExpectedContentVersion: 1,
			},
		},
		{
			name: "non-UUID TenantID",
			command: PublishExamVersion{
				WriteCommand:           WriteCommand{IdempotencyKey: "test:key"},
				TenantID:               "bad",
				ExamVersionID:          validUUID,
				ExpectedContentVersion: 1,
			},
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			_, err := service.PublishExamVersion(t.Context(), centralauthz.Capability{}, tc.command)
			assertInvalid(t, err)
		})
	}
}

func TestAddExamItemRejectsTraversalObjectKeys(t *testing.T) {
	t.Parallel()
	service := &Service{pool: nil, store: nil}
	validUUID := "00000000-0000-7000-8000-000000000001"

	testCases := []struct {
		name      string
		objectKey string
	}{
		{
			name:      "object key containing ..",
			objectKey: "path/../traversal",
		},
		{
			name:      "object key starting with /",
			objectKey: "/absolute/path",
		},
		{
			name:      "object key with control character",
			objectKey: "path\nwith\nnewline",
		},
		{
			name:      "object key with tab",
			objectKey: "path\twith\ttab",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			_, err := service.AddExamItem(t.Context(), centralauthz.Capability{}, AddExamItem{
				WriteCommand:              WriteCommand{IdempotencyKey: "test:key"},
				ID:                        validUUID,
				TenantID:                  validUUID,
				ExamVersionID:             validUUID,
				SectionID:                 validUUID,
				ExpectedContentVersion:    1,
				Position:                  1,
				QuestionID:                validUUID,
				QuestionVersionID:         validUUID,
				MaximumScore:              "10.0000",
				EvaluationBundleObjectKey: tc.objectKey,
				EvaluationBundleChecksum:  strings.Repeat("a", 64),
			})
			assertInvalid(t, err)
		})
	}
}

func TestCreateAssignmentRuleRejectsInvalidTargetType(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		name       string
		targetType string
		valid      bool
	}{
		{name: "department is accepted", targetType: "department", valid: true},
		{name: "batch is accepted", targetType: "batch", valid: true},
		{name: "placement_department is accepted", targetType: "placement_department", valid: true},
		{name: "student is accepted", targetType: "student", valid: true},
		{name: "admin is rejected", targetType: "admin", valid: false},
		{name: "global is rejected", targetType: "global", valid: false},
		{name: "empty string is rejected", targetType: "", valid: false},
		{name: "BATCH uppercase is rejected", targetType: "BATCH", valid: false},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := validTargetType(tc.targetType)
			if got != tc.valid {
				t.Fatalf("validTargetType(%q) = %t, want %t", tc.targetType, got, tc.valid)
			}
		})
	}
}

func TestUpdateExamRejectsInvalidFields(t *testing.T) {
	t.Parallel()
	service := &Service{pool: nil, store: nil}
	validUUID := "00000000-0000-7000-8000-000000000001"

	testCases := []struct {
		name    string
		command UpdateExam
	}{
		{
			name: "non-UUID ID",
			command: UpdateExam{
				ID: "bad", TenantID: validUUID, ExpectedVersion: 1,
			},
		},
		{
			name: "non-UUID TenantID",
			command: UpdateExam{
				ID: validUUID, TenantID: "bad", ExpectedVersion: 1,
			},
		},
		{
			name: "zero expected version",
			command: UpdateExam{
				ID: validUUID, TenantID: validUUID, ExpectedVersion: 0,
			},
		},
		{
			name: "negative expected version",
			command: UpdateExam{
				ID: validUUID, TenantID: validUUID, ExpectedVersion: -1,
			},
		},
		{
			name: "external_reference exceeds 160 characters",
			command: UpdateExam{
				ID: validUUID, TenantID: validUUID, ExpectedVersion: 1,
				ExternalReference: strings.Repeat("x", 161),
			},
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			_, err := service.UpdateExam(t.Context(), centralauthz.Capability{}, tc.command)
			assertInvalid(t, err)
		})
	}
}

func TestUpdateExamAcceptsValidFields(t *testing.T) {
	t.Parallel()
	service := &Service{pool: nil, store: nil}
	validUUID := "00000000-0000-7000-8000-000000000001"

	testCases := []struct {
		name    string
		command UpdateExam
	}{
		{
			name: "empty external_reference is allowed",
			command: UpdateExam{
				ID: validUUID, TenantID: validUUID, ExpectedVersion: 1, ExternalReference: "",
			},
		},
		{
			name: "external_reference at max length is allowed",
			command: UpdateExam{
				ID: validUUID, TenantID: validUUID, ExpectedVersion: 1,
				ExternalReference: strings.Repeat("x", 160),
			},
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			// Validation passes; the call fails only when it tries to open a DB
			// connection against the nil pool — not with an invalid-argument error.
			_, err := service.UpdateExam(t.Context(), centralauthz.Capability{}, tc.command)
			var appErr *apperrors.Error
			if errors.As(err, &appErr) && appErr.Code == apperrors.CodeInvalidArgument {
				t.Fatalf("UpdateExam rejected valid input: %v", err)
			}
		})
	}
}

func TestRunWriteIdempotencyKeyBoundaryConditions(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		name  string
		key   string
		valid bool
	}{
		{
			name:  "key of length 0 is rejected",
			key:   "",
			valid: false,
		},
		{
			name:  "key of length 256 is rejected",
			key:   strings.Repeat("a", 256),
			valid: false,
		},
		{
			name:  "key with embedded newline is rejected",
			key:   "line\nbreak",
			valid: false,
		},
		{
			name:  "key with space is rejected",
			key:   "contains space",
			valid: false,
		},
		{
			name:  "key of length 255 with printable ASCII is accepted",
			key:   strings.Repeat("!", 255),
			valid: true,
		},
		{
			name:  "key with all printable range is accepted",
			key:   "!\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~",
			valid: true,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := validIdempotencyKey(tc.key)
			if got != tc.valid {
				t.Fatalf("validIdempotencyKey(%q) = %t, want %t", tc.key, got, tc.valid)
			}
		})
	}
}
