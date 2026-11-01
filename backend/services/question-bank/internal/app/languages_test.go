package app

import (
	"strings"
	"testing"
)

func TestDefaultLanguagesAreValid(t *testing.T) {
	t.Parallel()
	seen := map[string]bool{}
	for _, language := range DefaultLanguages() {
		if !languagePattern.MatchString(language.Key) || language.Name == "" || !editorModePattern.MatchString(language.Editor) || seen[language.Key] {
			t.Fatalf("invalid default language %+v", language)
		}
		seen[language.Key] = true
	}
	if !seen["python3"] || !seen["cpp17"] {
		t.Fatal("defaults must keep the keys existing questions and imports use")
	}
}

func TestParseLanguages(t *testing.T) {
	t.Parallel()
	languages, err := ParseLanguages(` [{"key":" python3 ","name":"Python 3","editor":"python"},{"key":"rust","name":"Rust","editor":"rust"}] `)
	if err != nil {
		t.Fatal(err)
	}
	if len(languages) != 2 || languages[0].Key != "python3" || languages[1].Name != "Rust" {
		t.Fatalf("unexpected languages: %+v", languages)
	}

	for name, raw := range map[string]string{
		"not an array":     `{"key":"c"}`,
		"empty":            `[]`,
		"unknown field":    `[{"key":"c","name":"C","editor":"c","extra":1}]`,
		"bad key":          `[{"key":"C++","name":"C++","editor":"cpp"}]`,
		"duplicate key":    `[{"key":"c","name":"C","editor":"c"},{"key":"c","name":"C again","editor":"c"}]`,
		"missing name":     `[{"key":"c","name":" ","editor":"c"}]`,
		"long name":        `[{"key":"c","name":"` + strings.Repeat("x", 41) + `","editor":"c"}]`,
		"bad editor mode":  `[{"key":"c","name":"C","editor":"Not A Mode"}]`,
		"too many entries": "[" + strings.TrimSuffix(strings.Repeat(`{"key":"k","name":"K","editor":"c"},`, 33), ",") + "]",
	} {
		if _, err := ParseLanguages(raw); err == nil {
			t.Errorf("%s: accepted %s", name, raw)
		}
	}
}

func TestNormalizeCategoryName(t *testing.T) {
	t.Parallel()
	for input, want := range map[string]string{"Arrays": "Arrays", "  Dynamic   Programming ": "Dynamic Programming", "Two\tPointers": "Two Pointers"} {
		got, err := NormalizeCategoryName(input)
		if err != nil || got != want {
			t.Errorf("NormalizeCategoryName(%q) = %q, %v; want %q", input, got, err, want)
		}
	}
	for _, input := range []string{"", "   ", strings.Repeat("x", 81), "bad\x00name"} {
		if _, err := NormalizeCategoryName(input); err == nil {
			t.Errorf("NormalizeCategoryName(%q) was accepted", input)
		}
	}
}
