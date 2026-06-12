import { type Span as OtelSpan, SpanStatusCode, trace } from '@opentelemetry/api';
import type { Span, Tracer } from '../../application/ports/tracer.js';

/**
 * Binds the Tracer port to the OpenTelemetry API. `startActiveSpan` installs
 * the span as current, so spans created by auto-instrumentation underneath
 * (pg queries, outbound calls) nest beneath ours and the trace reads as one
 * tree. If no provider is registered the OpenTelemetry API returns no-op spans,
 * so constructing this tracer is always safe; export is the operator's choice.
 */
export class OtelTracer implements Tracer {
  private readonly tracer = trace.getTracer('keel');

  inSpan<T>(name: string, work: (span: Span) => Promise<T>): Promise<T> {
    return this.tracer.startActiveSpan(name, async (span: OtelSpan) => {
      try {
        return await work({
          setAttribute: (key, value) => {
            span.setAttribute(key, value);
          },
        });
      } catch (error) {
        span.recordException(error as Error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      } finally {
        span.end();
      }
    });
  }
}
