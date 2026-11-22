package similarity

// AlignTokens returns parallel token slices padded to equal length and marks
// indices where both sides hold the same non-empty token (staff visualiser).
func AlignTokens(a, b string) (tokensA, tokensB []string, shared []bool) {
	tokensA = Tokenize(a)
	tokensB = Tokenize(b)
	length := max(len(tokensA), len(tokensB))
	if length > len(tokensA) {
		tokensA = append(tokensA, make([]string, length-len(tokensA))...)
	}
	if length > len(tokensB) {
		tokensB = append(tokensB, make([]string, length-len(tokensB))...)
	}
	shared = make([]bool, length)
	for index := 0; index < length; index++ {
		if tokensA[index] != "" && tokensA[index] == tokensB[index] {
			shared[index] = true
		}
	}
	return tokensA, tokensB, shared
}