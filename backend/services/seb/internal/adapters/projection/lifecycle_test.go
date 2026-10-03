package projection

import (
	"encoding/json"
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

func TestParseAssignmentRevokedSkipsActiveLifecycle(t *testing.T) {
	t.Parallel()
	payload := assignmentSnapshotPayload{
		TenantID:              uuid.New().String(),
		CandidateAssignmentID: uuid.New().String(),
		CandidateID:           uuid.New().String(),
		LifecycleState:        "active",
	}
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	event := messaging.Event{
		ID:            uuid.New().String(),
		Type:          AssignmentRevokedEventType,
		SchemaVersion: 1,
		Payload:       payloadBytes,
		OccurredAt:    time.Now().UTC(),
	}
	parsed, err := parseAssignmentSnapshot(event)
	if err != nil {
		t.Fatalf("parseAssignmentSnapshot() error = %v, want nil", err)
	}
	if parsed.LifecycleState != "active" {
		t.Errorf("parseAssignmentSnapshot() lifecycle_state = %v, want active", parsed.LifecycleState)
	}
}

func TestParseAssignmentRevokedRejectsInvalidPayload(t *testing.T) {
	t.Parallel()
	validTenantID := uuid.New().String()
	validAssignmentID := uuid.New().String()
	validCandidateID := uuid.New().String()

	tests := []struct {
		name    string
		payload assignmentSnapshotPayload
		wantErr bool
	}{
		{
			name: "valid revoked payload",
			payload: assignmentSnapshotPayload{
				TenantID:              validTenantID,
				CandidateAssignmentID: validAssignmentID,
				CandidateID:           validCandidateID,
				LifecycleState:        "revoked",
			},
			wantErr: false,
		},
		{
			name: "valid active payload",
			payload: assignmentSnapshotPayload{
				TenantID:              validTenantID,
				CandidateAssignmentID: validAssignmentID,
				CandidateID:           validCandidateID,
				LifecycleState:        "active",
			},
			wantErr: false,
		},
		{
			name: "missing tenant_id",
			payload: assignmentSnapshotPayload{
				TenantID:              "",
				CandidateAssignmentID: validAssignmentID,
				CandidateID:           validCandidateID,
				LifecycleState:        "revoked",
			},
			wantErr: true,
		},
		{
			name: "missing candidate_assignment_id",
			payload: assignmentSnapshotPayload{
				TenantID:              validTenantID,
				CandidateAssignmentID: "",
				CandidateID:           validCandidateID,
				LifecycleState:        "revoked",
			},
			wantErr: true,
		},
		{
			name: "missing candidate_id",
			payload: assignmentSnapshotPayload{
				TenantID:              validTenantID,
				CandidateAssignmentID: validAssignmentID,
				CandidateID:           "",
				LifecycleState:        "revoked",
			},
			wantErr: true,
		},
		{
			name: "invalid tenant_id UUID",
			payload: assignmentSnapshotPayload{
				TenantID:              "not-a-uuid",
				CandidateAssignmentID: validAssignmentID,
				CandidateID:           validCandidateID,
				LifecycleState:        "revoked",
			},
			wantErr: true,
		},
		{
			name: "invalid candidate_assignment_id UUID",
			payload: assignmentSnapshotPayload{
				TenantID:              validTenantID,
				CandidateAssignmentID: "not-a-uuid",
				CandidateID:           validCandidateID,
				LifecycleState:        "revoked",
			},
			wantErr: true,
		},
		{
			name: "invalid candidate_id UUID",
			payload: assignmentSnapshotPayload{
				TenantID:              validTenantID,
				CandidateAssignmentID: validAssignmentID,
				CandidateID:           "not-a-uuid",
				LifecycleState:        "revoked",
			},
			wantErr: true,
		},
		{
			name: "invalid lifecycle_state",
			payload: assignmentSnapshotPayload{
				TenantID:              validTenantID,
				CandidateAssignmentID: validAssignmentID,
				CandidateID:           validCandidateID,
				LifecycleState:        "pending",
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
				Type:          AssignmentRevokedEventType,
				SchemaVersion: 1,
				Payload:       payloadBytes,
				OccurredAt:    time.Now().UTC(),
			}
			_, err = parseAssignmentSnapshot(event)
			if (err != nil) != tt.wantErr {
				t.Errorf("parseAssignmentSnapshot() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}
