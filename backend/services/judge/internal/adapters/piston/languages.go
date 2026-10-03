package piston

import "fmt"

// language maps one platform language key (the same vocabulary as the Judge0
// adapter's table) to Piston's runtime name and source file name.
type language struct {
	pistonName string
	fileName   string
	// timeMultiplier scales the unit's limit for slower runtimes.
	timeMultiplier int
	// compileInRunMS is extra run time for runtimes that compile inside the
	// timed run (Piston runs Java as `java Main.java`).
	compileInRunMS int
}

var languages = map[string]language{
	"c":          {pistonName: "c", fileName: "main.c", timeMultiplier: 1},
	"cpp17":      {pistonName: "c++", fileName: "main.cpp", timeMultiplier: 1},
	"java":       {pistonName: "java", fileName: "Main.java", timeMultiplier: 2, compileInRunMS: 3000},
	"python3":    {pistonName: "python", fileName: "main.py", timeMultiplier: 2},
	"javascript": {pistonName: "javascript", fileName: "main.js", timeMultiplier: 2},
	"go":         {pistonName: "go", fileName: "main.go", timeMultiplier: 1},
}

// lookupLanguage rejects unmapped keys: running code under the wrong
// toolchain would produce misleading verdicts.
func lookupLanguage(key string) (language, error) {
	found, ok := languages[key]
	if !ok {
		return language{}, fmt.Errorf("piston: unsupported language key %q", key)
	}
	return found, nil
}
