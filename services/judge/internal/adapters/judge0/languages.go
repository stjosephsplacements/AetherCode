package judge0

import "fmt"

// judgeLanguageIDs maps this platform's language keys (as stored in
// qbank.question_versions.supported_languages) to Judge0's numeric language
// IDs. This is the platform's own canonical language-key vocabulary — no
// language list existed before this adapter, so this map is the source of
// truth going forward. Extending supported languages is a one-line addition
// here, not a schema change.
var judgeLanguageIDs = map[string]int{
	"python3":    71,
	"java":       62,
	"cpp17":      54,
	"c":          50,
	"javascript": 63,
	"go":         60,
}

// judgeLanguageID resolves this platform's language key to Judge0's numeric
// language ID. An unmapped key is a validation error, never a silent default
// — running code under the wrong language's compiler/interpreter would
// produce misleading verdicts.
func judgeLanguageID(languageKey string) (int, error) {
	id, ok := judgeLanguageIDs[languageKey]
	if !ok {
		return 0, fmt.Errorf("judge0: unsupported language key %q", languageKey)
	}
	return id, nil
}
