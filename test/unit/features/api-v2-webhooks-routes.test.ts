/**
 * REST API v2 webhook routes (/api/v2/webhooks and /api/v2/webhooks/[id]): the real handlers are
 * called with the real schemas and drizzle conditions; the authentication and the database are
 * mocked. Every read and write is checked to be limited to the authenticated organization.
 */
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG_ID = '99999999-9999-4999-8999-999999999999';
const WEBHOOK_ID = '55555555-5555-4555-8555-555555555555';

const { db, chain, getAuthenticatedOrganization } = vi.hoisted(() => {
  const chain = {
    values: vi.fn(),
    set: vi.fn(),
    where: vi.fn(),
    returning: vi.fn(),
  };
  const db = {
    query: {
      webhooks: { findMany: vi.fn(), findFirst: vi.fn() },
      webhookDeliveries: { findMany: vi.fn() },
    },
    insert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    delete: vi.fn(() => chain),
  };
  return { db, chain, getAuthenticatedOrganization: vi.fn() };
});

vi.mock('@/lib/db', () => ({ db }));
vi.mock('@/lib/api/v2-auth', () => ({ getAuthenticatedOrganization }));

const listRoute = await import('@/app/api/v2/webhooks/route');
const itemRoute = await import('@/app/api/v2/webhooks/[id]/route');

const toQuery = (condition: unknown) => new PgDialect().sqlToQuery(condition as SQL);

const jsonRequest = (method: string, path: string, body?: unknown) =>
  new NextRequest(`http://localhost${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
  });

const params = (id: string) => ({ params: Promise.resolve({ id }) });

const STORED = {
  id: WEBHOOK_ID,
  organizationId: ORG_ID,
  name: 'CRM sync',
  url: 'https://crm.example/hooks',
  events: ['lead.created'],
  status: 'active',
  retryConfig: { maxRetries: 5, retryDelayMs: 2000 },
};

beforeEach(() => {
  vi.clearAllMocks();
  getAuthenticatedOrganization.mockResolvedValue({ organizationId: ORG_ID, userId: 'user-1' });
  chain.values.mockReturnValue(chain);
  chain.set.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  db.query.webhooks.findMany.mockResolvedValue([]);
  db.query.webhooks.findFirst.mockResolvedValue(STORED);
  db.query.webhookDeliveries.findMany.mockResolvedValue([]);
});

describe('GET /api/v2/webhooks', () => {
  const list = () => listRoute.GET(jsonRequest('GET', '/api/v2/webhooks'));

  it('answers 401 without an authenticated organization and reads nothing', async () => {
    getAuthenticatedOrganization.mockResolvedValue(null);

    const res = await list();

    expect(res.status).toBe(401);
    expect(db.query.webhooks.findMany).not.toHaveBeenCalled();
  });

  it("lists only the organization's webhooks and never reads their secrets", async () => {
    db.query.webhooks.findMany.mockResolvedValue([{ id: WEBHOOK_ID, name: 'CRM sync' }]);

    const res = await list();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: [{ id: WEBHOOK_ID, name: 'CRM sync', hasSecret: true }],
    });
    const query = db.query.webhooks.findMany.mock.calls[0][0];
    const where = toQuery(query.where);
    expect(where.sql).toBe('"webhooks"."organization_id" = $1');
    expect(where.params).toEqual([ORG_ID]);
    expect(query.columns).not.toHaveProperty('secret');
  });

  it('answers 500 without details when the database fails', async () => {
    db.query.webhooks.findMany.mockRejectedValue(new Error('db down'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await list();

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: 'Internal Server Error',
      message: 'Failed to fetch webhooks',
    });
    errorSpy.mockRestore();
  });
});

describe('POST /api/v2/webhooks', () => {
  const create = (body: unknown) => listRoute.POST(jsonRequest('POST', '/api/v2/webhooks', body));
  const VALID = { name: 'CRM sync', url: 'https://crm.example/hooks', events: ['lead.created'] };

  beforeEach(() => {
    chain.returning.mockImplementation(async () => [
      { id: WEBHOOK_ID, ...chain.values.mock.calls[0][0] },
    ]);
  });

  it('answers 401 without an authenticated organization and writes nothing', async () => {
    getAuthenticatedOrganization.mockResolvedValue(null);

    const res = await create(VALID);

    expect(res.status).toBe(401);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('creates the webhook in the authenticated organization, whatever the body names', async () => {
    const res = await create({ ...VALID, organizationId: OTHER_ORG_ID });

    expect(res.status).toBe(201);
    const values = chain.values.mock.calls[0][0];
    expect(values.organizationId).toBe(ORG_ID);
    expect(values).toMatchObject({
      name: 'CRM sync',
      url: 'https://crm.example/hooks',
      events: ['lead.created'],
      status: 'active',
      headers: {},
      retryConfig: { maxRetries: 3, retryDelayMs: 5000 },
    });
  });

  it('generates a 64 hex character secret when none is given and returns it once', async () => {
    const res = await create(VALID);

    const json = await res.json();
    expect(json.message).toBe('Webhook created successfully');
    expect(json.data.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(chain.values.mock.calls[0][0].secret).toBe(json.data.secret);
  });

  it('keeps a secret given by the caller', async () => {
    const res = await create({ ...VALID, secret: 'a-caller-secret-123' });

    expect((await res.json()).data.secret).toBe('a-caller-secret-123');
  });

  it.each([
    ['no events', { ...VALID, events: [] }],
    ['an unknown event', { ...VALID, events: ['lead.exploded'] }],
    ['a url that is not a url', { ...VALID, url: 'crm.example/hooks' }],
    ['an empty name', { ...VALID, name: '' }],
    ['a secret shorter than 16 characters', { ...VALID, secret: 'short' }],
    ['more than 10 retries', { ...VALID, maxRetries: 11 }],
    ['a retry delay under a second', { ...VALID, retryDelayMs: 999 }],
  ])('rejects %s with 400 and writes nothing', async (_label, body) => {
    const res = await create(body);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Validation Error');
    expect(json.details).toBeDefined();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('answers 500 without details when the insert fails', async () => {
    chain.returning.mockRejectedValue(new Error('db down'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await create(VALID);

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: 'Internal Server Error',
      message: 'Failed to create webhook',
    });
    errorSpy.mockRestore();
  });
});

describe('GET /api/v2/webhooks/[id]', () => {
  const get = (id = WEBHOOK_ID) =>
    itemRoute.GET(jsonRequest('GET', `/api/v2/webhooks/${id}`), params(id));

  it('answers 401 without an authenticated organization', async () => {
    getAuthenticatedOrganization.mockResolvedValue(null);

    expect((await get()).status).toBe(401);
    expect(db.query.webhooks.findFirst).not.toHaveBeenCalled();
  });

  it('answers 400 for an id that is not a uuid', async () => {
    const res = await get('1 or 1=1');

    expect(res.status).toBe(400);
    expect((await res.json()).message).toBe('Invalid webhook ID format');
    expect(db.query.webhooks.findFirst).not.toHaveBeenCalled();
  });

  it("answers 404 for another organization's webhook, looked up within the organization only", async () => {
    db.query.webhooks.findFirst.mockResolvedValue(undefined);

    const res = await get();

    expect(res.status).toBe(404);
    const where = toQuery(db.query.webhooks.findFirst.mock.calls[0][0].where);
    expect(where.sql).toBe('("webhooks"."id" = $1 and "webhooks"."organization_id" = $2)');
    expect(where.params).toEqual([WEBHOOK_ID, ORG_ID]);
    expect(db.query.webhookDeliveries.findMany).not.toHaveBeenCalled();
  });

  it('returns the webhook without its secret, with its last 20 deliveries', async () => {
    const deliveries = [{ id: 'd-1', eventType: 'lead.created', status: 'success' }];
    db.query.webhookDeliveries.findMany.mockResolvedValue(deliveries);

    const res = await get();

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ ...STORED, recentDeliveries: deliveries });
    expect(db.query.webhooks.findFirst.mock.calls[0][0].columns).not.toHaveProperty('secret');
    const deliveryQuery = db.query.webhookDeliveries.findMany.mock.calls[0][0];
    expect(deliveryQuery.limit).toBe(20);
    expect(toQuery(deliveryQuery.where).params).toEqual([WEBHOOK_ID]);
  });

  it('answers 500 when the database fails', async () => {
    db.query.webhooks.findFirst.mockRejectedValue(new Error('db down'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await get();

    expect(res.status).toBe(500);
    expect((await res.json()).message).toBe('Failed to fetch webhook');
    errorSpy.mockRestore();
  });
});

describe('PATCH /api/v2/webhooks/[id]', () => {
  const patch = (body: unknown, id = WEBHOOK_ID) =>
    itemRoute.PATCH(jsonRequest('PATCH', `/api/v2/webhooks/${id}`, body), params(id));

  beforeEach(() => {
    chain.returning.mockResolvedValue([{ id: WEBHOOK_ID, name: 'Renamed' }]);
  });

  it('answers 401 without an authenticated organization and writes nothing', async () => {
    getAuthenticatedOrganization.mockResolvedValue(null);

    expect((await patch({ name: 'Renamed' })).status).toBe(401);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('answers 400 for an id that is not a uuid', async () => {
    expect((await patch({ name: 'Renamed' }, 'not-a-uuid')).status).toBe(400);
    expect(db.update).not.toHaveBeenCalled();
  });

  it("answers 404 for another organization's webhook and writes nothing", async () => {
    db.query.webhooks.findFirst.mockResolvedValue(undefined);

    const res = await patch({ name: 'Renamed' });

    expect(res.status).toBe(404);
    expect(toQuery(db.query.webhooks.findFirst.mock.calls[0][0].where).params).toEqual([
      WEBHOOK_ID,
      ORG_ID,
    ]);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('writes only the given fields, scoped to the id and the organization', async () => {
    const res = await patch({ name: 'Renamed', status: 'inactive' });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: { id: WEBHOOK_ID, name: 'Renamed' },
      message: 'Webhook updated successfully',
    });
    const set = chain.set.mock.calls[0][0];
    expect(set).toEqual({ name: 'Renamed', status: 'inactive', updatedAt: expect.any(Date) });
    const where = toQuery(chain.where.mock.calls[0][0]);
    expect(where.sql).toBe('("webhooks"."id" = $1 and "webhooks"."organization_id" = $2)');
    expect(where.params).toEqual([WEBHOOK_ID, ORG_ID]);
  });

  it('keeps the stored retry setting that is not given', async () => {
    await patch({ maxRetries: 8 });

    expect(chain.set.mock.calls[0][0].retryConfig).toEqual({ maxRetries: 8, retryDelayMs: 2000 });
  });

  it('falls back to the default retry setting when none is stored', async () => {
    db.query.webhooks.findFirst.mockResolvedValue({ ...STORED, retryConfig: null });

    await patch({ retryDelayMs: 10000 });

    expect(chain.set.mock.calls[0][0].retryConfig).toEqual({ maxRetries: 3, retryDelayMs: 10000 });
  });

  it('writes every field it accepts', async () => {
    await patch({
      url: 'https://crm.example/v2',
      events: ['lead.updated', 'lead.deleted'],
      secret: 'a-new-secret-1234567',
      headers: { 'x-team': 'sales' },
    });

    expect(chain.set.mock.calls[0][0]).toMatchObject({
      url: 'https://crm.example/v2',
      events: ['lead.updated', 'lead.deleted'],
      secret: 'a-new-secret-1234567',
      headers: { 'x-team': 'sales' },
    });
  });

  it.each([
    ['an empty event list', { events: [] }],
    ['an unknown status', { status: 'paused' }],
    ['a header value that is not a string', { headers: { 'x-team': 1 } }],
  ])('rejects %s with 400 and writes nothing', async (_label, body) => {
    const res = await patch(body);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Validation Error');
    expect(db.update).not.toHaveBeenCalled();
  });

  it('answers 500 when the update fails', async () => {
    chain.returning.mockRejectedValue(new Error('db down'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await patch({ name: 'Renamed' });

    expect(res.status).toBe(500);
    expect((await res.json()).message).toBe('Failed to update webhook');
    errorSpy.mockRestore();
  });
});

describe('DELETE /api/v2/webhooks/[id]', () => {
  const remove = (id = WEBHOOK_ID) =>
    itemRoute.DELETE(jsonRequest('DELETE', `/api/v2/webhooks/${id}`), params(id));

  beforeEach(() => {
    chain.where.mockResolvedValue(undefined);
  });

  it('answers 401 without an authenticated organization and deletes nothing', async () => {
    getAuthenticatedOrganization.mockResolvedValue(null);

    expect((await remove()).status).toBe(401);
    expect(db.delete).not.toHaveBeenCalled();
  });

  it('answers 400 for an id that is not a uuid', async () => {
    expect((await remove('../all')).status).toBe(400);
    expect(db.delete).not.toHaveBeenCalled();
  });

  it("answers 404 for another organization's webhook and deletes nothing", async () => {
    db.query.webhooks.findFirst.mockResolvedValue(undefined);

    expect((await remove()).status).toBe(404);
    expect(db.delete).not.toHaveBeenCalled();
  });

  it('deletes the webhook within the organization only', async () => {
    const res = await remove();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: 'Webhook deleted successfully' });
    const where = toQuery(chain.where.mock.calls[0][0]);
    expect(where.sql).toBe('("webhooks"."id" = $1 and "webhooks"."organization_id" = $2)');
    expect(where.params).toEqual([WEBHOOK_ID, ORG_ID]);
  });

  it('answers 500 when the delete fails', async () => {
    chain.where.mockRejectedValue(new Error('db down'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await remove();

    expect(res.status).toBe(500);
    expect((await res.json()).message).toBe('Failed to delete webhook');
    errorSpy.mockRestore();
  });
});
