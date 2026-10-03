package bundle

import (
	"encoding/json"
	"testing"
)

func TestParseValidBundle(t *testing.T) {
	t.Parallel()
	input := []byte(`{
		"schema_version": 1,
		"test_cases": [
			{"stdin": "5\n3\n", "expected_output": "8\n"},
			{"stdin": "10\n-2\n", "expected_output": "8\n"}
		]
	}`)
	testCases, err := Parse(input)
	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}
	if len(testCases) != 2 {
		t.Fatalf("Parse() returned %d test cases, want 2", len(testCases))
	}
	if testCases[0].Stdin != "5\n3\n" || testCases[0].ExpectedOutput != "8\n" {
		t.Fatalf("Parse()[0] = %+v, want stdin=%q expected_output=%q", testCases[0], "5\n3\n", "8\n")
	}
}

func TestParseRejectsUnsupportedSchemaVersion(t *testing.T) {
	t.Parallel()
	input := []byte(`{"schema_version": 99, "test_cases": [{"stdin": "1", "expected_output": "1"}]}`)
	if _, err := Parse(input); err == nil {
		t.Fatal("Parse() with schema_version 99 error = nil, want an error")
	}
}

func TestParseRejectsEmptyTestCases(t *testing.T) {
	t.Parallel()
	input := []byte(`{"schema_version": 1, "test_cases": []}`)
	if _, err := Parse(input); err == nil {
		t.Fatal("Parse() with zero test cases error = nil, want an error")
	}
}

func TestParseRejectsMalformedJSON(t *testing.T) {
	t.Parallel()
	if _, err := Parse([]byte("not json")); err == nil {
		t.Fatal("Parse() with malformed JSON error = nil, want an error")
	}
}

func TestParseRejectsMisnamedFields(t *testing.T) {
	t.Parallel()
	// "input"/"output" instead of "stdin"/"expected_output" — a producer bug
	// that must fail clearly, not silently parse into empty-string test
	// cases via json.Unmarshal's default unknown-field tolerance.
	input := []byte(`{"schema_version": 1, "test_cases": [{"input": "5", "output": "8"}]}`)
	if _, err := Parse(input); err == nil {
		t.Fatal("Parse() with misnamed fields error = nil, want an error rejecting unknown fields")
	}
}

func TestParseRejectsExcessiveTestCaseCount(t *testing.T) {
	t.Parallel()
	testCases := make([]map[string]string, 501)
	for i := range testCases {
		testCases[i] = map[string]string{"stdin": "x", "expected_output": "x"}
	}
	encoded, err := json.Marshal(map[string]any{"schema_version": 1, "test_cases": testCases})
	if err != nil {
		t.Fatalf("marshal fixture: %v", err)
	}
	if _, err := Parse(encoded); err == nil {
		t.Fatal("Parse() with 501 test cases error = nil, want an error (bound against runaway resource use)")
	}
}
