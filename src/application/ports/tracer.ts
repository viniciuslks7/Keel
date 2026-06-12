/**
 * A neutral tracing seam. The application layer marks the spans it cares about
 * — chiefly the unit-of-work boundary — without knowing which tracer backs
 * them. Infrastructure binds this to OpenTelemetry (or to a no-op when tracing
 * is not configured); see ADR-0007.
 */
export interface Span {
  setAttribute(key: string, value: string | number | boolean): void;
}

export interface Tracer {
  /**
   * Runs `work` inside a span named `name`. The span ends when `work` settles;
   * a thrown error is recorded on the span and re-thrown unchanged. Nested
   * `inSpan` calls form parent/child spans.
   */
  inSpan<T>(name: string, work: (span: Span) => Promise<T>): Promise<T>;
}
