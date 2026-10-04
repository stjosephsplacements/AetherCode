// Package evalbundle is the single source of truth for the evaluation bundle
// format (docs/adr/0014-evaluation-bundle-format.md): one JSON document
// listing the test cases for a question, encrypted as a single object. Question
// Bank builds bundles with Build; Judge reads them with Parse. Anything that
// assembles a bundle must go through Build.
package evalbundle

import (
	"bytes"
	"encoding/json"
	"fmt"
)

// MaxTestCases bounds resource use during fan-out — an author authoring a
// pathologically large bundle should not be able to make one submission
// dispatch thousands of Judge0 units.
//
// Invariant: this must stay <= submission's per-completion unit-result bound
// (services/submission/internal/adapters/judgecompletion/completion.go's
// maxUnitResults, and the matching CHECK in
// services/submission/migrations/000018_judge_receipt_units.up.sql's
// ingest_judge_completion). Raising this above that bound without raising
// the other two would silently re-arm a judge-completion bridge stall: every
// completion for such a job would fail validateUnitResults/the SQL check,
// Worker.ProcessOnce would never acknowledge the failing message, and the
// same head-of-queue completion would be re-pulled and re-fail forever.
const MaxTestCases = 500

// Weight bounds and default. Version 1 bundles carry no weight; Parse gives
// their test cases DefaultWeight.
const (
	MinWeight     = 1
	MaxWeight     = 100
	DefaultWeight = 1
)

const (
	schemaV1 = 1
	schemaV2 = 2
)

// TestCase is one stdin/expected-output pair with its scoring weight.
type TestCase struct {
	Stdin          string
	ExpectedOutput string
	Weight         int
}

type wireTestCase struct {
	Stdin          string `json:"stdin"`
	ExpectedOutput string `json:"expected_output"`
	Weight         *int   `json:"weight,omitempty"`
}

type wireBundle struct {
	SchemaVersion int            `json:"schema_version"`
	TestCases     []wireTestCase `json:"test_cases"`
}

// Build encodes cases as a schema_version 2 bundle. Every weight must be in
// [MinWeight, MaxWeight] and the count within [1, MaxTestCases].
func Build(cases []TestCase) ([]byte, error) {
	if err := checkCount(len(cases)); err != nil {
		return nil, err
	}
	wire := wireBundle{SchemaVersion: schemaV2, TestCases: make([]wireTestCase, len(cases))}
	for i, testCase := range cases {
		if err := checkWeight(testCase.Weight); err != nil {
			return nil, fmt.Errorf("evalbundle: test case %d: %w", i, err)
		}
		weight := testCase.Weight
		wire.TestCases[i] = wireTestCase{Stdin: testCase.Stdin, ExpectedOutput: testCase.ExpectedOutput, Weight: &weight}
	}
	encoded, err := json.Marshal(wire)
	if err != nil {
		return nil, fmt.Errorf("evalbundle: encode: %w", err)
	}
	return encoded, nil
}

// Parse decodes and validates a decrypted evaluation bundle of schema_version
// 1 or 2. plaintext must already be decrypted — this package has no knowledge
// of encryption.
func Parse(plaintext []byte) ([]TestCase, error) {
	var wire wireBundle
	decoder := json.NewDecoder(bytes.NewReader(plaintext))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&wire); err != nil {
		return nil, fmt.Errorf("evalbundle: decode: %w", err)
	}
	if wire.SchemaVersion != schemaV1 && wire.SchemaVersion != schemaV2 {
		return nil, fmt.Errorf("evalbundle: unsupported schema_version %d, want %d or %d", wire.SchemaVersion, schemaV1, schemaV2)
	}
	if err := checkCount(len(wire.TestCases)); err != nil {
		return nil, err
	}
	cases := make([]TestCase, len(wire.TestCases))
	for i, wireCase := range wire.TestCases {
		weight := DefaultWeight
		switch {
		case wireCase.Weight != nil && wire.SchemaVersion == schemaV1:
			return nil, fmt.Errorf("evalbundle: test case %d: weight requires schema_version %d", i, schemaV2)
		case wireCase.Weight != nil:
			weight = *wireCase.Weight
		case wire.SchemaVersion == schemaV2:
			return nil, fmt.Errorf("evalbundle: test case %d: weight is required in schema_version %d", i, schemaV2)
		}
		if err := checkWeight(weight); err != nil {
			return nil, fmt.Errorf("evalbundle: test case %d: %w", i, err)
		}
		cases[i] = TestCase{Stdin: wireCase.Stdin, ExpectedOutput: wireCase.ExpectedOutput, Weight: weight}
	}
	return cases, nil
}

// MarshalTestCase encodes a single test case into the per-unit encrypted
// object format: the JSON document that gets encrypted and uploaded as one
// test case's independently stored object during fan-out. Weight is not part
// of it; scoring weights are applied from the bundle, not per unit.
func MarshalTestCase(testCase TestCase) ([]byte, error) {
	encoded, err := json.Marshal(wireTestCase{Stdin: testCase.Stdin, ExpectedOutput: testCase.ExpectedOutput})
	if err != nil {
		return nil, fmt.Errorf("evalbundle: encode test case: %w", err)
	}
	return encoded, nil
}

func checkCount(count int) error {
	if count == 0 {
		return fmt.Errorf("evalbundle: must contain at least one test case")
	}
	if count > MaxTestCases {
		return fmt.Errorf("evalbundle: contains %d test cases, exceeds the limit of %d", count, MaxTestCases)
	}
	return nil
}

func checkWeight(weight int) error {
	if weight < MinWeight || weight > MaxWeight {
		return fmt.Errorf("weight %d must be between %d and %d", weight, MinWeight, MaxWeight)
	}
	return nil
}
