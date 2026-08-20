package projection

import (
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/aethercode/aethercode/libs/pkg/messaging"
)

const projectionUUID = "018f4b0d-08f8-7c09-9ba7-efdf9c220099"

func TestDecodeAttemptGradedContract(t *testing.T) {
	event := messaging.Event{
		ID: projectionUUID, Type: AttemptGradedEventType, SchemaVersion: 1,
		AggregateType: "attempt", AggregateID: projectionUUID, TenantID: projectionUUID,
		OccurredAt: time.Now().UTC(), Payload: json.RawMessage(`{
			"attempt_id":"018f4b0d-08f8-7c09-9ba7-efdf9c220099",
			"tenant_id":"018f4b0d-08f8-7c09-9ba7-efdf9c220099",
			"candidate_assignment_id":"018f4b0d-08f8-7c09-9ba7-efdf9c220099",
			"candidate_id":"018f4b0d-08f8-7c09-9ba7-efdf9c220099",
			"exam_id":"018f4b0d-08f8-7c09-9ba7-efdf9c220099",
			"exam_version_id":"018f4b0d-08f8-7c09-9ba7-efdf9c220099",
			"attempt_number":1,"lifecycle_state":"graded","score":7,"maximum_score":10,
			"completed_at":"2026-07-24T00:00:00Z"
		}`),
	}
	var payload attemptGraded
	if err := decodeEvent(event, AttemptGradedEventType, &payload); err != nil {
		t.Fatalf("decodeEvent() error = %v", err)
	}
	if !scoreWithinMaximum(payload.Score, payload.MaximumScore) || payload.LifecycleState != "graded" {
		t.Fatal("graded payload did not preserve score fields")
	}
}

func TestDecodeAttemptSubmittedContract(t *testing.T) {
	validPayload := `{
		"tenant_id":"018f4b0d-08f8-7c09-9ba7-efdf9c220099",
		"attempt_id":"018f4b0d-08f8-7c09-9ba7-efdf9c220099",
		"candidate_assignment_id":"018f4b0d-08f8-7c09-9ba7-efdf9c220099",
		"candidate_id":"018f4b0d-08f8-7c09-9ba7-efdf9c220099",
		"exam_id":"018f4b0d-08f8-7c09-9ba7-efdf9c220099",
		"exam_version_id":"018f4b0d-08f8-7c09-9ba7-efdf9c220099",
		"evaluation_request_count":5,
		"submitted_at":"2026-07-24T00:00:00Z"
	}`
	cases := []struct {
		name          string
		payload       string
		aggregateType string
		wantErr       bool
	}{
		{name: "valid submission", payload: validPayload, aggregateType: "attempt"},
		{name: "unknown field", payload: `{
			"tenant_id":"018f4b0d-08f8-7c09-9ba7-efdf9c220099",
			"attempt_id":"018f4b0d-08f8-7c09-9ba7-efdf9c220099",
			"candidate_assignment_id":"018f4b0d-08f8-7c09-9ba7-efdf9c220099",
			"candidate_id":"018f4b0d-08f8-7c09-9ba7-efdf9c220099",
			"exam_id":"018f4b0d-08f8-7c09-9ba7-efdf9c220099",
			"exam_version_id":"018f4b0d-08f8-7c09-9ba7-efdf9c220099",
			"evaluation_request_count":5,
			"submitted_at":"2026-07-24T00:00:00Z",
			"unknown_field":"must-not-be-accepted"
		}`, aggregateType: "attempt", wantErr: true},
		{name: "wrong aggregate type", payload: validPayload, aggregateType: "candidate_assignment", wantErr: true},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			event := messaging.Event{
				ID: projectionUUID, Type: AttemptSubmittedEventType, SchemaVersion: 1,
				AggregateType: testCase.aggregateType, AggregateID: projectionUUID, TenantID: projectionUUID,
				OccurredAt: time.Now().UTC(), Payload: json.RawMessage(testCase.payload),
			}
			var payload attemptSubmitted
			err := decodeEvent(event, AttemptSubmittedEventType, &payload)
			if err == nil && testCase.aggregateType != "attempt" {
				err = fmt.Errorf("wrong aggregate type")
			}
			if (err != nil) != testCase.wantErr {
				t.Fatalf("decodeEvent() error = %v, wantErr %t", err, testCase.wantErr)
			}
			if !testCase.wantErr && payload.SubmittedAt.IsZero() {
				t.Fatal("submitted_at was not decoded")
			}
		})
	}
}

func TestDecodeAttemptStartedContract(t *testing.T) {
	validPayload := `{
		"tenant_id":"018f4b0d-08f8-7c09-9ba7-efdf9c220099",
		"attempt_id":"018f4b0d-08f8-7c09-9ba7-efdf9c220099",
		"candidate_assignment_id":"018f4b0d-08f8-7c09-9ba7-efdf9c220099",
		"candidate_id":"018f4b0d-08f8-7c09-9ba7-efdf9c220099",
		"exam_id":"018f4b0d-08f8-7c09-9ba7-efdf9c220099",
		"exam_version_id":"018f4b0d-08f8-7c09-9ba7-efdf9c220099",
		"started_at":"2026-07-24T00:00:00Z"
	}`
	cases := []struct {
		name          string
		payload       string
		aggregateType string
		wantErr       bool
	}{
		{name: "strict safe payload", payload: validPayload, aggregateType: "attempt"},
		{name: "unknown source reference", payload: `{
			"tenant_id":"018f4b0d-08f8-7c09-9ba7-efdf9c220099",
			"attempt_id":"018f4b0d-08f8-7c09-9ba7-efdf9c220099",
			"candidate_assignment_id":"018f4b0d-08f8-7c09-9ba7-efdf9c220099",
			"candidate_id":"018f4b0d-08f8-7c09-9ba7-efdf9c220099",
			"exam_id":"018f4b0d-08f8-7c09-9ba7-efdf9c220099",
			"exam_version_id":"018f4b0d-08f8-7c09-9ba7-efdf9c220099",
			"started_at":"2026-07-24T00:00:00Z",
			"source_object_key":"must-not-be-accepted"
		}`, aggregateType: "attempt", wantErr: true},
		{name: "wrong aggregate type", payload: validPayload, aggregateType: "candidate_assignment", wantErr: true},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			payload, err := decodeAttemptStarted(messaging.Event{
				ID: projectionUUID, Type: AttemptStartedEventType, SchemaVersion: 1,
				AggregateType: testCase.aggregateType, AggregateID: projectionUUID, TenantID: projectionUUID,
				OccurredAt: time.Now().UTC(), Payload: json.RawMessage(testCase.payload),
			})
			if (err != nil) != testCase.wantErr {
				t.Fatalf("decodeAttemptStarted() error = %v, wantErr %t", err, testCase.wantErr)
			}
			if !testCase.wantErr && payload.StartedAt.IsZero() {
				t.Fatal("started_at was not decoded")
			}
		})
	}
}

func TestAssignmentItemsRejectDuplicateAndInvalidChecksums(t *testing.T) {
	valid := assignmentItem{ExamItemID: projectionUUID, EvaluationBundleObjectKey: "bundle/key", EvaluationBundleChecksum: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", MaximumScore: json.Number("1")}
	if validAssignmentItems([]assignmentItem{valid, valid}) {
		t.Fatal("duplicate assignment items were accepted")
	}
	valid.EvaluationBundleChecksum = "bad"
	if validAssignmentItems([]assignmentItem{valid}) {
		t.Fatal("invalid checksum was accepted")
	}
}

func TestDecodeStudentBatchAffiliationSnapshotContract(t *testing.T) {
	validActive := `{
		"tenant_id":"018f4b0d-08f8-7c09-9ba7-efdf9c220099",
		"student_id":"018f4b0d-08f8-7c09-9ba7-efdf9c220099",
		"batch_id":"018f4b0d-08f8-7c09-9ba7-efdf9c220099",
		"lifecycle_state":"active","version":1
	}`
	cases := []struct {
		name    string
		payload string
		wantErr bool
	}{
		{name: "active membership", payload: validActive},
		{name: "inactive null batch", payload: `{
			"tenant_id":"018f4b0d-08f8-7c09-9ba7-efdf9c220099",
			"student_id":"018f4b0d-08f8-7c09-9ba7-efdf9c220099",
			"batch_id":null,"lifecycle_state":"inactive","version":2
		}`},
		{name: "inactive omitted batch", payload: `{
			"tenant_id":"018f4b0d-08f8-7c09-9ba7-efdf9c220099",
			"student_id":"018f4b0d-08f8-7c09-9ba7-efdf9c220099",
			"lifecycle_state":"inactive","version":2
		}`},
		{name: "active without batch", payload: `{
			"tenant_id":"018f4b0d-08f8-7c09-9ba7-efdf9c220099",
			"student_id":"018f4b0d-08f8-7c09-9ba7-efdf9c220099",
			"batch_id":null,"lifecycle_state":"active","version":1
		}`, wantErr: true},
		{name: "inactive may identify prior batch", payload: `{
			"tenant_id":"018f4b0d-08f8-7c09-9ba7-efdf9c220099",
			"student_id":"018f4b0d-08f8-7c09-9ba7-efdf9c220099",
			"batch_id":"018f4b0d-08f8-7c09-9ba7-efdf9c220099",
			"lifecycle_state":"inactive","version":2
		}`},
		{name: "inactive invalid batch", payload: `{
			"tenant_id":"018f4b0d-08f8-7c09-9ba7-efdf9c220099",
			"student_id":"018f4b0d-08f8-7c09-9ba7-efdf9c220099",
			"batch_id":"not-a-uuid","lifecycle_state":"inactive","version":2
		}`, wantErr: true},
		{name: "nonpositive version", payload: `{
			"tenant_id":"018f4b0d-08f8-7c09-9ba7-efdf9c220099",
			"student_id":"018f4b0d-08f8-7c09-9ba7-efdf9c220099",
			"batch_id":"018f4b0d-08f8-7c09-9ba7-efdf9c220099",
			"lifecycle_state":"active","version":0
		}`, wantErr: true},
		{name: "unknown field", payload: `{
			"tenant_id":"018f4b0d-08f8-7c09-9ba7-efdf9c220099",
			"student_id":"018f4b0d-08f8-7c09-9ba7-efdf9c220099",
			"batch_id":"018f4b0d-08f8-7c09-9ba7-efdf9c220099",
			"lifecycle_state":"active","version":1,"unexpected":true
		}`, wantErr: true},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			event := messaging.Event{
				ID: projectionUUID, Type: StudentBatchAffiliationEventType, SchemaVersion: 1,
				AggregateType: "student", AggregateID: projectionUUID, TenantID: projectionUUID,
				OccurredAt: time.Now().UTC(), Payload: json.RawMessage(testCase.payload),
			}
			_, err := decodeStudentBatchAffiliationSnapshot(event)
			if (err != nil) != testCase.wantErr {
				t.Fatalf("decodeStudentBatchAffiliationSnapshot() error = %v, wantErr %t", err, testCase.wantErr)
			}
		})
	}
}
