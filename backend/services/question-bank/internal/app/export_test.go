package app

import (
	"testing"

	"github.com/aethercode/aethercode/libs/pkg/evalbundle"
)

func TestMarkSamplesFollowsTheEvaluationOrder(t *testing.T) {
	first := evalbundle.TestCase{Stdin: "1 2\n", ExpectedOutput: "3\n", Weight: 1}
	hidden := evalbundle.TestCase{Stdin: "-4 1\n", ExpectedOutput: "-3\n", Weight: 3}
	second := evalbundle.TestCase{Stdin: "5 7\n", ExpectedOutput: "12\n", Weight: 1}
	tests := markSamples([]evalbundle.TestCase{first, hidden, second}, []evalbundle.TestCase{first, second})
	want := []bool{true, false, true}
	for index, test := range tests {
		if test.Sample != want[index] {
			t.Fatalf("test %d sample = %v, want %v", index, test.Sample, want[index])
		}
	}
	if tests[1].Weight != 3 || tests[1].Input != "-4 1\n" || tests[1].ExpectedOutput != "-3\n" {
		t.Fatalf("hidden test = %+v", tests[1])
	}
}
