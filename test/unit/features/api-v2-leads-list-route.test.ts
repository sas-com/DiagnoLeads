/**
 * REST API v2 lead list and creation (GET / POST /api/v2/leads): the real handlers are called
 * with the real schemas and drizzle conditions; the authentication, the database and the
 * webhook sending are mocked. Authentication itself is covered by api-v2-auth.test.ts.
 */
import { leads } from '@/lib/db/schema';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG_ID = '99999999-9999-4999-8999-999999999999';
const LEAD_ID = '22222222-2222-4222-8222-222222222222';

const { db, countChain, insertChain, getAuthenticatedOrganization, emitLeadEvents } = vi.hoisted(
  () => {
    const countChain = { from: vi.fn(), where: vi.fn() };
    const insertChain = { values: vi.fn(), returning: vi.fn() };
    const db = {
      query: { leads: { findMany: vi.fn(), findFirst: vi.fn() } },
      select: vi.fn(() => countChain),
      insert: vi.fn(() => insertChain),
    };
    return {
      db,
      countChain,
      insertChain,
      getAuthenticatedOrganization: vi.fn(),
      emitLeadEvents: vi.fn(),
    };
  }
);

vi.mock('@/lib/db', () => ({ db }));
vi.mock('@/lib/api/v2-auth', () => ({ getAuthenticatedOrganization }));
// Sending to the organization's webhook endpoints is outside this route
vi.mock('@/lib/features/webhooks/services/lead-events', () => ({ emitLeadEvents }));

const { GET, POST } = await import('@/app/api/v2/leads/route');

const toQuery = (condition: unknown) => new PgDialect().sqlToQuery(condition as SQL);
const list = (query = '') => GET(new NextRequest(`http://localhost/api/v2/leads${query}`));
const create = (body: unknown) =>
  POST(
    new NextRequest('http://localhost/api/v2/leads', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    })
  );

beforeEach(() => {
  vi.clearAllMocks();
  getAuthenticatedOrganization.mockResolvedValue({ organizationId: ORG_ID, userId: 'user-1' });
  countChain.from.mockReturnValue(countChain);
  countChain.where.mockResolvedValue([{ count: 0 }]);
  db.query.leads.findMany.mockResolvedValue([]);
  db.query.leads.findFirst.mockResolvedValue(undefined);
  insertChain.values.mockReturnValue(insertChain);
});

describe('GET /api/v2/leads', () => {
  it('lists the first 20 leads of the organization, newest first', async () => {
    countChain.where.mockResolvedValue([{ count: 1 }]);
    db.query.leads.findMany.mockResolvedValue([{ id: LEAD_ID, email: 'a@example.com' }]);

    const res = await list();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: [{ id: LEAD_ID, email: 'a@example.com' }],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1, hasMore: false },
    });
    const query = db.query.leads.findMany.mock.calls[0][0];
    expect(toQuery(query.where)).toMatchObject({
      sql: '"leads"."organization_id" = $1',
      params: [ORG_ID],
    });
    expect(toQuery(countChain.where.mock.calls[0][0]).params).toEqual([ORG_ID]);
    expect(toQuery(query.orderBy[0]).sql).toBe('"leads"."created_at" desc');
    expect(query).toMatchObject({ limit: 20, offset: 0 });
  });

  it('never reads the columns that stay inside DiagnoLeads', async () => {
    await list();

    const { columns } = db.query.leads.findMany.mock.calls[0][0];
    for (const hidden of [
      'embedding',
      'searchVector',
      'assigneeUserId',
      'acquisitionCost',
      'agencyName',
    ]) {
      expect(columns).not.toHaveProperty(hidden);
    }
  });

  it('applies every filter on top of the organization, accepting a legacy status', async () => {
    await list(
      '?status=qualified&source=api&minScore=40&maxScore=90&search=acme' +
        '&startDate=2026-10-01T00:00:00Z&endDate=2026-10-24T00:00:00Z'
    );

    const where = toQuery(db.query.leads.findMany.mock.calls[0][0].where);
    expect(where.sql).toBe(
      '("leads"."organization_id" = $1 and "leads"."status" = $2 and "leads"."source" = $3' +
        ' and "leads"."score" >= $4 and "leads"."score" <= $5' +
        ' and ("leads"."email" ilike $6 or "leads"."name" ilike $7 or "leads"."company" ilike $8)' +
        ' and "leads"."created_at" >= $9 and "leads"."created_at" <= $10)'
    );
    expect(where.params).toEqual([
      ORG_ID,
      'negotiating',
      'api',
      40,
      90,
      '%acme%',
      '%acme%',
      '%acme%',
      '2026-10-01T00:00:00.000Z',
      '2026-10-24T00:00:00.000Z',
    ]);
    // The count matches the page it describes
    expect(toQuery(countChain.where.mock.calls[0][0])).toEqual(where);
  });

  it('pages and sorts as asked', async () => {
    countChain.where.mockResolvedValue([{ count: 25 }]);

    const res = await list('?page=2&limit=10&sortBy=score&sortOrder=asc');

    const query = db.query.leads.findMany.mock.calls[0][0];
    expect(query).toMatchObject({ limit: 10, offset: 10 });
    expect(query.orderBy[0]).toBe(leads.score);
    expect((await res.json()).pagination).toEqual({
      page: 2,
      limit: 10,
      total: 25,
      totalPages: 3,
      hasMore: true,
    });
  });

  it.each([
    ['more than 100 a page', '?limit=101'],
    ['page 0', '?page=0'],
    ['an unknown status', '?status=closing'],
    ['a score over 100', '?minScore=101'],
    ['a column that cannot be sorted on', '?sortBy=password'],
    ['a date that is not an ISO date-time', '?startDate=yesterday'],
  ])('rejects %s with 400 and reads nothing', async (_label, query) => {
    const res = await list(query);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Validation Error');
    expect(db.query.leads.findMany).not.toHaveBeenCalled();
  });

  it('answers 401 without an authenticated organization', async () => {
    getAuthenticatedOrganization.mockResolvedValue(null);

    expect((await list()).status).toBe(401);
    expect(db.select).not.toHaveBeenCalled();
  });

  it('answers 500 without details when the database fails', async () => {
    countChain.where.mockRejectedValue(new Error('db down'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await list();

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: 'Internal Server Error',
      message: 'Failed to fetch leads',
    });
    errorSpy.mockRestore();
  });
});

describe('POST /api/v2/leads', () => {
  const CREATED = { id: LEAD_ID, organizationId: ORG_ID, email: 'new@example.com', status: 'new' };

  beforeEach(() => {
    insertChain.returning.mockResolvedValue([CREATED]);
  });

  it('creates the lead in the authenticated organization, whatever the body names', async () => {
    const res = await create({ email: 'new@example.com', organizationId: OTHER_ORG_ID });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ data: CREATED, message: 'Lead created successfully' });
    expect(insertChain.values).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      email: 'new@example.com',
      name: undefined,
      company: undefined,
      phone: undefined,
      source: 'api',
      status: 'new',
      score: undefined,
      responses: {},
      customFields: {},
    });
  });

  it('sends lead.created to the organization webhooks', async () => {
    await create({ email: 'new@example.com' });

    expect(emitLeadEvents).toHaveBeenCalledWith(ORG_ID, [{ type: 'lead.created', lead: CREATED }]);
  });

  it('maps a legacy status to the pipeline and marks a negotiation', async () => {
    await create({ email: 'new@example.com', status: 'qualified', score: 80 });

    expect(insertChain.values).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'negotiating', hasNegotiated: true, score: 80 })
    );
  });

  it('answers 409 with the existing id for an email already in the organization', async () => {
    db.query.leads.findFirst.mockResolvedValue({ id: LEAD_ID });

    const res = await create({ email: 'dup@example.com' });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'Conflict',
      message: 'Lead with this email already exists',
      existingId: LEAD_ID,
    });
    const where = toQuery(db.query.leads.findFirst.mock.calls[0][0].where);
    expect(where.sql).toBe('("leads"."organization_id" = $1 and "leads"."email" = $2)');
    expect(where.params).toEqual([ORG_ID, 'dup@example.com']);
    expect(db.insert).not.toHaveBeenCalled();
    expect(emitLeadEvents).not.toHaveBeenCalled();
  });

  it('sends no event when nothing was inserted', async () => {
    insertChain.returning.mockResolvedValue([]);

    expect((await create({ email: 'new@example.com' })).status).toBe(201);
    expect(emitLeadEvents).not.toHaveBeenCalled();
  });

  it.each([
    ['no email', { name: 'No Mail' }],
    ['an invalid email', { email: 'not-an-email' }],
    ['a score over 100', { email: 'new@example.com', score: 101 }],
    ['an unknown status', { email: 'new@example.com', status: 'closing' }],
  ])('rejects %s with 400 and writes nothing', async (_label, body) => {
    const res = await create(body);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Validation Error');
    expect(db.query.leads.findFirst).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('answers 401 without an authenticated organization and writes nothing', async () => {
    getAuthenticatedOrganization.mockResolvedValue(null);

    expect((await create({ email: 'new@example.com' })).status).toBe(401);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('answers 500 without details when the insert fails', async () => {
    insertChain.returning.mockRejectedValue(new Error('db down'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await create({ email: 'new@example.com' });

    expect(res.status).toBe(500);
    expect((await res.json()).message).toBe('Failed to create lead');
    expect(emitLeadEvents).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
