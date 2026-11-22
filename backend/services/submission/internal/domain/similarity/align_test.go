package similarity

import "testing"

func TestAlignTokensMarksEqualSequence(t *testing.T) {
	t.Parallel()
	a, b, shared := AlignTokens("int main(){ return 1; }", "int main(){ return 2; }")
	if len(a) != len(b) || len(a) != len(shared) {
		t.Fatalf("length mismatch: %d %d %d", len(a), len(b), len(shared))
	}
	var matched int
	for _, ok := range shared {
		if ok {
			matched++
		}
	}
	if matched == 0 {
		t.Fatal("expected some shared tokens")
	}
}