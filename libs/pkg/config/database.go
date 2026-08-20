package config

import (
	"fmt"
	"strconv"
	"strings"
)

// Database describes a service-owned PostgreSQL connection pool.
type Database struct {
	URL      string
	MaxConns int32
	MinConns int32
}

// LoadDatabase reads a URL and bounded pool configuration. Prefix should be a
// service-specific value such as IDENTITY or SUBMISSION.
func LoadDatabase(prefix string) (Database, error) {
	prefix = strings.ToUpper(strings.TrimSpace(prefix))
	if prefix == "" {
		return Database{}, fmt.Errorf("database prefix must not be empty")
	}

	url := value(prefix+"_DATABASE_URL", "")
	if url == "" {
		return Database{}, fmt.Errorf("%s_DATABASE_URL is required", prefix)
	}

	maxConns, err := parsePositiveInt32(value(prefix+"_DB_MAX_CONNS", "20"))
	if err != nil {
		return Database{}, fmt.Errorf("%s_DB_MAX_CONNS: %w", prefix, err)
	}
	minConns, err := parseNonNegativeInt32(value(prefix+"_DB_MIN_CONNS", "2"))
	if err != nil {
		return Database{}, fmt.Errorf("%s_DB_MIN_CONNS: %w", prefix, err)
	}
	if minConns > maxConns {
		return Database{}, fmt.Errorf("%s_DB_MIN_CONNS must not exceed max connections", prefix)
	}

	return Database{URL: url, MaxConns: maxConns, MinConns: minConns}, nil
}

func parsePositiveInt32(raw string) (int32, error) {
	value, err := parseNonNegativeInt32(raw)
	if err != nil || value == 0 {
		return 0, fmt.Errorf("must be a positive integer")
	}
	return value, nil
}

func parseNonNegativeInt32(raw string) (int32, error) {
	value, err := strconv.ParseInt(raw, 10, 32)
	if err != nil || value < 0 {
		return 0, fmt.Errorf("must be a non-negative integer")
	}
	return int32(value), nil
}
