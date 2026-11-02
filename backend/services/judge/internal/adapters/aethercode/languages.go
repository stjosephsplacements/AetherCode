package aethercode

import "fmt"

// language maps one platform language key (as stored in
// qbank.question_versions.supported_languages) to the engine's language key.
type language struct {
	engineName string
	// timeMultiplier scales the unit's limit for slower runtimes, as the
	// exam app does.
	timeMultiplier int
}

var languages = map[string]language{
	"c":          {engineName: "c", timeMultiplier: 1},
	"cpp17":      {engineName: "cpp", timeMultiplier: 1},
	"java":       {engineName: "java", timeMultiplier: 2},
	"python3":    {engineName: "python", timeMultiplier: 2},
	"javascript": {engineName: "javascript", timeMultiplier: 2},
	"go":         {engineName: "go", timeMultiplier: 1},
	"rust":       {engineName: "rust", timeMultiplier: 1},
	"ruby":       {engineName: "ruby", timeMultiplier: 2},
	"php":        {engineName: "php", timeMultiplier: 2},
	"csharp":     {engineName: "csharp", timeMultiplier: 2},
	"bash":       {engineName: "bash", timeMultiplier: 1},
	"sqlite":     {engineName: "sqlite", timeMultiplier: 1},
}

// lookupLanguage rejects unmapped keys: running code under the wrong
// toolchain would produce misleading verdicts.
func lookupLanguage(key string) (language, error) {
	found, ok := languages[key]
	if !ok {
		return language{}, fmt.Errorf("aethercode: unsupported language key %q", key)
	}
	return found, nil
}
