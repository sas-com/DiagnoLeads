/**
 * REST API v2 lead routes — the real handlers are called; DB and auth are mocked.
 */
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const LEAD_ID = '22222222-2222-4222-8222-222222222222';

const chain = {
  set: vi.fn(),
  values: vi.fn(),
  where: vi.fn(),
  returning: vi.fn(),
};
const db = {
  query: { leads: { findFirst: vi.fn() } },
  update: vi.fn(() => chain),
  insert: vi.fn(() => chain),
  delete: vi.fn(() => chain),
};
chain.set.mockReturnValue(chain);
chain.values.mockReturnValue(chain);
chain.where.mockReturnValue(chain);

const getAuthenticatedOrganization = vi.fn();

const { emitLeadEvents } = vi.hoisted(() => ({ emitLeadEvents: vi.fn() }));

vi.mock('@/lib/db', () => ({ db }));
vi.mock('@/lib/api/v2-auth', () => ({ getAuthenticatedOrganization }));
// Sending to the organization's webhook endpoints is outside these routes; which events a change
// makes (leadChangeEvents) stays real
vi.mock('@/lib/features/webhooks/services/lead-events', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/features/webhooks/services/lead-events')>()),
  emitLeadEvents,
}));

const { GET, PATCH, DELETE } = await import('@/app/api/v2/leads/[id]/route');

const toQuery = (condition: unknown) => new PgDialect().sqlToQuery(condition as SQL);
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const LEAD_IN_ORG = '("leads"."id" = $1 and "leads"."organization_id" = $2)';

const patch = (body: unknown) =>
  PATCH(
    new NextRequest(`http://localhost/api/v2/leads/${LEAD_ID}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }),
    { params: Promise.resolve({ id: LEAD_ID }) }
  );

describe('PATCH /api/v2/leads/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthenticatedOrganization.mockResolvedValue({ organizationId: ORG_ID, userId: 'user-1' });
    chain.set.mockReturnValue(chain);
    chain.where.mockReturnValue(chain);
    db.query.leads.findFirst.mockResolvedValue({
      id: LEAD_ID,
      organizationId: ORG_ID,
      hasNegotiated: false,
    });
    chain.returning.mockResolvedValue([{ id: LEAD_ID }]);
  });

  it('maps a legacy status from external integrations to the new pipeline', async () => {
    const response = await patch({ status: 'qualified' });
    expect(response.status).toBe(200);
    expect(chain.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'negotiating', hasNegotiated: true })
    );
  });

  it('never writes the negotiated flag as false', async () => {
    await patch({ status: 'contacted' });
    const setArg = chain.set.mock.calls[0][0];
    expect(setArg.status).toBe('nurturing');
    expect(setArg).not.toHaveProperty('hasNegotiated');
  });

  it('rejects unknown statuses', async () => {
    const response = await patch({ status: 'closing' });
    expect(response.status).toBe(400);
    expect(chain.set).not.toHaveBeenCalled();
  });

  it('drops the reason on hold when a lead on hold is lost (#445)', async () => {
    db.query.leads.findFirst.mockResolvedValue({
      id: LEAD_ID,
      organizationId: ORG_ID,
      status: 'nurturing',
      lostReason: 'on_hold',
      hasNegotiated: false,
    });
    const response = await patch({ status: 'lost' });
    expect(response.status).toBe(200);
    expect(chain.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'lost', lostReason: null })
    );
  });
});

describe('PATCH /api/v2/leads/[id] guards', () => {
  const patchId = (id: string, body: unknown) =>
    PATCH(
      new NextRequest(`http://localhost/api/v2/leads/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json' },
      }),
      params(id)
    );

  beforeEach(() => {
    vi.clearAllMocks();
    getAuthenticatedOrganization.mockResolvedValue({ organizationId: ORG_ID, userId: 'user-1' });
    chain.set.mockReturnValue(chain);
    chain.where.mockReturnValue(chain);
  });

  it('answers 401 without an authenticated organization and writes nothing', async () => {
    getAuthenticatedOrganization.mockResolvedValue(null);

    expect((await patchId(LEAD_ID, { name: 'A' })).status).toBe(401);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('answers 400 for an id that is not a uuid', async () => {
    expect((await patchId('not-a-uuid', { name: 'A' })).status).toBe(400);
    expect(db.query.leads.findFirst).not.toHaveBeenCalled();
  });

  it("answers 404 for another organization's lead and writes nothing", async () => {
    db.query.leads.findFirst.mockResolvedValue(undefined);

    const res = await patchId(LEAD_ID, { name: 'A' });

    expect(res.status).toBe(404);
    const where = toQuery(db.query.leads.findFirst.mock.calls[0][0].where);
    expect(where.sql).toBe(LEAD_IN_ORG);
    expect(where.params).toEqual([LEAD_ID, ORG_ID]);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('writes the given fields within the organization only and sends the change events', async () => {
    const before = { id: LEAD_ID, organizationId: ORG_ID, name: 'Old', score: 10, status: 'new' };
    const after = { ...before, name: 'New', score: 60 };
    db.query.leads.findFirst.mockResolvedValue(before);
    chain.returning.mockResolvedValue([after]);

    const res = await patchId(LEAD_ID, { name: 'New', score: 60, phone: null });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: after, message: 'Lead updated successfully' });
    expect(chain.set).toHaveBeenCalledWith({
      name: 'New',
      score: 60,
      phone: null,
      updatedAt: expect.any(Date),
    });
    const where = toQuery(chain.where.mock.calls[0][0]);
    expect(where.sql).toBe(LEAD_IN_ORG);
    expect(where.params).toEqual([LEAD_ID, ORG_ID]);
    expect(emitLeadEvents).toHaveBeenCalledWith(ORG_ID, [
      { type: 'lead.updated', lead: after },
      { type: 'lead.scored', lead: after, previousScore: 10 },
    ]);
  });

  it('rejects an invalid email with 400 and writes nothing', async () => {
    db.query.leads.findFirst.mockResolvedValue({ id: LEAD_ID, organizationId: ORG_ID });

    const res = await patchId(LEAD_ID, { email: 'not-an-email' });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Validation Error');
    expect(db.update).not.toHaveBeenCalled();
  });

  it('answers 500 without details when the update fails', async () => {
    db.query.leads.findFirst.mockResolvedValue({ id: LEAD_ID, organizationId: ORG_ID });
    chain.returning.mockRejectedValue(new Error('db down'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await patchId(LEAD_ID, { name: 'A' });

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: 'Internal Server Error',
      message: 'Failed to update lead',
    });
    expect(emitLeadEvents).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe('GET /api/v2/leads/[id]', () => {
  const get = (id = LEAD_ID) =>
    GET(new NextRequest(`http://localhost/api/v2/leads/${id}`), params(id));

  beforeEach(() => {
    vi.clearAllMocks();
    getAuthenticatedOrganization.mockResolvedValue({ organizationId: ORG_ID, userId: 'user-1' });
  });

  it('answers 401 without an authenticated organization', async () => {
    getAuthenticatedOrganization.mockResolvedValue(null);

    expect((await get()).status).toBe(401);
    expect(db.query.leads.findFirst).not.toHaveBeenCalled();
  });

  it('answers 400 for an id that is not a uuid', async () => {
    const res = await get('1 or 1=1');

    expect(res.status).toBe(400);
    expect((await res.json()).message).toBe('Invalid lead ID format');
    expect(db.query.leads.findFirst).not.toHaveBeenCalled();
  });

  it("answers 404 for another organization's lead, looked up within the organization only", async () => {
    db.query.leads.findFirst.mockResolvedValue(undefined);

    const res = await get();

    expect(res.status).toBe(404);
    const where = toQuery(db.query.leads.findFirst.mock.calls[0][0].where);
    expect(where.sql).toBe(LEAD_IN_ORG);
    expect(where.params).toEqual([LEAD_ID, ORG_ID]);
  });

  // Which lead columns this returns (all of them, unlike the list) is left to #667
  it('returns the lead with its tags and latest comments, showing only the commenter name and email', async () => {
    const lead = { id: LEAD_ID, leadTags: [], comments: [] };
    db.query.leads.findFirst.mockResolvedValue(lead);

    const res = await get();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: lead });
    const { with: relations } = db.query.leads.findFirst.mock.calls[0][0];
    expect(relations.leadTags).toEqual({ with: { tag: true } });
    expect(relations.comments.limit).toBe(10);
    expect(relations.comments.with.user.columns).toEqual({ id: true, name: true, email: true });
  });

  it('answers 500 without details when the database fails', async () => {
    db.query.leads.findFirst.mockRejectedValue(new Error('db down'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await get();

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: 'Internal Server Error',
      message: 'Failed to fetch lead',
    });
    errorSpy.mockRestore();
  });
});

describe('DELETE /api/v2/leads/[id]', () => {
  const remove = (id = LEAD_ID) =>
    DELETE(
      new NextRequest(`http://localhost/api/v2/leads/${id}`, { method: 'DELETE' }),
      params(id)
    );

  beforeEach(() => {
    vi.clearAllMocks();
    getAuthenticatedOrganization.mockResolvedValue({ organizationId: ORG_ID, userId: 'user-1' });
    chain.where.mockReturnValue(chain);
    db.query.leads.findFirst.mockResolvedValue({ id: LEAD_ID, organizationId: ORG_ID });
    chain.returning.mockResolvedValue([{ id: LEAD_ID }]);
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

  it("answers 404 for another organization's lead, looked up within the organization only, and deletes nothing", async () => {
    db.query.leads.findFirst.mockResolvedValue(undefined);

    expect((await remove()).status).toBe(404);
    const where = toQuery(db.query.leads.findFirst.mock.calls[0][0].where);
    expect(where.sql).toBe(LEAD_IN_ORG);
    expect(where.params).toEqual([LEAD_ID, ORG_ID]);
    expect(db.delete).not.toHaveBeenCalled();
    expect(emitLeadEvents).not.toHaveBeenCalled();
  });

  it('deletes the lead within the organization only and sends lead.deleted', async () => {
    const res = await remove();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: 'Lead deleted successfully' });
    const where = toQuery(chain.where.mock.calls[0][0]);
    expect(where.sql).toBe(LEAD_IN_ORG);
    expect(where.params).toEqual([LEAD_ID, ORG_ID]);
    expect(emitLeadEvents).toHaveBeenCalledWith(ORG_ID, [
      { type: 'lead.deleted', leadId: LEAD_ID, deletedAt: expect.any(Date) },
    ]);
  });

  it('sends no event when a concurrent request deleted the lead first', async () => {
    chain.returning.mockResolvedValue([]);

    expect((await remove()).status).toBe(200);
    expect(emitLeadEvents).not.toHaveBeenCalled();
  });

  it('answers 500 without details when the delete fails', async () => {
    chain.returning.mockRejectedValue(new Error('db down'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await remove();

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: 'Internal Server Error',
      message: 'Failed to delete lead',
    });
    errorSpy.mockRestore();
  });
});
