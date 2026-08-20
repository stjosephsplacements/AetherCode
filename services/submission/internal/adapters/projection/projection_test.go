package projection

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/aethercode/aethercode/libs/pkg/messaging"
)

const projectionTestUUID = "019c06d6-20e1-7a21-8a4f-bd8b21a43f18"

func TestParseAssignmentSnapshotAcceptsImmutableItemManifest(t *testing.T) {
	payload, err := json.Marshal(map[string]any{
		"tenant_id":               projectionTestUUID,
		"candidate_assignment_id": projectionTestUUID,
		"candidate_id":            projectionTestUUID,
		"exam_id":                 projectionTestUUID,
		"exam_version_id":         projectionTestUUID,
		"available_from":          "2026-07-24T10:00:00Z",
		"available_until":         "2026-07-24T11:00:00Z",
		"attempt_limit":           1,
		"lifecycle_state":         "active",
		"version":                 1,
		"items": []map[string]any{{
			"exam_item_id":                 projectionTestUUID,
			"evaluation_bundle_object_key": "qbank/evaluation/manifest.enc",
			"evaluation_bundle_checksum":   "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			"maximum_score":                10.0,
		}},
	})
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	parsed, err := parseAssignmentSnapshot(messaging.Event{
		ID: projectionTestUUID, Type: AssignmentSnapshotEventType, SchemaVersion: 1,
		AggregateType: "candidate_assignment", AggregateID: projectionTestUUID, TenantID: projectionTestUUID,
		OccurredAt: time.Now().UTC(), Payload: payload,
	})
	if err != nil {
		t.Fatalf("parseAssignmentSnapshot() error = %v", err)
	}
	if len(parsed.Items) != 1 || parsed.Items[0].EvaluationBundleObjectKey == "" {
		t.Fatalf("parsed assignment = %#v", parsed)
	}
}

func TestParseAssignmentSnapshotAcceptsRevocationWithoutLegacyItems(t *testing.T) {
	payload, err := json.Marshal(map[string]any{
		"tenant_id":               projectionTestUUID,
		"candidate_assignment_id": projectionTestUUID,
		"candidate_id":            projectionTestUUID,
		"exam_id":                 projectionTestUUID,
		"exam_version_id":         projectionTestUUID,
		"available_from":          "2026-07-24T10:00:00Z",
		"available_until":         "2026-07-24T11:00:00Z",
		"attempt_limit":           1,
		"lifecycle_state":         "revoked",
		"version":                 2,
		"items":                   []map[string]any{},
	})
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	parsed, err := parseAssignmentSnapshot(messaging.Event{
		ID: projectionTestUUID, Type: AssignmentSnapshotEventType, SchemaVersion: 1,
		AggregateType: "candidate_assignment", AggregateID: projectionTestUUID, TenantID: projectionTestUUID,
		OccurredAt: time.Now().UTC(), Payload: payload,
	})
	if err != nil {
		t.Fatalf("parseAssignmentSnapshot() error = %v", err)
	}
	if parsed.LifecycleState != "revoked" || len(parsed.Items) != 0 {
		t.Fatalf("parsed revocation = %#v", parsed)
	}
}

func TestParseJudgeCompletedRejectsPartialEncryptedResultReference(t *testing.T) {
	payload, err := json.Marshal(map[string]any{
		"tenant_id":             projectionTestUUID,
		"evaluation_request_id": projectionTestUUID,
		"judge_job_id":          projectionTestUUID,
		"judge_event_id":        projectionTestUUID,
		"verdict":               "accepted",
		"result_object_key":     "results/output.enc",
	})
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	_, err = parseJudgeCompleted(messaging.Event{
		ID: projectionTestUUID, Type: JudgeCompletedEventType, SchemaVersion: 1,
		AggregateType: "execution_job", AggregateID: projectionTestUUID, TenantID: projectionTestUUID,
		OccurredAt: time.Now().UTC(), Payload: payload,
	})
	if err == nil {
		t.Fatal("partial encrypted result reference must be rejected")
	}
}

func TestParseJudgeCompletedBindsCanonicalCompletionTimeToEnvelope(t *testing.T) {
	completedAt := time.Date(2026, 7, 24, 10, 0, 0, 123000000, time.UTC)
	payload, err := json.Marshal(map[string]any{
		"tenant_id":             projectionTestUUID,
		"evaluation_request_id": projectionTestUUID,
		"judge_job_id":          projectionTestUUID,
		"judge_event_id":        projectionTestUUID,
		"verdict":               "accepted",
		"completed_at":          completedAt.Format(time.RFC3339Nano),
	})
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	event := messaging.Event{
		ID: projectionTestUUID, Type: JudgeCompletedEventType, SchemaVersion: 1,
		AggregateType: "evaluation_request", AggregateID: projectionTestUUID, TenantID: projectionTestUUID,
		OccurredAt: completedAt, Payload: payload,
	}
	if _, err := parseJudgeCompleted(event); err != nil {
		t.Fatalf("parseJudgeCompleted() error = %v", err)
	}
	event.OccurredAt = completedAt.Add(time.Microsecond)
	if _, err := parseJudgeCompleted(event); err == nil {
		t.Fatal("parseJudgeCompleted() accepted an envelope timestamp that differs from the signed payload")
	}
}
