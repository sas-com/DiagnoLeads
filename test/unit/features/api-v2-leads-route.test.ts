/**
 * REST API v2 lead routes — the real handlers are called; DB and auth are mocked.
 */
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
};
chain.set.mockReturnValue(chain);
chain.values.mockReturnValue(chain);
chain.where.mockReturnValue(chain);

const getAuthenticatedOrganization = vi.fn();

vi.mock('@/lib/db', () => ({ db }));
vi.mock('@/lib/api/v2-auth', () => ({ getAuthenticatedOrganization }));

const { PATCH } = await import('@/app/api/v2/leads/[id]/route');

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
    db.query.leads.findFirst.mockResolvedValue({ id: LEAD_ID, organizationId: ORG_ID, hasNegotiated: false });
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

  it('refuses to move a lead on hold to lost (#445)', async () => {
    db.query.leads.findFirst.mockResolvedValue({
      id: LEAD_ID,
      organizationId: ORG_ID,
      status: 'nurturing',
      lostReason: 'on_hold',
      hasNegotiated: false,
    });
    const response = await patch({ status: 'lost' });
    expect(response.status).toBe(400);
    expect(chain.set).not.toHaveBeenCalled();
  });
});
