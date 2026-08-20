package telemetry

import (
	"context"
	"fmt"
	"os"
	"strconv"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
	"go.opentelemetry.io/otel/trace"
)

// InitProvider initialises the global OTel trace provider. If
// OTEL_EXPORTER_OTLP_ENDPOINT is empty the provider uses a no-op exporter so
// services start cleanly without a collector.
// The returned function must be called on graceful shutdown to flush spans.
func InitProvider(ctx context.Context, serviceName, version string) (func(context.Context), error) {
	res, err := resource.New(ctx,
		resource.WithAttributes(
			semconv.ServiceName(serviceName),
			semconv.ServiceVersion(version),
		),
	)
	if err != nil {
		return nil, fmt.Errorf("create otel resource: %w", err)
	}

	var exporter sdktrace.SpanExporter
	if os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT") != "" {
		exporter, err = otlptracehttp.New(ctx)
		if err != nil {
			return nil, fmt.Errorf("create otlp exporter: %w", err)
		}
	} else {
		exporter = &noopExporter{}
	}

	sampler := sdktrace.ParentBased(sdktrace.TraceIDRatioBased(samplerRatio()))

	provider := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exporter),
		sdktrace.WithResource(res),
		sdktrace.WithSampler(sampler),
	)

	otel.SetTracerProvider(provider)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	))

	return func(shutdownCtx context.Context) {
		_ = provider.Shutdown(shutdownCtx)
	}, nil
}

// Tracer returns a tracer from the global OTel provider.
func Tracer(name string) trace.Tracer {
	return otel.Tracer(name)
}

func samplerRatio() float64 {
	if s := os.Getenv("OTEL_TRACES_SAMPLER_ARG"); s != "" {
		if r, err := strconv.ParseFloat(s, 64); err == nil && r >= 0 && r <= 1 {
			return r
		}
	}
	return 0.1
}

type noopExporter struct{}

func (n *noopExporter) ExportSpans(_ context.Context, _ []sdktrace.ReadOnlySpan) error { return nil }
func (n *noopExporter) Shutdown(_ context.Context) error                               { return nil }
