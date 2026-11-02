package app

import (
	"strings"
	"testing"
)

func TestCodeTemplateComposeAndStarters(t *testing.T) {
	t.Parallel()
	templates := CodeTemplates{
		"python": {Starter: "def solve(a, b):\n    pass\n", Prefix: "", Suffix: "\na, b = map(int, input().split())\nprint(solve(a, b))\n"},
		"c":      {Starter: "int solve(int a, int b) {\n}\n", Prefix: "#include <stdio.h>\n", Suffix: "int main(){int a,b;scanf(\"%d %d\",&a,&b);printf(\"%d\\n\",solve(a,b));}\n"},
		"go":     {Starter: "  "},
	}
	if err := templates.validate(); err != nil {
		t.Fatal(err)
	}
	got := templates["python"].Compose("def solve(a, b):\n    return a + b\n")
	if !strings.HasPrefix(got, "def solve") || !strings.HasSuffix(got, "print(solve(a, b))\n") {
		t.Fatalf("compose = %q", got)
	}
	starters := templates.starters()
	if len(starters) != 2 || starters["go"] != "" {
		t.Fatalf("starters = %#v, want python and c only (a blank stub is not offered)", starters)
	}
	if _, leaked := any(starters).(map[string]string)["python"]; !leaked || strings.Contains(starters["python"], "print(solve") {
		t.Fatal("a starter must not carry the wrapper")
	}
}

func TestCodeTemplatesRejectBadInput(t *testing.T) {
	t.Parallel()
	for name, templates := range map[string]CodeTemplates{
		"bad language": {"Py Thon": {}},
		"huge stub":    {"c": {Starter: strings.Repeat("x", maxStarterBytes+1)}},
		"huge wrapper": {"c": {Suffix: strings.Repeat("x", maxWrapperBytes+1)}},
	} {
		if err := templates.validate(); err == nil {
			t.Errorf("%s accepted", name)
		}
	}
}
