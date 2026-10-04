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

func TestParseAssignmentSnapshotAcceptsKeyReferencesAndSampleBundle(t *testing.T) {
	checksum := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	for _, testCase := range []struct {
		name string
		item map[string]any
	}{
		{name: "pinned", item: map[string]any{
			"evaluation_bundle_key_reference": "local/key-1",
			"sample_bundle_object_key":        "qbank/sample/manifest.enc",
			"sample_bundle_checksum":          checksum,
			"sample_bundle_key_reference":     "local/key-1",
		}},
		{name: "legacy nulls", item: map[string]any{
			"evaluation_bundle_key_reference": nil,
			"sample_bundle_object_key":        nil,
			"sample_bundle_checksum":          nil,
			"sample_bundle_key_reference":     nil,
		}},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			testCase.item["exam_item_id"] = projectionTestUUID
			testCase.item["evaluation_bundle_object_key"] = "qbank/evaluation/manifest.enc"
			testCase.item["evaluation_bundle_checksum"] = checksum
			testCase.item["maximum_score"] = 10.0
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
				"items":                   []map[string]any{testCase.item},
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
			item := parsed.Items[0]
			wantKey := testCase.item["evaluation_bundle_key_reference"] != nil
			if (item.EvaluationBundleKeyReference != "") != wantKey || (item.SampleBundleObjectKey != "") != wantKey {
				t.Fatalf("parsed item = %#v", item)
			}
		})
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

func TestParseAssignmentSnapshotExecutionSettings(t *testing.T) {
	checksum := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	testCases := []struct {
		name    string
		extra   map[string]any
		wantErr bool
	}{
		{name: "legacy item without settings", extra: map[string]any{"time_limit_ms": nil, "memory_limit_kib": nil, "supported_languages": nil}},
		{name: "complete settings", extra: map[string]any{"time_limit_ms": 2000, "memory_limit_kib": 262144, "supported_languages": []string{"c", "python3"}}},
		{name: "partial settings", extra: map[string]any{"time_limit_ms": 2000}, wantErr: true},
		{name: "time limit below the bound", extra: map[string]any{"time_limit_ms": 10, "memory_limit_kib": 262144, "supported_languages": []string{"c"}}, wantErr: true},
		{name: "memory limit above the bound", extra: map[string]any{"time_limit_ms": 2000, "memory_limit_kib": 4194305, "supported_languages": []string{"c"}}, wantErr: true},
		{name: "empty language list", extra: map[string]any{"time_limit_ms": 2000, "memory_limit_kib": 262144, "supported_languages": []string{}}, wantErr: true},
		{name: "blank language", extra: map[string]any{"time_limit_ms": 2000, "memory_limit_kib": 262144, "supported_languages": []string{" "}}, wantErr: true},
	}
	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			item := map[string]any{
				"exam_item_id":                 projectionTestUUID,
				"evaluation_bundle_object_key": "qbank/evaluation/manifest.enc",
				"evaluation_bundle_checksum":   checksum,
				"maximum_score":                10.0,
			}
			for key, value := range testCase.extra {
				item[key] = value
			}
			payload, err := json.Marshal(map[string]any{
				"tenant_id": projectionTestUUID, "candidate_assignment_id": projectionTestUUID,
				"candidate_id": projectionTestUUID, "exam_id": projectionTestUUID, "exam_version_id": projectionTestUUID,
				"available_from": "2026-07-24T10:00:00Z", "available_until": "2026-07-24T11:00:00Z",
				"attempt_limit": 1, "lifecycle_state": "active", "version": 1,
				"items": []map[string]any{item},
			})
			if err != nil {
				t.Fatalf("marshal payload: %v", err)
			}
			_, err = parseAssignmentSnapshot(messaging.Event{
				ID: projectionTestUUID, Type: AssignmentSnapshotEventType, SchemaVersion: 1,
				AggregateType: "candidate_assignment", AggregateID: projectionTestUUID, TenantID: projectionTestUUID,
				OccurredAt: time.Now().UTC(), Payload: payload,
			})
			if (err != nil) != testCase.wantErr {
				t.Fatalf("parseAssignmentSnapshot() error = %v, wantErr %t", err, testCase.wantErr)
			}
		})
	}
}
