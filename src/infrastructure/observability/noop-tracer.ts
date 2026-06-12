import type { Span, Tracer } from '../../application/ports/tracer.js';

const NOOP_SPAN: Span = {
  setAttribute() {
    // discarded
  },
};

/**
 * The default tracer: runs the work with no instrumentation. Used in tests and
 * whenever a deployment has not wired up an OpenTelemetry provider, so the
 * tracing seam costs nothing when nobody is listening.
 */
export class NoopTracer implements Tracer {
  inSpan<T>(_name: string, work: (span: Span) => Promise<T>): Promise<T> {
    return work(NOOP_SPAN);
  }
}
