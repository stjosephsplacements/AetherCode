package app

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestCanonicalJSONObjectNormalizesKeysAndRejectsNonObjects(t *testing.T) {
	filters, err := canonicalJSONObject(json.RawMessage(` { "z": 2, "a": 1 } `))
	if err != nil {
		t.Fatalf("canonicalJSONObject() error = %v", err)
	}
	if string(filters) != `{"a":1,"z":2}` {
		t.Fatalf("canonicalJSONObject() = %s", filters)
	}
	for _, invalidFilters := range []json.RawMessage{nil, []byte(`[]`), []byte(`null`), []byte(`{} {}`)} {
		if _, err := canonicalJSONObject(invalidFilters); err == nil {
			t.Fatalf("canonicalJSONObject(%s) accepted invalid input", invalidFilters)
		}
	}
}

func TestReportTypeAndPageValidation(t *testing.T) {
	if !validReportType(ReportExamResults) || validReportType("all") {
		t.Fatal("validReportType() returned an unexpected result")
	}
	if normalizedLimit(0) != defaultPageSize || !validLimit(maximumPageSize) || validLimit(maximumPageSize+1) {
		t.Fatal("page validation returned an unexpected result")
	}
}

func TestDepartmentBatchProgressJSONFields(t *testing.T) {
	row := DepartmentBatchProgress{
		TenantID:      "00000000-0000-0000-0000-000000000001",
		BatchID:       "00000000-0000-0000-0000-000000000002",
		DepartmentID:  "00000000-0000-0000-0000-000000000003",
		ExamVersionID: "00000000-0000-0000-0000-000000000004",
		AssignedCount: 10, StartedCount: 8, CompletedCount: 5,
	}
	encoded, err := json.Marshal(row)
	if err != nil {
		t.Fatalf("marshal DepartmentBatchProgress: %v", err)
	}
	for _, field := range []string{"department_id", "batch_id", "assigned_count", "started_count", "completed_count"} {
		if !strings.Contains(string(encoded), field) {
			t.Fatalf("DepartmentBatchProgress JSON missing field %q: %s", field, encoded)
		}
	}
	if strings.Contains(string(encoded), "average_score") {
		t.Fatalf("DepartmentBatchProgress JSON must omit nil average_score: %s", encoded)
	}
}

func TestRedactReportExportNeverReturnsStorageReferences(t *testing.T) {
	objectKey := "india/tenant/report.csv.enc"
	checksum := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	redacted := redactReportExport(ReportExport{ObjectKey: &objectKey, Checksum: &checksum})
	if redacted.ObjectKey != nil || redacted.Checksum != nil {
		t.Fatalf("redactReportExport() exposed storage references: %#v", redacted)
	}
	encoded, err := json.Marshal(redacted)
	if err != nil {
		t.Fatalf("marshal redacted report export: %v", err)
	}
	if strings.Contains(string(encoded), "object_key") || strings.Contains(string(encoded), "checksum") {
		t.Fatalf("public report export JSON exposed storage references: %s", encoded)
	}
}
