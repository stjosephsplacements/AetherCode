package app

import (
	"bytes"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
)

// Language is a programming language an author can offer in a coding question.
type Language struct {
	// Key is the Judge language key stored in supported_languages.
	Key string `json:"key"`
	// Name is what people see.
	Name string `json:"name"`
	// Editor is the code editor's syntax mode for the language.
	Editor string `json:"editor"`
}

var editorModePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9+#_.-]{0,31}$`)

// DefaultLanguages are the languages Judge runs out of the box. QBANK_LANGUAGES
// replaces them when an operator adds or removes a toolchain.
func DefaultLanguages() []Language {
	return []Language{
		{Key: "c", Name: "C", Editor: "c"},
		{Key: "cpp17", Name: "C++17", Editor: "cpp"},
		{Key: "java", Name: "Java", Editor: "java"},
		{Key: "python3", Name: "Python 3", Editor: "python"},
		{Key: "javascript", Name: "JavaScript", Editor: "javascript"},
		{Key: "go", Name: "Go", Editor: "go"},
	}
}

// ParseLanguages reads QBANK_LANGUAGES: a JSON array of languages with a key,
// a name and an editor mode. It rejects anything the question bank could not
// store as a supported language.
func ParseLanguages(raw string) ([]Language, error) {
	var languages []Language
	decoder := json.NewDecoder(bytes.NewReader([]byte(raw)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&languages); err != nil {
		return nil, fmt.Errorf("languages must be a JSON array of {key, name, editor}: %w", err)
	}
	if len(languages) == 0 || len(languages) > maximumSupportedLanguage {
		return nil, fmt.Errorf("languages must list between 1 and %d entries", maximumSupportedLanguage)
	}
	seen := make(map[string]struct{}, len(languages))
	for index := range languages {
		entry := &languages[index]
		entry.Key = strings.TrimSpace(entry.Key)
		entry.Name = strings.TrimSpace(entry.Name)
		entry.Editor = strings.TrimSpace(entry.Editor)
		if !languagePattern.MatchString(entry.Key) {
			return nil, fmt.Errorf("language key %q is not a valid Judge key", entry.Key)
		}
		if _, duplicate := seen[entry.Key]; duplicate {
			return nil, fmt.Errorf("language key %q is listed twice", entry.Key)
		}
		seen[entry.Key] = struct{}{}
		if entry.Name == "" || len(entry.Name) > 40 {
			return nil, fmt.Errorf("language %q needs a name of at most 40 characters", entry.Key)
		}
		if !editorModePattern.MatchString(entry.Editor) {
			return nil, fmt.Errorf("language %q needs an editor mode such as \"python\"", entry.Key)
		}
	}
	return languages, nil
}
