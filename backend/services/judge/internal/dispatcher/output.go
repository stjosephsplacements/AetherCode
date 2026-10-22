package dispatcher

import "strings"

// OutputsMatch compares a program's output with the expected output after
// normalizing line endings, trailing whitespace on each line, and trailing
// blank lines: the usual judge leniency for line-oriented output. The
// AetherCode adapter grades with it, since that engine only executes code.
func OutputsMatch(actual, expected string) bool {
	return normalizeOutput(actual) == normalizeOutput(expected)
}

func normalizeOutput(value string) string {
	value = strings.ReplaceAll(value, "\r\n", "\n")
	value = strings.ReplaceAll(value, "\r", "\n")
	lines := strings.Split(value, "\n")
	for index, line := range lines {
		lines[index] = strings.TrimRight(line, " \t")
	}
	return strings.TrimRight(strings.Join(lines, "\n"), "\n")
}
