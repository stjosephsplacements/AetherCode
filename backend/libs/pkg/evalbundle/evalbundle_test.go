package evalbundle

import (
	"reflect"
	"strings"
	"testing"
)

func TestBuildParseRoundTrip(t *testing.T) {
	t.Parallel()
	want := []TestCase{
		{Stdin: "5\n3\n", ExpectedOutput: "8\n", Weight: 1},
		{Stdin: "10\n-2\n", ExpectedOutput: "8\n", Weight: 100},
	}
	encoded, err := Build(want)
	if err != nil {
		t.Fatalf("Build() error = %v", err)
	}
	if !strings.HasPrefix(string(encoded), `{"schema_version":2,`) {
		t.Fatalf("Build() = %s, want schema_version 2", encoded)
	}
	got, err := Parse(encoded)
	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}
	if !reflect.DeepEqual(got, Bundle{TestCases: want}) {
		t.Fatalf("Parse(Build()) = %+v, want %+v", got, want)
	}
	sample, err := BuildSample(want)
	if err != nil {
		t.Fatalf("BuildSample() error = %v", err)
	}
	got, err = Parse(sample)
	if err != nil || !reflect.DeepEqual(got, Bundle{TestCases: want, Sample: true}) {
		t.Fatalf("Parse(BuildSample()) = %+v (err %v), want the cases marked sample", got, err)
	}
}

func TestParse(t *testing.T) {
	t.Parallel()
	tooMany := `{"schema_version":2,"test_cases":[` + strings.Repeat(`{"stdin":"x","expected_output":"x","weight":1},`, MaxTestCases) + `{"stdin":"x","expected_output":"x","weight":1}]}`
	atLimit := `{"schema_version":1,"test_cases":[` + strings.Repeat(`{"stdin":"x","expected_output":"x"},`, MaxTestCases-1) + `{"stdin":"x","expected_output":"x"}]}`
	for _, testCase := range []struct {
		name       string
		input      string
		want       []TestCase
		wantLen    int
		wantSample bool
		wantErr    bool
	}{
		{name: "v1 defaults weight", input: `{"schema_version":1,"test_cases":[{"stdin":"1","expected_output":"2"}]}`, want: []TestCase{{Stdin: "1", ExpectedOutput: "2", Weight: 1}}},
		{name: "v1 rejects weight", input: `{"schema_version":1,"test_cases":[{"stdin":"1","expected_output":"2","weight":3}]}`, wantErr: true},
		{name: "v2 weight", input: `{"schema_version":2,"test_cases":[{"stdin":"1","expected_output":"2","weight":7}]}`, want: []TestCase{{Stdin: "1", ExpectedOutput: "2", Weight: 7}}},
		{name: "v2 requires weight", input: `{"schema_version":2,"test_cases":[{"stdin":"1","expected_output":"2"}]}`, wantErr: true},
		{name: "v2 weight zero", input: `{"schema_version":2,"test_cases":[{"stdin":"1","expected_output":"2","weight":0}]}`, wantErr: true},
		{name: "v2 weight above max", input: `{"schema_version":2,"test_cases":[{"stdin":"1","expected_output":"2","weight":101}]}`, wantErr: true},
		{name: "unsupported version", input: `{"schema_version":99,"test_cases":[{"stdin":"1","expected_output":"1"}]}`, wantErr: true},
		{name: "empty cases", input: `{"schema_version":2,"test_cases":[]}`, wantErr: true},
		{name: "malformed json", input: `not json`, wantErr: true},
		{name: "misnamed fields", input: `{"schema_version":1,"test_cases":[{"input":"5","output":"8"}]}`, wantErr: true},
		{name: "unknown top-level field", input: `{"schema_version":1,"extra":true,"test_cases":[{"stdin":"1","expected_output":"1"}]}`, wantErr: true},
		{name: "over case limit", input: tooMany, wantErr: true},
		{name: "at case limit", input: atLimit, wantLen: MaxTestCases},
		{name: "v2 sample visibility", input: `{"schema_version":2,"visibility":"sample","test_cases":[{"stdin":"1","expected_output":"2","weight":1}]}`, want: []TestCase{{Stdin: "1", ExpectedOutput: "2", Weight: 1}}, wantSample: true},
		{name: "v1 rejects visibility", input: `{"schema_version":1,"visibility":"sample","test_cases":[{"stdin":"1","expected_output":"2"}]}`, wantErr: true},
		{name: "unknown visibility", input: `{"schema_version":2,"visibility":"hidden","test_cases":[{"stdin":"1","expected_output":"2","weight":1}]}`, wantErr: true},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			got, err := Parse([]byte(testCase.input))
			if (err != nil) != testCase.wantErr {
				t.Fatalf("Parse() error = %v, wantErr = %t", err, testCase.wantErr)
			}
			if testCase.want != nil && !reflect.DeepEqual(got.TestCases, testCase.want) {
				t.Fatalf("Parse() = %+v, want %+v", got, testCase.want)
			}
			if testCase.wantLen != 0 && len(got.TestCases) != testCase.wantLen {
				t.Fatalf("Parse() returned %d cases, want %d", len(got.TestCases), testCase.wantLen)
			}
			if got.Sample != testCase.wantSample {
				t.Fatalf("Parse().Sample = %t, want %t", got.Sample, testCase.wantSample)
			}
		})
	}
}

func TestBuildRejectsInvalidInput(t *testing.T) {
	t.Parallel()
	valid := TestCase{Stdin: "1", ExpectedOutput: "1", Weight: 1}
	for _, testCase := range []struct {
		name  string
		cases []TestCase
	}{
		{name: "no cases"},
		{name: "weight zero", cases: []TestCase{{Stdin: "1", ExpectedOutput: "1"}}},
		{name: "weight above max", cases: []TestCase{{Stdin: "1", ExpectedOutput: "1", Weight: 101}}},
		{name: "too many cases", cases: make([]TestCase, MaxTestCases+1)},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			if _, err := Build(testCase.cases); err == nil {
				t.Fatal("Build() error = nil, want an error")
			}
		})
	}
	if _, err := Build([]TestCase{valid}); err != nil {
		t.Fatalf("Build(valid) error = %v", err)
	}
}

func TestMarshalTestCaseOmitsWeight(t *testing.T) {
	t.Parallel()
	encoded, err := MarshalTestCase(TestCase{Stdin: "a", ExpectedOutput: "b", Weight: 9})
	if err != nil {
		t.Fatal(err)
	}
	if want := `{"stdin":"a","expected_output":"b"}`; string(encoded) != want {
		t.Fatalf("MarshalTestCase() = %s, want %s", encoded, want)
	}
}

func TestUnitOutputRoundTrip(t *testing.T) {
	t.Parallel()
	long := "a" + strings.Repeat("é", MaxOutputBytes) // one ASCII byte then two-byte characters: the cut lands mid-character
	for _, testCase := range []struct {
		name  string
		input UnitOutput
		want  UnitOutput
	}{
		{
			name:  "plain output survives",
			input: UnitOutput{Stdin: "1 2\n", ExpectedOutput: "3\n", Stdout: "3\n", Stderr: "warn", CompileOutput: ""},
			want:  UnitOutput{Stdin: "1 2\n", ExpectedOutput: "3\n", Stdout: "3\n", Stderr: "warn", CompileOutput: ""},
		},
		{
			name:  "NUL bytes and invalid UTF-8 are made storable",
			input: UnitOutput{Stdout: "a\x00b\xffc"},
			want:  UnitOutput{Stdout: "ab\uFFFDc"},
		},
		{
			name:  "long output is cut on a character boundary",
			input: UnitOutput{Stdout: long},
			want:  UnitOutput{Stdout: long[:MaxOutputBytes-1]},
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			encoded, err := MarshalUnitOutput(testCase.input)
			if err != nil {
				t.Fatalf("MarshalUnitOutput() error = %v", err)
			}
			got, err := ParseUnitOutput(encoded)
			if err != nil {
				t.Fatalf("ParseUnitOutput() error = %v", err)
			}
			if got != testCase.want {
				t.Fatalf("round trip = %q, want %q", got.Stdout, testCase.want.Stdout)
			}
		})
	}
	if _, err := ParseUnitOutput([]byte(`{"stdout":"x","secret":1}`)); err == nil {
		t.Fatal("ParseUnitOutput() accepted an unknown field")
	}
}
