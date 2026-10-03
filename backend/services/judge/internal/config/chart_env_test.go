package config

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// Variables the judge reads through a shared prefix helper rather than a
// literal name in its own code: config.LoadDatabase("JUDGE") reads
// JUDGE_DATABASE_URL, and libs/pkg/config reads AETHERCODE_ENV.
var derivedEnv = map[string]bool{"JUDGE_DATABASE_URL": true, "AETHERCODE_ENV": true}

// TestChartSetsOnlyVariablesTheJudgeReads guards against the chart and the Go
// configuration drifting apart, which once left Judge0 impossible to enable
// (the chart set JUDGE_ENGINE_ENDPOINT while the code read JUDGE0_BASE_URL).
func TestChartSetsOnlyVariablesTheJudgeReads(t *testing.T) {
	t.Parallel()
	root := filepath.Join("..", "..", "..", "..", "..")
	templates, err := filepath.Glob(filepath.Join(root, "deploy", "helm", "charts", "judge-control", "templates", "*.yaml"))
	if err != nil || len(templates) == 0 {
		t.Fatalf("judge-control templates not found: %v", err)
	}
	setByChart := map[string]bool{}
	envName := regexp.MustCompile(`(?m)^\s+(?:- name: )?((?:JUDGE|AETHERCODE_)[A-Z0-9_]*):?`)
	for _, path := range templates {
		content, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		for _, match := range envName.FindAllStringSubmatch(string(content), -1) {
			setByChart[match[1]] = true
		}
	}

	var source strings.Builder
	err = filepath.WalkDir(filepath.Join("..", ".."), func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil || entry.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return walkErr
		}
		content, readErr := os.ReadFile(path)
		source.Write(content)
		return readErr
	})
	if err != nil {
		t.Fatal(err)
	}
	code := source.String()
	for name := range setByChart {
		if !derivedEnv[name] && !strings.Contains(code, `"`+name+`"`) {
			t.Errorf("judge-control chart sets %s, which the judge service never reads", name)
		}
	}
}
