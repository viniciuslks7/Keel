import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/infrastructure/http/app.js';
import { buildTestContext } from '../helpers/fixed-deps.js';

describe('HTTP API', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    const ctx = await buildTestContext();
    app = buildApp(ctx);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  async function createAccount(currency = 'BRL'): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/accounts',
      payload: { ownerName: 'Grace Hopper', currency },
    });
    expect(response.statusCode).toBe(201);
    return response.json().id;
  }

  it('GET /health reports ok', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('ok');
  });

  it('POST /accounts creates an account', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/accounts',
      payload: { ownerName: 'Grace Hopper', currency: 'BRL' },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body).toMatchObject({ ownerName: 'Grace Hopper', currency: 'BRL', status: 'ACTIVE' });
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('POST /accounts rejects an unsupported currency with problem+json', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/accounts',
      payload: { ownerName: 'Grace Hopper', currency: 'XYZ' },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().title).toBe('SYSTEM_ACCOUNT_MISSING');
  });

  it('POST /accounts validates the payload', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/accounts',
      payload: { ownerName: '', currency: 'brl' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json().title).toBe('VALIDATION_ERROR');
  });

  it('deposit → balance → withdraw round-trip', async () => {
    const accountId = await createAccount();

    const deposit = await app.inject({
      method: 'POST',
      url: `/accounts/${accountId}/deposits`,
      payload: { amountCents: 25_000 },
    });
    expect(deposit.statusCode).toBe(201);
    expect(deposit.json().type).toBe('DEPOSIT');

    const withdrawal = await app.inject({
      method: 'POST',
      url: `/accounts/${accountId}/withdrawals`,
      payload: { amountCents: 5_000 },
    });
    expect(withdrawal.statusCode).toBe(201);

    const balance = await app.inject({ method: 'GET', url: `/accounts/${accountId}/balance` });
    expect(balance.json()).toEqual({ accountId, balanceCents: 20_000, currency: 'BRL' });
  });

  it('overdraft returns 422 problem+json', async () => {
    const accountId = await createAccount();

    const response = await app.inject({
      method: 'POST',
      url: `/accounts/${accountId}/withdrawals`,
      payload: { amountCents: 1 },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().title).toBe('INSUFFICIENT_FUNDS');
  });

  it('unknown account returns 404 problem+json', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/accounts/00000000-0000-4000-8000-000000000000/balance',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().title).toBe('ACCOUNT_NOT_FOUND');
  });

  it('POST /accounts/:id/close closes an empty account, then blocks deposits', async () => {
    const accountId = await createAccount();

    const close = await app.inject({ method: 'POST', url: `/accounts/${accountId}/close` });
    expect(close.statusCode).toBe(200);
    expect(close.json().status).toBe('CLOSED');

    const deposit = await app.inject({
      method: 'POST',
      url: `/accounts/${accountId}/deposits`,
      payload: { amountCents: 100 },
    });
    expect(deposit.statusCode).toBe(409);
    expect(deposit.json().title).toBe('ACCOUNT_CLOSED');
  });

  it('refuses to close a funded account with 409 problem+json', async () => {
    const accountId = await createAccount();
    await app.inject({
      method: 'POST',
      url: `/accounts/${accountId}/deposits`,
      payload: { amountCents: 5_000 },
    });

    const close = await app.inject({ method: 'POST', url: `/accounts/${accountId}/close` });
    expect(close.statusCode).toBe(409);
    expect(close.json().title).toBe('ACCOUNT_NOT_EMPTY');
  });

  it('POST /transfers moves money between accounts', async () => {
    const alice = await createAccount();
    const bob = await createAccount();
    await app.inject({
      method: 'POST',
      url: `/accounts/${alice}/deposits`,
      payload: { amountCents: 10_000 },
    });

    const transfer = await app.inject({
      method: 'POST',
      url: '/transfers',
      payload: { fromAccountId: alice, toAccountId: bob, amountCents: 7_500 },
    });
    expect(transfer.statusCode).toBe(201);
    expect(transfer.json().type).toBe('TRANSFER');

    const bobBalance = await app.inject({ method: 'GET', url: `/accounts/${bob}/balance` });
    expect(bobBalance.json().balanceCents).toBe(7_500);
  });

  it('POST /exchanges converts money across currencies', async () => {
    const alice = await createAccount('BRL');
    const bob = await createAccount('USD');
    await app.inject({
      method: 'POST',
      url: `/accounts/${alice}/deposits`,
      payload: { amountCents: 100_00 },
    });

    const exchange = await app.inject({
      method: 'POST',
      url: '/exchanges',
      payload: { fromAccountId: alice, toAccountId: bob, fromAmountCents: 50_00, rate: 0.2 },
    });
    expect(exchange.statusCode).toBe(201);
    expect(exchange.json().type).toBe('TRANSFER');

    const aliceBalance = await app.inject({ method: 'GET', url: `/accounts/${alice}/balance` });
    const bobBalance = await app.inject({ method: 'GET', url: `/accounts/${bob}/balance` });
    expect(aliceBalance.json().balanceCents).toBe(50_00);
    expect(bobBalance.json().balanceCents).toBe(10_00);
  });

  it('POST /exchanges rejects a same-currency pair with problem+json', async () => {
    const alice = await createAccount('BRL');
    const bob = await createAccount('BRL');

    const exchange = await app.inject({
      method: 'POST',
      url: '/exchanges',
      payload: { fromAccountId: alice, toAccountId: bob, fromAmountCents: 1_00, rate: 1 },
    });
    expect(exchange.statusCode).toBe(422);
    expect(exchange.json().title).toBe('CURRENCY_MISMATCH');
  });

  it('honours the Idempotency-Key header on replays', async () => {
    const accountId = await createAccount();

    const first = await app.inject({
      method: 'POST',
      url: `/accounts/${accountId}/deposits`,
      headers: { 'idempotency-key': 'client-retry-1' },
      payload: { amountCents: 1_000 },
    });
    const replay = await app.inject({
      method: 'POST',
      url: `/accounts/${accountId}/deposits`,
      headers: { 'idempotency-key': 'client-retry-1' },
      payload: { amountCents: 1_000 },
    });

    expect(replay.json().id).toBe(first.json().id);

    const balance = await app.inject({ method: 'GET', url: `/accounts/${accountId}/balance` });
    expect(balance.json().balanceCents).toBe(1_000);
  });

  it('returns 409 when an Idempotency-Key is reused with a different payload', async () => {
    const accountId = await createAccount();

    await app.inject({
      method: 'POST',
      url: `/accounts/${accountId}/deposits`,
      headers: { 'idempotency-key': 'client-retry-2' },
      payload: { amountCents: 1_000 },
    });
    const conflict = await app.inject({
      method: 'POST',
      url: `/accounts/${accountId}/deposits`,
      headers: { 'idempotency-key': 'client-retry-2' },
      payload: { amountCents: 9_999 },
    });

    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().title).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('serves a paginated statement', async () => {
    const accountId = await createAccount();
    for (const amountCents of [100, 200, 300]) {
      await app.inject({
        method: 'POST',
        url: `/accounts/${accountId}/deposits`,
        payload: { amountCents },
      });
    }

    const firstPage = await app.inject({
      method: 'GET',
      url: `/accounts/${accountId}/statement?limit=2`,
    });
    expect(firstPage.statusCode).toBe(200);
    const firstBody = firstPage.json();
    expect(firstBody.entries).toHaveLength(2);
    expect(firstBody.entries[0].amountCents).toBe(300);
    expect(firstBody.nextCursor).toBeTruthy();

    const secondPage = await app.inject({
      method: 'GET',
      url: `/accounts/${accountId}/statement?limit=2&cursor=${encodeURIComponent(firstBody.nextCursor)}`,
    });
    const secondBody = secondPage.json();
    expect(secondBody.entries).toHaveLength(1);
    expect(secondBody.entries[0].amountCents).toBe(100);
    expect(secondBody.nextCursor).toBeNull();
  });

  it('rejects a malformed cursor with 400', async () => {
    const accountId = await createAccount();
    const response = await app.inject({
      method: 'GET',
      url: `/accounts/${accountId}/statement?cursor=not-a-cursor`,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().title).toBe('INVALID_CURSOR');
  });
});
