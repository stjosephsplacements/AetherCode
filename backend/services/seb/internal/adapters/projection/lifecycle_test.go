package projection

import (
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/aethercode/aethercode/libs/pkg/messaging"
	"github.com/google/uuid"
)

func TestParseAttemptSubmittedRejectsInvalidPayload(t *testing.T) {
	t.Parallel()
	validTenantID := uuid.New().String()
	validAttemptID := uuid.New().String()
	validCandidateID := uuid.New().String()

	tests := []struct {
		name    string
		payload attemptSubmittedPayload
		wantErr bool
	}{
		{
			name: "valid payload",
			payload: attemptSubmittedPayload{
				TenantID:    validTenantID,
				AttemptID:   validAttemptID,
				CandidateID: validCandidateID,
			},
			wantErr: false,
		},
		{
			name: "missing tenant_id",
			payload: attemptSubmittedPayload{
				TenantID:    "",
				AttemptID:   validAttemptID,
				CandidateID: validCandidateID,
			},
			wantErr: true,
		},
		{
			name: "missing attempt_id",
			payload: attemptSubmittedPayload{
				TenantID:    validTenantID,
				AttemptID:   "",
				CandidateID: validCandidateID,
			},
			wantErr: true,
		},
		{
			name: "missing candidate_id",
			payload: attemptSubmittedPayload{
				TenantID:    validTenantID,
				AttemptID:   validAttemptID,
				CandidateID: "",
			},
			wantErr: true,
		},
		{
			name: "invalid tenant_id UUID",
			payload: attemptSubmittedPayload{
				TenantID:    "not-a-uuid",
				AttemptID:   validAttemptID,
				CandidateID: validCandidateID,
			},
			wantErr: true,
		},
		{
			name: "invalid attempt_id UUID",
			payload: attemptSubmittedPayload{
				TenantID:    validTenantID,
				AttemptID:   "not-a-uuid",
				CandidateID: validCandidateID,
			},
			wantErr: true,
		},
		{
			name: "invalid candidate_id UUID",
			payload: attemptSubmittedPayload{
				TenantID:    validTenantID,
				AttemptID:   validAttemptID,
				CandidateID: "not-a-uuid",
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			payloadBytes, err := json.Marshal(tt.payload)
			if err != nil {
				t.Fatalf("marshal payload: %v", err)
			}
			event := messaging.Event{
				ID:            uuid.New().String(),
				Type:          AttemptSubmittedEventType,
				SchemaVersion: 1,
				Payload:       payloadBytes,
				OccurredAt:    time.Now().UTC(),
			}
			_, err = parseAttemptSubmitted(event)
			if (err != nil) != tt.wantErr {
				t.Errorf("parseAttemptSubmitted() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

// TestParsesProducerPayloads feeds the payloads exactly as Submission and
// Assessment write them; the extra fields once made every real event fail.
func TestParsesProducerPayloads(t *testing.T) {
	t.Parallel()
	tenantID, assignmentID, candidateID, examID := uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString()
	submitted := fmt.Sprintf(`{"tenant_id":%q,"attempt_id":%q,"candidate_assignment_id":%q,"candidate_id":%q,
		"exam_id":%q,"exam_version_id":%q,"evaluation_request_count":2,"submitted_at":"2026-10-05T10:00:00.123456+00:00"}`,
		tenantID, uuid.NewString(), assignmentID, candidateID, examID, uuid.NewString())
	if _, err := parseAttemptSubmitted(event(AttemptSubmittedEventType, submitted)); err != nil {
		t.Fatalf("parseAttemptSubmitted() error = %v", err)
	}
	snapshot := fmt.Sprintf(`{"tenant_id":%q,"candidate_assignment_id":%q,"candidate_id":%q,"exam_id":%q,
		"exam_version_id":%q,"available_from":"2026-10-05T09:00:00.000000Z","available_until":"2026-10-05T12:00:00.000000Z",
		"attempt_limit":1,"duration_seconds":3600,"lifecycle_state":"active","version":3,"items":[{"exam_item_id":%q}]}`,
		tenantID, assignmentID, candidateID, examID, uuid.NewString(), uuid.NewString())
	parsed, err := parseAssignmentSnapshot(event(AssignmentSnapshotEventType, snapshot))
	if err != nil {
		t.Fatalf("parseAssignmentSnapshot() error = %v", err)
	}
	if parsed.ExamID != examID || parsed.Version != 3 || parsed.AvailableUntil == nil ||
		!parsed.AvailableUntil.Equal(time.Date(2026, 10, 5, 12, 0, 0, 0, time.UTC)) {
		t.Fatalf("parseAssignmentSnapshot() = %+v", parsed)
	}
}

func TestParseAssignmentSnapshotRejectsInvalidPayload(t *testing.T) {
	t.Parallel()
	valid := func() assignmentSnapshotPayload {
		return assignmentSnapshotPayload{
			TenantID: uuid.NewString(), CandidateAssignmentID: uuid.NewString(), CandidateID: uuid.NewString(),
			ExamID: uuid.NewString(), LifecycleState: "revoked", Version: 1,
		}
	}
	tests := []struct {
		name    string
		mutate  func(*assignmentSnapshotPayload)
		wantErr bool
	}{
		{"valid revoked payload", func(*assignmentSnapshotPayload) {}, false},
		{"valid active payload without a window", func(payload *assignmentSnapshotPayload) { payload.LifecycleState = "active" }, false},
		{"invalid tenant_id", func(payload *assignmentSnapshotPayload) { payload.TenantID = "not-a-uuid" }, true},
		{"missing candidate_assignment_id", func(payload *assignmentSnapshotPayload) { payload.CandidateAssignmentID = "" }, true},
		{"invalid candidate_id", func(payload *assignmentSnapshotPayload) { payload.CandidateID = "not-a-uuid" }, true},
		{"missing exam_id", func(payload *assignmentSnapshotPayload) { payload.ExamID = "" }, true},
		{"missing version", func(payload *assignmentSnapshotPayload) { payload.Version = 0 }, true},
		{"invalid lifecycle_state", func(payload *assignmentSnapshotPayload) { payload.LifecycleState = "pending" }, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			payload := valid()
			tt.mutate(&payload)
			raw, err := json.Marshal(payload)
			if err != nil {
				t.Fatalf("marshal payload: %v", err)
			}
			_, err = parseAssignmentSnapshot(event(AssignmentSnapshotEventType, string(raw)))
			if (err != nil) != tt.wantErr {
				t.Errorf("parseAssignmentSnapshot() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func event(eventType, payload string) messaging.Event {
	return messaging.Event{
		ID: uuid.NewString(), Type: eventType, SchemaVersion: 1,
		Payload: []byte(payload), OccurredAt: time.Now().UTC(),
	}
}
