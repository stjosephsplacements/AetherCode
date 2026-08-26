//go:build integration

// Package integration provides helpers for starting real infrastructure
// containers (PostgreSQL, NATS, …) in tests tagged //go:build integration.
// Tests in this package are excluded from make test and only run under
// make test-integration, which requires Docker.
package integration

import (
	"context"
	"testing"

	tcnats "github.com/testcontainers/testcontainers-go/modules/nats"
)

// StartNATS starts a real NATS 2.10 container and returns its connection URL
// (nats://…). The container is stopped when tb.Cleanup fires.
func StartNATS(ctx context.Context, tb testing.TB) string {
	tb.Helper()

	container, err := tcnats.Run(ctx, "nats:2.10")
	if err != nil {
		tb.Fatalf("StartNATS: start container: %v", err)
	}
	tb.Cleanup(func() { _ = container.Terminate(ctx) })

	url, err := container.ConnectionString(ctx)
	if err != nil {
		tb.Fatalf("StartNATS: connection string: %v", err)
	}

	return url
}
