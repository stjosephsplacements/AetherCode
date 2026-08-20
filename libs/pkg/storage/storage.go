// Package storage defines the object storage port. Adapters include MinIO (dev/CI)
// and S3 (production). The interface is intentionally narrow: only operations
// required by current consumers are declared here.
package storage

import (
	"context"
	"io"
	"time"
)

// Object is the storage port. Implementations must be safe for concurrent use.
type Object interface {
	// Put stores r under key. size must equal the exact byte count of r; pass -1
	// only when unknown (streaming). contentType is stored as object metadata.
	Put(ctx context.Context, key string, r io.Reader, size int64, contentType string) error

	// Get returns a reader for the object identified by key. The caller is
	// responsible for closing the reader.
	Get(ctx context.Context, key string) (io.ReadCloser, error)

	// Delete removes the object at key. No error is returned when the object
	// does not exist.
	Delete(ctx context.Context, key string) error

	// Exists reports whether key names an existing object.
	Exists(ctx context.Context, key string) (bool, error)

	// PresignGet returns a time-limited pre-signed URL that allows the bearer
	// to download the object without additional credentials.
	PresignGet(ctx context.Context, key string, expiry time.Duration) (string, error)
}
