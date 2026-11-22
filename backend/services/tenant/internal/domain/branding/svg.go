package branding

import (
	"bytes"
	"fmt"
	"regexp"
	"strings"
)

var (
	dangerousSVGPattern = regexp.MustCompile(`(?is)<\s*(script|foreignObject|iframe|object|embed|link)\b`)
	eventHandlerPattern = regexp.MustCompile(`(?is)\son[a-z]+\s*=`)
	externalHrefPattern = regexp.MustCompile(`(?is)\s(?:href|xlink:href)\s*=\s*["']\s*(?:https?:|javascript:|data:text/html)`)
)

// SanitizeSVG strips active content from SVG logos before storage.
func SanitizeSVG(data []byte) ([]byte, error) {
	trimmed := bytes.TrimSpace(data)
	if len(trimmed) == 0 {
		return nil, fmt.Errorf("svg is empty")
	}
	text := string(trimmed)
	if dangerousSVGPattern.MatchString(text) || eventHandlerPattern.MatchString(text) || externalHrefPattern.MatchString(text) {
		return nil, fmt.Errorf("svg contains disallowed content")
	}
	if !strings.Contains(strings.ToLower(text), "<svg") {
		return nil, fmt.Errorf("svg root element is required")
	}
	return trimmed, nil
}
