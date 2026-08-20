package projection

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/aethercode/aethercode/libs/pkg/messaging"
	"github.com/google/uuid"
)

func TestParseStudentEnrolledRejectsInvalidPayloads(t *testing.T) {
	tenantID := uuid.NewString()
	studentID := uuid.NewString()
	batchID := uuid.NewString()
	departmentID := uuid.NewString()

	validPayload := studentEnrolledPayload{
		TenantID:     tenantID,
		StudentID:    studentID,
		BatchID:      batchID,
		DepartmentID: departmentID,
	}
	validPayloadBytes, _ := json.Marshal(validPayload)

	tests := []struct {
		name    string
		event   messaging.Event
		wantErr bool
	}{
		{
			name: "valid student enrolled event",
			event: messaging.Event{
				ID:            uuid.NewString(),
				Type:          StudentEnrolledEventType,
				SchemaVersion: 1,
				TenantID:      tenantID,
				AggregateType: "student",
				AggregateID:   studentID,
				Payload:       validPayloadBytes,
				OccurredAt:    time.Now(),
			},
			wantErr: false,
		},
		{
			name: "missing tenant ID",
			event: messaging.Event{
				ID:            uuid.NewString(),
				Type:          StudentEnrolledEventType,
				SchemaVersion: 1,
				TenantID:      tenantID,
				AggregateType: "student",
				AggregateID:   studentID,
				Payload:       mustMarshalJSON(studentEnrolledPayload{StudentID: studentID, BatchID: batchID, DepartmentID: departmentID}),
				OccurredAt:    time.Now(),
			},
			wantErr: true,
		},
		{
			name: "missing student ID",
			event: messaging.Event{
				ID:            uuid.NewString(),
				Type:          StudentEnrolledEventType,
				SchemaVersion: 1,
				TenantID:      tenantID,
				AggregateType: "student",
				AggregateID:   studentID,
				Payload:       mustMarshalJSON(studentEnrolledPayload{TenantID: tenantID, BatchID: batchID, DepartmentID: departmentID}),
				OccurredAt:    time.Now(),
			},
			wantErr: true,
		},
		{
			name: "missing batch ID",
			event: messaging.Event{
				ID:            uuid.NewString(),
				Type:          StudentEnrolledEventType,
				SchemaVersion: 1,
				TenantID:      tenantID,
				AggregateType: "student",
				AggregateID:   studentID,
				Payload:       mustMarshalJSON(studentEnrolledPayload{TenantID: tenantID, StudentID: studentID, DepartmentID: departmentID}),
				OccurredAt:    time.Now(),
			},
			wantErr: true,
		},
		{
			name: "missing department ID",
			event: messaging.Event{
				ID:            uuid.NewString(),
				Type:          StudentEnrolledEventType,
				SchemaVersion: 1,
				TenantID:      tenantID,
				AggregateType: "student",
				AggregateID:   studentID,
				Payload:       mustMarshalJSON(studentEnrolledPayload{TenantID: tenantID, StudentID: studentID, BatchID: batchID}),
				OccurredAt:    time.Now(),
			},
			wantErr: true,
		},
		{
			name: "invalid tenant ID",
			event: messaging.Event{
				ID:            uuid.NewString(),
				Type:          StudentEnrolledEventType,
				SchemaVersion: 1,
				TenantID:      tenantID,
				AggregateType: "student",
				AggregateID:   studentID,
				Payload:       mustMarshalJSON(studentEnrolledPayload{TenantID: "not-a-uuid", StudentID: studentID, BatchID: batchID, DepartmentID: departmentID}),
				OccurredAt:    time.Now(),
			},
			wantErr: true,
		},
		{
			name: "unknown field in payload",
			event: messaging.Event{
				ID:            uuid.NewString(),
				Type:          StudentEnrolledEventType,
				SchemaVersion: 1,
				TenantID:      tenantID,
				AggregateType: "student",
				AggregateID:   studentID,
				Payload:       []byte(`{"tenant_id":"` + tenantID + `","student_id":"` + studentID + `","batch_id":"` + batchID + `","department_id":"` + departmentID + `","unknown_field":"value"}`),
				OccurredAt:    time.Now(),
			},
			wantErr: true,
		},
		{
			name: "wrong event type",
			event: messaging.Event{
				ID:            uuid.NewString(),
				Type:          "wrong.event.type",
				SchemaVersion: 1,
				TenantID:      tenantID,
				AggregateType: "student",
				AggregateID:   studentID,
				Payload:       validPayloadBytes,
				OccurredAt:    time.Now(),
			},
			wantErr: true,
		},
		{
			name: "wrong schema version",
			event: messaging.Event{
				ID:            uuid.NewString(),
				Type:          StudentEnrolledEventType,
				SchemaVersion: 2,
				TenantID:      tenantID,
				AggregateType: "student",
				AggregateID:   studentID,
				Payload:       validPayloadBytes,
				OccurredAt:    time.Now(),
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := parseStudentEnrolled(tt.event)
			if (err != nil) != tt.wantErr {
				t.Errorf("parseStudentEnrolled() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestParseBatchAffiliationRejectsInvalidPayloads(t *testing.T) {
	tenantID := uuid.NewString()
	studentID := uuid.NewString()
	batchID := uuid.NewString()

	tests := []struct {
		name    string
		event   messaging.Event
		wantErr bool
	}{
		{
			name: "valid active affiliation",
			event: messaging.Event{
				ID:            uuid.NewString(),
				Type:          StudentBatchAffiliationEventType,
				SchemaVersion: 1,
				TenantID:      tenantID,
				AggregateType: "student_batch_affiliation",
				AggregateID:   studentID,
				Payload:       mustMarshalJSON(batchAffiliationPayload{TenantID: tenantID, StudentID: studentID, BatchID: &batchID, LifecycleState: "active", Version: 1}),
				OccurredAt:    time.Now(),
			},
			wantErr: false,
		},
		{
			name: "valid inactive affiliation with batch ID",
			event: messaging.Event{
				ID:            uuid.NewString(),
				Type:          StudentBatchAffiliationEventType,
				SchemaVersion: 1,
				TenantID:      tenantID,
				AggregateType: "student_batch_affiliation",
				AggregateID:   studentID,
				Payload:       mustMarshalJSON(batchAffiliationPayload{TenantID: tenantID, StudentID: studentID, BatchID: &batchID, LifecycleState: "inactive", Version: 2}),
				OccurredAt:    time.Now(),
			},
			wantErr: false,
		},
		{
			name: "valid inactive affiliation without batch ID",
			event: messaging.Event{
				ID:            uuid.NewString(),
				Type:          StudentBatchAffiliationEventType,
				SchemaVersion: 1,
				TenantID:      tenantID,
				AggregateType: "student_batch_affiliation",
				AggregateID:   studentID,
				Payload:       mustMarshalJSON(batchAffiliationPayload{TenantID: tenantID, StudentID: studentID, BatchID: nil, LifecycleState: "inactive", Version: 1}),
				OccurredAt:    time.Now(),
			},
			wantErr: false,
		},
		{
			name: "active affiliation missing batch ID",
			event: messaging.Event{
				ID:            uuid.NewString(),
				Type:          StudentBatchAffiliationEventType,
				SchemaVersion: 1,
				TenantID:      tenantID,
				AggregateType: "student_batch_affiliation",
				AggregateID:   studentID,
				Payload:       mustMarshalJSON(batchAffiliationPayload{TenantID: tenantID, StudentID: studentID, BatchID: nil, LifecycleState: "active", Version: 1}),
				OccurredAt:    time.Now(),
			},
			wantErr: true,
		},
		{
			name: "version is zero",
			event: messaging.Event{
				ID:            uuid.NewString(),
				Type:          StudentBatchAffiliationEventType,
				SchemaVersion: 1,
				TenantID:      tenantID,
				AggregateType: "student_batch_affiliation",
				AggregateID:   studentID,
				Payload:       mustMarshalJSON(batchAffiliationPayload{TenantID: tenantID, StudentID: studentID, BatchID: &batchID, LifecycleState: "active", Version: 0}),
				OccurredAt:    time.Now(),
			},
			wantErr: true,
		},
		{
			name: "version is negative",
			event: messaging.Event{
				ID:            uuid.NewString(),
				Type:          StudentBatchAffiliationEventType,
				SchemaVersion: 1,
				TenantID:      tenantID,
				AggregateType: "student_batch_affiliation",
				AggregateID:   studentID,
				Payload:       mustMarshalJSON(batchAffiliationPayload{TenantID: tenantID, StudentID: studentID, BatchID: &batchID, LifecycleState: "active", Version: -1}),
				OccurredAt:    time.Now(),
			},
			wantErr: true,
		},
		{
			name: "invalid lifecycle state",
			event: messaging.Event{
				ID:            uuid.NewString(),
				Type:          StudentBatchAffiliationEventType,
				SchemaVersion: 1,
				TenantID:      tenantID,
				AggregateType: "student_batch_affiliation",
				AggregateID:   studentID,
				Payload:       mustMarshalJSON(batchAffiliationPayload{TenantID: tenantID, StudentID: studentID, BatchID: &batchID, LifecycleState: "unknown", Version: 1}),
				OccurredAt:    time.Now(),
			},
			wantErr: true,
		},
		{
			name: "unknown field in payload",
			event: messaging.Event{
				ID:            uuid.NewString(),
				Type:          StudentBatchAffiliationEventType,
				SchemaVersion: 1,
				TenantID:      tenantID,
				AggregateType: "student_batch_affiliation",
				AggregateID:   studentID,
				Payload:       []byte(`{"tenant_id":"` + tenantID + `","student_id":"` + studentID + `","batch_id":"` + batchID + `","lifecycle_state":"active","version":1,"extra":"field"}`),
				OccurredAt:    time.Now(),
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := parseBatchAffiliation(tt.event)
			if (err != nil) != tt.wantErr {
				t.Errorf("parseBatchAffiliation() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestParseBatchCreatedRejectsInvalidPayloads(t *testing.T) {
	tenantID := uuid.NewString()
	batchID := uuid.NewString()
	departmentID := uuid.NewString()

	validPayload := batchCreatedPayload{
		TenantID:     tenantID,
		BatchID:      batchID,
		DepartmentID: departmentID,
	}
	validPayloadBytes, _ := json.Marshal(validPayload)

	tests := []struct {
		name    string
		event   messaging.Event
		wantErr bool
	}{
		{
			name: "valid batch created event",
			event: messaging.Event{
				ID:            uuid.NewString(),
				Type:          BatchCreatedEventType,
				SchemaVersion: 1,
				TenantID:      tenantID,
				AggregateType: "batch",
				AggregateID:   batchID,
				Payload:       validPayloadBytes,
				OccurredAt:    time.Now(),
			},
			wantErr: false,
		},
		{
			name: "missing tenant ID",
			event: messaging.Event{
				ID:            uuid.NewString(),
				Type:          BatchCreatedEventType,
				SchemaVersion: 1,
				TenantID:      tenantID,
				AggregateType: "batch",
				AggregateID:   batchID,
				Payload:       mustMarshalJSON(batchCreatedPayload{BatchID: batchID, DepartmentID: departmentID}),
				OccurredAt:    time.Now(),
			},
			wantErr: true,
		},
		{
			name: "missing batch ID",
			event: messaging.Event{
				ID:            uuid.NewString(),
				Type:          BatchCreatedEventType,
				SchemaVersion: 1,
				TenantID:      tenantID,
				AggregateType: "batch",
				AggregateID:   batchID,
				Payload:       mustMarshalJSON(batchCreatedPayload{TenantID: tenantID, DepartmentID: departmentID}),
				OccurredAt:    time.Now(),
			},
			wantErr: true,
		},
		{
			name: "missing department ID",
			event: messaging.Event{
				ID:            uuid.NewString(),
				Type:          BatchCreatedEventType,
				SchemaVersion: 1,
				TenantID:      tenantID,
				AggregateType: "batch",
				AggregateID:   batchID,
				Payload:       mustMarshalJSON(batchCreatedPayload{TenantID: tenantID, BatchID: batchID}),
				OccurredAt:    time.Now(),
			},
			wantErr: true,
		},
		{
			name: "invalid tenant ID",
			event: messaging.Event{
				ID:            uuid.NewString(),
				Type:          BatchCreatedEventType,
				SchemaVersion: 1,
				TenantID:      tenantID,
				AggregateType: "batch",
				AggregateID:   batchID,
				Payload:       mustMarshalJSON(batchCreatedPayload{TenantID: "not-a-uuid", BatchID: batchID, DepartmentID: departmentID}),
				OccurredAt:    time.Now(),
			},
			wantErr: true,
		},
		{
			name: "invalid batch ID",
			event: messaging.Event{
				ID:            uuid.NewString(),
				Type:          BatchCreatedEventType,
				SchemaVersion: 1,
				TenantID:      tenantID,
				AggregateType: "batch",
				AggregateID:   batchID,
				Payload:       mustMarshalJSON(batchCreatedPayload{TenantID: tenantID, BatchID: "not-a-uuid", DepartmentID: departmentID}),
				OccurredAt:    time.Now(),
			},
			wantErr: true,
		},
		{
			name: "unknown field in payload",
			event: messaging.Event{
				ID:            uuid.NewString(),
				Type:          BatchCreatedEventType,
				SchemaVersion: 1,
				TenantID:      tenantID,
				AggregateType: "batch",
				AggregateID:   batchID,
				Payload:       []byte(`{"tenant_id":"` + tenantID + `","batch_id":"` + batchID + `","department_id":"` + departmentID + `","extra":"field"}`),
				OccurredAt:    time.Now(),
			},
			wantErr: true,
		},
		{
			name: "wrong event type",
			event: messaging.Event{
				ID:            uuid.NewString(),
				Type:          "wrong.event.type",
				SchemaVersion: 1,
				TenantID:      tenantID,
				AggregateType: "batch",
				AggregateID:   batchID,
				Payload:       validPayloadBytes,
				OccurredAt:    time.Now(),
			},
			wantErr: true,
		},
		{
			name: "wrong schema version",
			event: messaging.Event{
				ID:            uuid.NewString(),
				Type:          BatchCreatedEventType,
				SchemaVersion: 2,
				TenantID:      tenantID,
				AggregateType: "batch",
				AggregateID:   batchID,
				Payload:       validPayloadBytes,
				OccurredAt:    time.Now(),
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := parseBatchCreated(tt.event)
			if (err != nil) != tt.wantErr {
				t.Errorf("parseBatchCreated() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestParseAssignmentRuleCreatedSkipsStudentTarget(t *testing.T) {
	tenantID := uuid.NewString()
	assignmentRuleID := uuid.NewString()
	examVersionID := uuid.NewString()
	targetID := uuid.NewString()

	payload := assignmentRuleCreatedPayload{
		TenantID:         tenantID,
		AssignmentRuleID: assignmentRuleID,
		ExamVersionID:    examVersionID,
		TargetType:       "student",
		TargetID:         targetID,
	}
	payloadBytes, _ := json.Marshal(payload)

	event := messaging.Event{
		ID:            uuid.NewString(),
		Type:          AssignmentRuleCreatedEventType,
		SchemaVersion: 1,
		TenantID:      tenantID,
		AggregateType: "assignment_rule",
		AggregateID:   assignmentRuleID,
		Payload:       payloadBytes,
		OccurredAt:    time.Now(),
	}

	parsed, err := parseAssignmentRuleCreated(event)
	if err != nil {
		t.Errorf("parseAssignmentRuleCreated() should succeed for student target type, got error: %v", err)
	}
	if parsed.TargetType != "student" {
		t.Errorf("parseAssignmentRuleCreated() target type = %v, want student", parsed.TargetType)
	}
}

func TestParseAssignmentRuleCreatedRejectsInvalidPayload(t *testing.T) {
	tenantID := uuid.NewString()
	assignmentRuleID := uuid.NewString()
	examVersionID := uuid.NewString()
	targetID := uuid.NewString()

	validPayload := assignmentRuleCreatedPayload{
		TenantID:         tenantID,
		AssignmentRuleID: assignmentRuleID,
		ExamVersionID:    examVersionID,
		TargetType:       "batch",
		TargetID:         targetID,
	}
	validPayloadBytes, _ := json.Marshal(validPayload)

	tests := []struct {
		name    string
		event   messaging.Event
		wantErr bool
	}{
		{
			name: "valid assignment rule created event",
			event: messaging.Event{
				ID:            uuid.NewString(),
				Type:          AssignmentRuleCreatedEventType,
				SchemaVersion: 1,
				TenantID:      tenantID,
				AggregateType: "assignment_rule",
				AggregateID:   assignmentRuleID,
				Payload:       validPayloadBytes,
				OccurredAt:    time.Now(),
			},
			wantErr: false,
		},
		{
			name: "missing tenant ID",
			event: messaging.Event{
				ID:            uuid.NewString(),
				Type:          AssignmentRuleCreatedEventType,
				SchemaVersion: 1,
				TenantID:      tenantID,
				AggregateType: "assignment_rule",
				AggregateID:   assignmentRuleID,
				Payload:       mustMarshalJSON(assignmentRuleCreatedPayload{AssignmentRuleID: assignmentRuleID, ExamVersionID: examVersionID, TargetType: "batch", TargetID: targetID}),
				OccurredAt:    time.Now(),
			},
			wantErr: true,
		},
		{
			name: "missing assignment rule ID",
			event: messaging.Event{
				ID:            uuid.NewString(),
				Type:          AssignmentRuleCreatedEventType,
				SchemaVersion: 1,
				TenantID:      tenantID,
				AggregateType: "assignment_rule",
				AggregateID:   assignmentRuleID,
				Payload:       mustMarshalJSON(assignmentRuleCreatedPayload{TenantID: tenantID, ExamVersionID: examVersionID, TargetType: "batch", TargetID: targetID}),
				OccurredAt:    time.Now(),
			},
			wantErr: true,
		},
		{
			name: "missing exam version ID",
			event: messaging.Event{
				ID:            uuid.NewString(),
				Type:          AssignmentRuleCreatedEventType,
				SchemaVersion: 1,
				TenantID:      tenantID,
				AggregateType: "assignment_rule",
				AggregateID:   assignmentRuleID,
				Payload:       mustMarshalJSON(assignmentRuleCreatedPayload{TenantID: tenantID, AssignmentRuleID: assignmentRuleID, TargetType: "batch", TargetID: targetID}),
				OccurredAt:    time.Now(),
			},
			wantErr: true,
		},
		{
			name: "missing target type",
			event: messaging.Event{
				ID:            uuid.NewString(),
				Type:          AssignmentRuleCreatedEventType,
				SchemaVersion: 1,
				TenantID:      tenantID,
				AggregateType: "assignment_rule",
				AggregateID:   assignmentRuleID,
				Payload:       mustMarshalJSON(assignmentRuleCreatedPayload{TenantID: tenantID, AssignmentRuleID: assignmentRuleID, ExamVersionID: examVersionID, TargetID: targetID}),
				OccurredAt:    time.Now(),
			},
			wantErr: true,
		},
		{
			name: "missing target ID",
			event: messaging.Event{
				ID:            uuid.NewString(),
				Type:          AssignmentRuleCreatedEventType,
				SchemaVersion: 1,
				TenantID:      tenantID,
				AggregateType: "assignment_rule",
				AggregateID:   assignmentRuleID,
				Payload:       mustMarshalJSON(assignmentRuleCreatedPayload{TenantID: tenantID, AssignmentRuleID: assignmentRuleID, ExamVersionID: examVersionID, TargetType: "batch"}),
				OccurredAt:    time.Now(),
			},
			wantErr: true,
		},
		{
			name: "invalid tenant ID",
			event: messaging.Event{
				ID:            uuid.NewString(),
				Type:          AssignmentRuleCreatedEventType,
				SchemaVersion: 1,
				TenantID:      tenantID,
				AggregateType: "assignment_rule",
				AggregateID:   assignmentRuleID,
				Payload:       mustMarshalJSON(assignmentRuleCreatedPayload{TenantID: "not-a-uuid", AssignmentRuleID: assignmentRuleID, ExamVersionID: examVersionID, TargetType: "batch", TargetID: targetID}),
				OccurredAt:    time.Now(),
			},
			wantErr: true,
		},
		{
			name: "unknown field in payload",
			event: messaging.Event{
				ID:            uuid.NewString(),
				Type:          AssignmentRuleCreatedEventType,
				SchemaVersion: 1,
				TenantID:      tenantID,
				AggregateType: "assignment_rule",
				AggregateID:   assignmentRuleID,
				Payload:       []byte(`{"tenant_id":"` + tenantID + `","assignment_rule_id":"` + assignmentRuleID + `","exam_version_id":"` + examVersionID + `","target_type":"batch","target_id":"` + targetID + `","extra":"field"}`),
				OccurredAt:    time.Now(),
			},
			wantErr: true,
		},
		{
			name: "wrong event type",
			event: messaging.Event{
				ID:            uuid.NewString(),
				Type:          "wrong.event.type",
				SchemaVersion: 1,
				TenantID:      tenantID,
				AggregateType: "assignment_rule",
				AggregateID:   assignmentRuleID,
				Payload:       validPayloadBytes,
				OccurredAt:    time.Now(),
			},
			wantErr: true,
		},
		{
			name: "wrong schema version",
			event: messaging.Event{
				ID:            uuid.NewString(),
				Type:          AssignmentRuleCreatedEventType,
				SchemaVersion: 2,
				TenantID:      tenantID,
				AggregateType: "assignment_rule",
				AggregateID:   assignmentRuleID,
				Payload:       validPayloadBytes,
				OccurredAt:    time.Now(),
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := parseAssignmentRuleCreated(tt.event)
			if (err != nil) != tt.wantErr {
				t.Errorf("parseAssignmentRuleCreated() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func mustMarshalJSON(value any) []byte {
	data, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	return data
}
