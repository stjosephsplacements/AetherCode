// Package minio implements the storage.Object port backed by MinIO (dev/CI) or
// any S3-compatible store.
package minio

import (
	"fmt"
	"os"
	"strings"
)

// Config holds the connection parameters loaded from environment variables.
type Config struct {
	Endpoint  string
	AccessKey string
	SecretKey string
	Bucket    string
	UseSSL    bool
	Region    string
}

// LoadConfig reads the MinIO/S3 configuration from environment variables
// prefixed with prefix+"_". For example, LoadConfig("QBANK_STORAGE") reads
// QBANK_STORAGE_ENDPOINT, QBANK_STORAGE_ACCESS_KEY, etc.
func LoadConfig(prefix string) (Config, error) {
	env := func(name string) string { return os.Getenv(strings.ToUpper(prefix) + "_" + name) }
	c := Config{
		Endpoint:  env("ENDPOINT"),
		AccessKey: env("ACCESS_KEY"),
		SecretKey: env("SECRET_KEY"),
		Bucket:    env("BUCKET"),
		Region:    env("REGION"),
		UseSSL:    env("USE_SSL") == "true",
	}
	if c.Endpoint == "" {
		return Config{}, fmt.Errorf("storage: %s_ENDPOINT is required", strings.ToUpper(prefix))
	}
	if c.Bucket == "" {
		return Config{}, fmt.Errorf("storage: %s_BUCKET is required", strings.ToUpper(prefix))
	}
	return c, nil
}
