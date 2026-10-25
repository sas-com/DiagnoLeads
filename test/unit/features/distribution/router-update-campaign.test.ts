/**
 * updateCampaign writes only the fields it is sent (#610). The switch of the settings page sends
 * { isActive } alone; pausing and resuming used to write expires_at = null, and the /q/ entry
 * (#503) then forwarded an expired campaign again. expiresAt: null still clears the expiry.
 * Runs the real router on a fake database that keeps what the update was given.
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

const USER_ID = '550e8400-e29b-41d4-a716-446655440000';
const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const CAMPAIGN_ID = '770e8400-e29b-41d4-a716-446655440001';
const EXPIRES_AT = new Date('2026-11-30T15:00:00.000Z');

const STORED = {
  id: CAMPAIGN_ID,
  organizationId: ORG_ID,
  diagnosticTemplateId: '770e8400-e29b-41d4-a716-446655440002',
  diagnosisId: null,
  name: 'Fair 2026',
  description: 'Booth A',
  shortCode: 'AbCd2345',
  trackingUrl: 'http://localhost:3000/q/AbCd2345?utm_source=qrcode&utm_medium=offline',
  utmSource: 'qrcode',
  utmMedium: 'offline',
  utmCampaign: null,
  utmContent: null,
  scanCount: 0,
  completionCount: 0,
  isActive: true,
  expiresAt: EXPIRES_AT,
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-10-01T00:00:00Z'),
};

const { writes } = vi.hoisted(() => ({
  writes: { set: [] as Record<string, unknown>[], where: [] as unknown[] },
}));
// The distribution router uses the global client
vi.mock('@/lib/db', () => ({
  db: {
    query: { qrCampaigns: { findFirst: vi.fn(async () => STORED) } },
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => {
        writes.set.push(values);
        return {
          where: vi.fn((condition: unknown) => {
            writes.where.push(condition);
            return { returning: vi.fn(async () => [{ ...STORED, ...values }]) };
          }),
        };
      }),
    })),
  },
}));

const { appRouter } = await import('@/server/routers/_app');

function adminCaller() {
  const user = { id: USER_ID, email: 'admin@example.com', name: 'Admin' };
  const membership = {
    id: '880e8400-e29b-41d4-a716-446655440000',
    organizationId: ORG_ID,
    userId: USER_ID,
    role: 'admin',
    organization: { id: ORG_ID, name: 'Org', slug: 'org', settings: {} },
  };
  const ctx = {
    db: { query: { organizationMembers: { findFirst: vi.fn().mockResolvedValue(membership) } } },
    session: { session: { id: 's', userId: USER_ID }, user },
    user,
  };
  // biome-ignore lint/suspicious/noExplicitAny: test context
  return appRouter.createCaller(ctx as any);
}

const update = (data: Record<string, unknown>) =>
  adminCaller().distribution.updateCampaign({ organizationId: ORG_ID, id: CAMPAIGN_ID, data });

describe('updateCampaign writes only the fields it is sent (#610)', () => {
  beforeEach(() => {
    writes.set.length = 0;
    writes.where.length = 0;
    vi.clearAllMocks();
  });

  it('keeps the expiry when the campaign is paused (the switch sends isActive alone)', async () => {
    const paused = await update({ isActive: false });
    expect(writes.set[0]).not.toHaveProperty('expiresAt');
    expect(writes.set[0]).toMatchObject({ isActive: false });
    expect(paused.expiresAt).toEqual(EXPIRES_AT);
  });

  it('keeps the expiry when the campaign is resumed', async () => {
    const resumed = await update({ isActive: true });
    expect(writes.set[0]).not.toHaveProperty('expiresAt');
    expect(resumed.expiresAt).toEqual(EXPIRES_AT);
  });

  it('writes nothing but the name and the time of the update when only the name is sent', async () => {
    await update({ name: 'Fair 2026 (Osaka)' });
    expect(Object.keys(writes.set[0]).sort()).toEqual(['name', 'updatedAt']);
  });

  it('changes the expiry when a new one is sent', async () => {
    const changed = await update({ expiresAt: '2026-12-31T15:00:00.000Z' });
    expect(writes.set[0].expiresAt).toEqual(new Date('2026-12-31T15:00:00.000Z'));
    expect(changed.expiresAt).toEqual(new Date('2026-12-31T15:00:00.000Z'));
  });

  it('clears the expiry when null is sent', async () => {
    const cleared = await update({ isActive: true, expiresAt: null });
    expect(writes.set[0]).toHaveProperty('expiresAt', null);
    expect(cleared.expiresAt).toBeNull();
  });

  it('writes the row by its id within the organization', async () => {
    await update({ isActive: false });
    const { sql, params } = new PgDialect().sqlToQuery(
      writes.where[0] as Parameters<PgDialect['sqlToQuery']>[0]
    );
    expect(sql).toContain('"qr_campaigns"."organization_id" = ');
    expect(params).toEqual(expect.arrayContaining([CAMPAIGN_ID, ORG_ID]));
  });
});
