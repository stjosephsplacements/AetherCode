package httpx

import (
	"context"

	"github.com/aethercode/aethercode/libs/pkg/telemetry"
)

// ContextWithRequestID stores a request ID in the context. The value is
// readable by any package using RequestIDFromContext or
// telemetry.RequestIDFromContext.
func ContextWithRequestID(ctx context.Context, id string) context.Context {
	return telemetry.ContextWithRequestID(ctx, id)
}

// RequestIDFromContext retrieves the request ID stored by ContextWithRequestID,
// or returns an empty string if none was set.
func RequestIDFromContext(ctx context.Context) string {
	return telemetry.RequestIDFromContext(ctx)
}
