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
	"strings"
	"unicode/utf8"
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

// visibilitySample marks a bundle that holds only sample tests, the one kind
// whose per-test output a candidate may see (ADR-0021).
const visibilitySample = "sample"

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
	Visibility    string         `json:"visibility,omitempty"`
	TestCases     []wireTestCase `json:"test_cases"`
}

// Bundle is a parsed evaluation bundle.
type Bundle struct {
	TestCases []TestCase
	// Sample reports a bundle built by BuildSample: only its tests' output
	// may be returned to a candidate.
	Sample bool
}

// Build encodes cases as a schema_version 2 bundle. Every weight must be in
// [MinWeight, MaxWeight] and the count within [1, MaxTestCases].
func Build(cases []TestCase) ([]byte, error) {
	return build(cases, "")
}

// BuildSample encodes a bundle of sample tests, marked so that Judge returns
// each test's output for it.
func BuildSample(cases []TestCase) ([]byte, error) {
	return build(cases, visibilitySample)
}

func build(cases []TestCase, visibility string) ([]byte, error) {
	if err := checkCount(len(cases)); err != nil {
		return nil, err
	}
	wire := wireBundle{SchemaVersion: schemaV2, Visibility: visibility, TestCases: make([]wireTestCase, len(cases))}
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
func Parse(plaintext []byte) (Bundle, error) {
	var wire wireBundle
	decoder := json.NewDecoder(bytes.NewReader(plaintext))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&wire); err != nil {
		return Bundle{}, fmt.Errorf("evalbundle: decode: %w", err)
	}
	if wire.SchemaVersion != schemaV1 && wire.SchemaVersion != schemaV2 {
		return Bundle{}, fmt.Errorf("evalbundle: unsupported schema_version %d, want %d or %d", wire.SchemaVersion, schemaV1, schemaV2)
	}
	if wire.Visibility != "" && (wire.Visibility != visibilitySample || wire.SchemaVersion != schemaV2) {
		return Bundle{}, fmt.Errorf("evalbundle: visibility %q is not valid in schema_version %d", wire.Visibility, wire.SchemaVersion)
	}
	if err := checkCount(len(wire.TestCases)); err != nil {
		return Bundle{}, err
	}
	cases := make([]TestCase, len(wire.TestCases))
	for i, wireCase := range wire.TestCases {
		weight := DefaultWeight
		switch {
		case wireCase.Weight != nil && wire.SchemaVersion == schemaV1:
			return Bundle{}, fmt.Errorf("evalbundle: test case %d: weight requires schema_version %d", i, schemaV2)
		case wireCase.Weight != nil:
			weight = *wireCase.Weight
		case wire.SchemaVersion == schemaV2:
			return Bundle{}, fmt.Errorf("evalbundle: test case %d: weight is required in schema_version %d", i, schemaV2)
		}
		if err := checkWeight(weight); err != nil {
			return Bundle{}, fmt.Errorf("evalbundle: test case %d: %w", i, err)
		}
		cases[i] = TestCase{Stdin: wireCase.Stdin, ExpectedOutput: wireCase.ExpectedOutput, Weight: weight}
	}
	return Bundle{TestCases: cases, Sample: wire.Visibility == visibilitySample}, nil
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

// MaxOutputBytes bounds each field of a UnitOutput.
const MaxOutputBytes = 64 << 10

// UnitOutput is what one sample test produced. Judge stores it encrypted, one
// object per test, only for a sample bundle's job; Submission shows it to the
// candidate who ran the code.
type UnitOutput struct {
	Stdin          string `json:"stdin"`
	ExpectedOutput string `json:"expected_output"`
	Stdout         string `json:"stdout"`
	Stderr         string `json:"stderr"`
	CompileOutput  string `json:"compile_output"`
}

// MarshalUnitOutput encodes output with every field made storable: invalid
// UTF-8 replaced, NUL bytes (which PostgreSQL text rejects) removed, and the
// result cut to MaxOutputBytes on a character boundary.
func MarshalUnitOutput(output UnitOutput) ([]byte, error) {
	for _, field := range []*string{&output.Stdin, &output.ExpectedOutput, &output.Stdout, &output.Stderr, &output.CompileOutput} {
		*field = storableText(*field)
	}
	encoded, err := json.Marshal(output)
	if err != nil {
		return nil, fmt.Errorf("evalbundle: encode unit output: %w", err)
	}
	return encoded, nil
}

// ParseUnitOutput decodes a decrypted unit output object.
func ParseUnitOutput(plaintext []byte) (UnitOutput, error) {
	var output UnitOutput
	decoder := json.NewDecoder(bytes.NewReader(plaintext))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&output); err != nil {
		return UnitOutput{}, fmt.Errorf("evalbundle: decode unit output: %w", err)
	}
	for _, field := range []string{output.Stdin, output.ExpectedOutput, output.Stdout, output.Stderr, output.CompileOutput} {
		if len(field) > MaxOutputBytes || strings.ContainsRune(field, 0) {
			return UnitOutput{}, fmt.Errorf("evalbundle: unit output field is not storable")
		}
	}
	return output, nil
}

func storableText(text string) string {
	text = strings.ReplaceAll(strings.ToValidUTF8(text, "\uFFFD"), "\x00", "")
	if len(text) <= MaxOutputBytes {
		return text
	}
	cut := MaxOutputBytes
	for cut > 0 && !utf8.RuneStart(text[cut]) {
		cut--
	}
	return text[:cut]
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
