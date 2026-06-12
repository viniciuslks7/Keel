# ADR-0007: Tracing wraps the unit of work behind a port

- Status: accepted
- Date: 2026-06-12

## Context

When a request is slow or an operation fails intermittently, the question is
always "where did the time go, and how far did it get?". The unit of work is the
natural span for that answer: it is the atomic boundary every write passes
through, nested below the HTTP request and above the database queries. We want a
trace per unit of work without dragging an observability vendor into the domain,
and without paying for instrumentation in tests or in deployments that do not
collect traces.

## Decision

The application layer defines a small `Tracer` port — `inSpan(name, work)` — and
nothing more. Use cases stay oblivious to it; the seam lives in a
`TracingUnitOfWork` decorator that wraps the real unit of work and runs each
`run` inside a span named `unit_of_work.run`. The decorator is transparent: the
inner unit of work still owns the transaction, so tracing can be added or
removed by composition alone, with no change to a single use case.

Two adapters back the port:

- `OtelTracer` maps it onto the **`@opentelemetry/api`** package. We depend on
  the API only, not the SDK. `startActiveSpan` makes our span the active one, so
  spans from auto-instrumentation underneath (pg, outbound HTTP) nest beneath it
  and the trace reads as one tree. When no provider is registered the API hands
  back no-op spans, so the cost is nil until a deployment opts in.
- `NoopTracer` is the default elsewhere (tests, the in-memory demo).

Exporting traces is an operator concern, not a code change: run the process with
an OpenTelemetry SDK registered (for example
`node --import @opentelemetry/auto-instrumentations-node/register`) pointed at a
collector. The service code is identical with or without it.

## Consequences

- The only new runtime dependency is `@opentelemetry/api`, a stable, dependency-
  light contract package — consistent with the service's minimal footprint.
- Spans are currently coarse: one per unit of work, named generically. Carrying
  the use-case name or row counts as span attributes is a later refinement; the
  `Span.setAttribute` hook on the port already allows it without an API change.
- Because the API no-ops without a provider, the happy path and the test suite
  exercise the seam but never assert on exported spans — the decorator's
  behaviour (delegate, end the span, re-throw) is what the tests pin down.
