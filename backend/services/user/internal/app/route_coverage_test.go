package app

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// A handler that authorizes a resource missing from the route table is refused
// for everyone (validateRequest), as snapshots and department rollups were.
// The scan reads each service's literal AuthorizeHTTP arguments; resources
// passed through a variable are not seen.
func TestEveryAuthorizedHandlerResourceIsInTheRouteTable(t *testing.T) {
	t.Parallel()
	call := regexp.MustCompile(`Authorize(?:Self)?HTTP\([^"]*?"(?:read|write|delete)",\s*"([a-z_]+)"`)
	for service, definition := range routes {
		var files []string
		err := filepath.WalkDir(filepath.Join("..", "..", "..", service), func(path string, entry os.DirEntry, walkErr error) error {
			if walkErr == nil && !entry.IsDir() && strings.HasSuffix(path, ".go") && !strings.HasSuffix(path, "_test.go") {
				files = append(files, path)
			}
			return walkErr
		})
		if err != nil {
			continue // a route target without a service directory in this checkout
		}
		for _, file := range files {
			content, readErr := os.ReadFile(file)
			if readErr != nil {
				t.Fatal(readErr)
			}
			for _, match := range call.FindAllStringSubmatch(string(content), -1) {
				if _, ok := definition.Resources[match[1]]; !ok {
					t.Errorf("%s authorizes %s.%s, which is not in the route table", file, service, match[1])
				}
			}
		}
	}
}
