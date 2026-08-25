// Package bundle parses the evaluation bundle format: one JSON document
// listing the test cases for a question, encrypted as a single object and
// referenced by evaluation_bundle_object_key. This is the only consumer of
// this format in the codebase; anything that assembles a bundle for upload
// must emit exactly this shape.
package bundle

import (
	"bytes"
	"encoding/json"
	"fmt"
)

// maxTestCases bounds resource use during fan-out — an author authoring a
// pathologically large bundle should not be able to make one submission
// dispatch thousands of Judge0 units.
const maxTestCases = 500

const supportedSchemaVersion = 1

// TestCase is one stdin/expected-output pair from a parsed bundle.
type TestCase struct {
	Stdin          string
	ExpectedOutput string
}

type rawBundle struct {
	SchemaVersion int `json:"schema_version"`
	TestCases     []struct {
		Stdin          string `json:"stdin"`
		ExpectedOutput string `json:"expected_output"`
	} `json:"test_cases"`
}

// Parse decodes and validates a decrypted evaluation bundle. plaintext must
// already be decrypted — this package has no knowledge of encryption.
func Parse(plaintext []byte) ([]TestCase, error) {
	var raw rawBundle
	decoder := json.NewDecoder(bytes.NewReader(plaintext))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&raw); err != nil {
		return nil, fmt.Errorf("bundle: decode: %w", err)
	}
	if raw.SchemaVersion != supportedSchemaVersion {
		return nil, fmt.Errorf("bundle: unsupported schema_version %d, want %d", raw.SchemaVersion, supportedSchemaVersion)
	}
	if len(raw.TestCases) == 0 {
		return nil, fmt.Errorf("bundle: must contain at least one test case")
	}
	if len(raw.TestCases) > maxTestCases {
		return nil, fmt.Errorf("bundle: contains %d test cases, exceeds the limit of %d", len(raw.TestCases), maxTestCases)
	}
	testCases := make([]TestCase, len(raw.TestCases))
	for i, rawCase := range raw.TestCases {
		testCases[i] = TestCase{Stdin: rawCase.Stdin, ExpectedOutput: rawCase.ExpectedOutput}
	}
	return testCases, nil
}
