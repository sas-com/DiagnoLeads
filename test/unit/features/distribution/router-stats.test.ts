/**
 * distribution.getCampaignStats (#41): the total is the campaign's scan_count, which the /q/
 * entry counts with each qr_scans row; the breakdown comes from campaignScanStats, counted in the
 * database for the campaign of the organization. Runs the real router on a fake database; the
 * counting itself is checked against PostgreSQL in test/unit/integration/qr-scan-recording.db.test.ts.
 */
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

const USER_ID = '550e8400-e29b-41d4-a716-446655440000';
const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const CAMPAIGN_ID = '770e8400-e29b-41d4-a716-446655440001';

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  campaignScanStats: vi.fn(),
}));
// The distribution router reads the campaign with the global client
vi.mock('@/lib/db', () => ({
  db: { query: { qrCampaigns: { findFirst: mocks.findFirst } } },
}));
vi.mock('@/lib/features/distribution/scans', () => ({
  campaignScanStats: mocks.campaignScanStats,
}));

const { appRouter } = await import('@/server/routers/_app');

const membership = {
  id: '880e8400-e29b-41d4-a716-446655440000',
  organizationId: ORG_ID,
  userId: USER_ID,
  role: 'admin',
  organization: { id: ORG_ID, name: 'Org', slug: 'org', settings: {} },
};
const ctxDb = {
  query: { organizationMembers: { findFirst: vi.fn(async () => membership) } },
};

function caller() {
  const user = { id: USER_ID, email: 'admin@example.com', name: 'Admin' };
  // biome-ignore lint/suspicious/noExplicitAny: test context
  return appRouter.createCaller({ db: ctxDb, session: { session: { id: 's', userId: USER_ID }, user }, user } as any);
}

const STATS = {
  deviceBreakdown: { mobile: 2, desktop: 1 },
  conversionRate: 0,
  recentScans: [
    { id: 's1', deviceType: 'mobile', scannedOn: '2026-10-29', converted: false },
  ],
};

describe('distribution.getCampaignStats (#41)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.campaignScanStats.mockResolvedValue(STATS);
  });

  it("answers the campaign's scan count with the breakdown of its recorded scans", async () => {
    mocks.findFirst.mockResolvedValue({
      id: CAMPAIGN_ID,
      organizationId: ORG_ID,
      scanCount: 3,
      completionCount: 0,
    });
    const stats = await caller().distribution.getCampaignStats({
      organizationId: ORG_ID,
      campaignId: CAMPAIGN_ID,
    });
    expect(stats).toEqual({ totalScans: 3, totalConversions: 0, ...STATS });
    // Counted on the request's database, for the campaign of the organization
    expect(mocks.campaignScanStats).toHaveBeenCalledWith(ctxDb, {
      organizationId: ORG_ID,
      campaignId: CAMPAIGN_ID,
    });
  });

  it('answers NOT_FOUND without counting for a campaign the organization does not have', async () => {
    mocks.findFirst.mockResolvedValue(undefined);
    await expect(
      caller().distribution.getCampaignStats({ organizationId: ORG_ID, campaignId: CAMPAIGN_ID })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(mocks.campaignScanStats).not.toHaveBeenCalled();
    // The campaign is looked up within the organization: the id of another organization's
    // campaign finds nothing
    const { sql, params } = new PgDialect().sqlToQuery(mocks.findFirst.mock.calls[0][0].where as SQL);
    expect(sql).toBe('("qr_campaigns"."id" = $1 and "qr_campaigns"."organization_id" = $2)');
    expect(params).toEqual([CAMPAIGN_ID, ORG_ID]);
  });
});
