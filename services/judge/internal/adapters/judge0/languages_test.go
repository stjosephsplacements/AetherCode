package judge0

import "testing"

func TestJudgeLanguageIDKnownLanguages(t *testing.T) {
	t.Parallel()
	testCases := []struct {
		name string
		key  string
		want int
	}{
		{name: "python3", key: "python3", want: 71},
		{name: "java", key: "java", want: 62},
		{name: "cpp17", key: "cpp17", want: 54},
		{name: "c", key: "c", want: 50},
		{name: "javascript", key: "javascript", want: 63},
		{name: "go", key: "go", want: 60},
	}
	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			got, err := judgeLanguageID(testCase.key)
			if err != nil {
				t.Fatalf("judgeLanguageID(%q) error = %v", testCase.key, err)
			}
			if got != testCase.want {
				t.Fatalf("judgeLanguageID(%q) = %d, want %d", testCase.key, got, testCase.want)
			}
		})
	}
}

func TestJudgeLanguageIDUnknownLanguageErrors(t *testing.T) {
	t.Parallel()
	if _, err := judgeLanguageID("cobol"); err == nil {
		t.Fatal("judgeLanguageID(\"cobol\") error = nil, want an error for an unmapped language")
	}
}

func TestJudgeLanguageIDEmptyKeyErrors(t *testing.T) {
	t.Parallel()
	if _, err := judgeLanguageID(""); err == nil {
		t.Fatal("judgeLanguageID(\"\") error = nil, want an error")
	}
}
