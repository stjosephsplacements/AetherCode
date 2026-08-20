// Package logging configures structured JSON logging.
package logging

import (
	"fmt"
	"log/slog"
	"os"
	"strings"
)

// New returns a JSON logger using an explicit, validated level.
func New(level string) (*slog.Logger, error) {
	var configured slog.Level
	if err := configured.UnmarshalText([]byte(strings.ToUpper(level))); err != nil {
		return nil, fmt.Errorf("invalid log level %q: %w", level, err)
	}
	return slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: configured})), nil
}
