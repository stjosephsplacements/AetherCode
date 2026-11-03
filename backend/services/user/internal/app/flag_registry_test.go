package app

import (
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"testing"
)

// Every route resource needs its read, write and delete flag in the registry (ADR-0066). The registry is
// append-only SQL, so a new route fails this test until a later migration registers its flags.
func TestEveryRouteResourceHasRegisteredFlags(t *testing.T) {
	t.Parallel()
	files, err := filepath.Glob("../../migrations/*.up.sql")
	if err != nil || len(files) == 0 {
		t.Fatalf("migrations not found: %v", err)
	}
	flag := regexp.MustCompile(`\('([a-z][a-z0-9_.-]*\.(?:read|write|delete))',\s*(\d+),\s*'resource'`)
	registered := map[string]int{}
	used := map[int]string{}
	for _, file := range files {
		content, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		for _, match := range flag.FindAllStringSubmatch(string(content), -1) {
			index, _ := strconv.Atoi(match[2])
			if other, taken := used[index]; taken && other != match[1] {
				t.Errorf("bit %d registered for both %s and %s", index, other, match[1])
			}
			if index < 16 || index > 255 {
				t.Errorf("resource flag %s has bit %d outside 16..255", match[1], index)
			}
			registered[match[1]] = index
			used[index] = match[1]
		}
	}
	for service, definition := range routes {
		for resource := range definition.Resources {
			for _, verb := range []string{"read", "write", "delete"} {
				key := service + "." + resource + "." + verb
				if _, ok := registered[key]; !ok {
					t.Errorf("route flag %s is not in the permission_flags registry", key)
				}
			}
		}
	}
}
