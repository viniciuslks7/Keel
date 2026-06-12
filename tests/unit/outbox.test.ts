import { beforeEach, describe, expect, it } from 'vitest';
import { OutboxRelay } from '../../src/application/outbox-relay.js';
import type { EventPublisher } from '../../src/application/ports/event-publisher.js';
import type { DomainEvent, DomainEventType } from '../../src/domain/events.js';
import { buildTestContext, type TestContext } from '../helpers/fixed-deps.js';

async function readOutbox(ctx: TestContext): Promise<DomainEvent[]> {
  return ctx.uow.run(({ outbox }) => outbox.pullUnpublished(1000));
}

function typesOf(events: readonly DomainEvent[]): DomainEventType[] {
  return events.map((event) => event.type);
}

describe('outbox event emission', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await buildTestContext();
  });

  it('starts empty after bootstrap (system accounts emit no events)', async () => {
    expect(await readOutbox(ctx)).toHaveLength(0);
  });

  it('emits AccountOpened when an account is created', async () => {
    const account = await ctx.createAccount.execute({ ownerName: 'Ana', currency: 'BRL' });

    const events = await readOutbox(ctx);
    expect(typesOf(events)).toEqual(['AccountOpened']);
    expect(events[0]).toMatchObject({
      type: 'AccountOpened',
      accountId: account.id,
      ownerName: 'Ana',
      currency: 'BRL',
    });
  });

  it('emits FundsDeposited carrying the transaction id', async () => {
    const account = await ctx.createAccount.execute({ ownerName: 'Ana', currency: 'BRL' });
    const tx = await ctx.depositFunds.execute({ accountId: account.id, amountCents: 5_00 });

    const events = await readOutbox(ctx);
    expect(typesOf(events)).toEqual(['AccountOpened', 'FundsDeposited']);
    expect(events[1]).toMatchObject({
      type: 'FundsDeposited',
      accountId: account.id,
      amountCents: 5_00,
      currency: 'BRL',
      transactionId: tx.id,
    });
  });

  it('emits FundsWithdrawn when funds leave an account', async () => {
    const account = await ctx.createAccount.execute({ ownerName: 'Ana', currency: 'BRL' });
    await ctx.depositFunds.execute({ accountId: account.id, amountCents: 5_00 });
    const tx = await ctx.withdrawFunds.execute({ accountId: account.id, amountCents: 2_00 });

    const events = await readOutbox(ctx);
    expect(typesOf(events)).toEqual(['AccountOpened', 'FundsDeposited', 'FundsWithdrawn']);
    expect(events[2]).toMatchObject({
      type: 'FundsWithdrawn',
      accountId: account.id,
      amountCents: 2_00,
      currency: 'BRL',
      transactionId: tx.id,
    });
  });

  it('emits FundsTransferred naming both sides of the move', async () => {
    const from = await ctx.createAccount.execute({ ownerName: 'Ana', currency: 'BRL' });
    const to = await ctx.createAccount.execute({ ownerName: 'Beto', currency: 'BRL' });
    await ctx.depositFunds.execute({ accountId: from.id, amountCents: 5_00 });
    const tx = await ctx.transferFunds.execute({
      fromAccountId: from.id,
      toAccountId: to.id,
      amountCents: 3_00,
    });

    const events = await readOutbox(ctx);
    expect(events.at(-1)).toMatchObject({
      type: 'FundsTransferred',
      fromAccountId: from.id,
      toAccountId: to.id,
      amountCents: 3_00,
      currency: 'BRL',
      transactionId: tx.id,
    });
  });

  it('emits AccountClosed when an empty account is closed', async () => {
    const account = await ctx.createAccount.execute({ ownerName: 'Ana', currency: 'BRL' });
    await ctx.closeAccount.execute(account.id);

    const events = await readOutbox(ctx);
    expect(typesOf(events)).toEqual(['AccountOpened', 'AccountClosed']);
    expect(events.at(-1)).toMatchObject({ type: 'AccountClosed', accountId: account.id });
  });

  it('does not emit AccountClosed when closing is a no-op', async () => {
    const account = await ctx.createAccount.execute({ ownerName: 'Ana', currency: 'BRL' });
    await ctx.closeAccount.execute(account.id);
    await ctx.closeAccount.execute(account.id); // already closed: idempotent no-op

    const closedEvents = (await readOutbox(ctx)).filter((event) => event.type === 'AccountClosed');
    expect(closedEvents).toHaveLength(1);
  });
});

class RecordingPublisher implements EventPublisher {
  readonly batches: DomainEvent[][] = [];

  async publish(events: readonly DomainEvent[]): Promise<void> {
    this.batches.push([...events]);
  }
}

class FailingPublisher implements EventPublisher {
  async publish(): Promise<void> {
    throw new Error('broker unreachable');
  }
}

describe('OutboxRelay', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await buildTestContext();
    const account = await ctx.createAccount.execute({ ownerName: 'Ana', currency: 'BRL' });
    await ctx.depositFunds.execute({ accountId: account.id, amountCents: 5_00 });
  });

  it('publishes unpublished events and then marks them published', async () => {
    const publisher = new RecordingPublisher();
    const relay = new OutboxRelay(ctx.uow, publisher);

    const drained = await relay.drain();
    expect(typesOf(drained)).toEqual(['AccountOpened', 'FundsDeposited']);
    expect(publisher.batches).toHaveLength(1);

    // Outbox is now empty: a second drain has nothing to do.
    expect(await relay.drain()).toHaveLength(0);
    expect(publisher.batches).toHaveLength(1);
    expect(await readOutbox(ctx)).toHaveLength(0);
  });

  it('keeps events unpublished when the publisher fails (at-least-once)', async () => {
    const relay = new OutboxRelay(ctx.uow, new FailingPublisher());

    await expect(relay.drain()).rejects.toThrow('broker unreachable');

    // Nothing was marked published, so a healthy relay re-delivers them.
    const publisher = new RecordingPublisher();
    const recovered = await new OutboxRelay(ctx.uow, publisher).drain();
    expect(typesOf(recovered)).toEqual(['AccountOpened', 'FundsDeposited']);
    expect(publisher.batches).toHaveLength(1);
  });
});
