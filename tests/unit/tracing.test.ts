import { describe, expect, it } from 'vitest';
import type { Span, Tracer } from '../../src/application/ports/tracer.js';
import type {
  TransactionalRepositories,
  UnitOfWork,
} from '../../src/application/ports/unit-of-work.js';
import { NoopTracer } from '../../src/infrastructure/observability/noop-tracer.js';
import { TracingUnitOfWork } from '../../src/infrastructure/persistence/tracing-unit-of-work.js';

interface SpanRecord {
  name: string;
  ended: boolean;
}

class RecordingTracer implements Tracer {
  readonly spans: SpanRecord[] = [];

  async inSpan<T>(name: string, work: (span: Span) => Promise<T>): Promise<T> {
    const record: SpanRecord = { name, ended: false };
    this.spans.push(record);
    try {
      return await work({ setAttribute() {} });
    } finally {
      record.ended = true;
    }
  }
}

const repos = {} as TransactionalRepositories;

class StubUnitOfWork implements UnitOfWork {
  ran = 0;
  run<T>(work: (r: TransactionalRepositories) => Promise<T>): Promise<T> {
    this.ran += 1;
    return work(repos);
  }
}

describe('NoopTracer', () => {
  it('runs the work and returns its result', async () => {
    const result = await new NoopTracer().inSpan('whatever', async () => 42);
    expect(result).toBe(42);
  });

  it('propagates errors unchanged', async () => {
    const boom = new Error('boom');
    await expect(
      new NoopTracer().inSpan('whatever', async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
  });
});

describe('TracingUnitOfWork', () => {
  it('wraps each run in a unit_of_work.run span and delegates to the inner uow', async () => {
    const inner = new StubUnitOfWork();
    const tracer = new RecordingTracer();
    const uow = new TracingUnitOfWork(inner, tracer);

    const result = await uow.run(async () => 'done');

    expect(result).toBe('done');
    expect(inner.ran).toBe(1);
    expect(tracer.spans).toEqual([{ name: 'unit_of_work.run', ended: true }]);
  });

  it('ends the span even when the inner work throws, and re-throws', async () => {
    const tracer = new RecordingTracer();
    const failing: UnitOfWork = {
      run() {
        return Promise.reject(new Error('rollback'));
      },
    };
    const uow = new TracingUnitOfWork(failing, tracer);

    await expect(uow.run(async () => undefined)).rejects.toThrow('rollback');
    expect(tracer.spans).toEqual([{ name: 'unit_of_work.run', ended: true }]);
  });
});
