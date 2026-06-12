import type { Tracer } from '../../application/ports/tracer.js';
import type {
  TransactionalRepositories,
  UnitOfWork,
} from '../../application/ports/unit-of-work.js';

/**
 * Wraps another unit of work in a span, so every atomic boundary in the system
 * shows up as one node in a trace. It is a transparent decorator: the inner
 * unit of work still owns the transaction; this only observes it (ADR-0007).
 */
export class TracingUnitOfWork implements UnitOfWork {
  constructor(
    private readonly inner: UnitOfWork,
    private readonly tracer: Tracer,
  ) {}

  run<T>(work: (repos: TransactionalRepositories) => Promise<T>): Promise<T> {
    return this.tracer.inSpan('unit_of_work.run', () => this.inner.run(work));
  }
}
