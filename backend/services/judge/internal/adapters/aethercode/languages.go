package aethercode

import "fmt"

// language maps one platform language key (the Judge0 adapter's
// vocabulary) to the engine's language key.
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
