/**
 * The tracking URL the settings page of QR campaigns gets (#503): /q/<short code>, built from the
 * short code and UTM columns each time. Campaigns saved before #503 hold /d/<code> in
 * qr_campaigns.tracking_url; their list entry (Copy URL), detail and downloaded QR code must use
 * the /q/ URL without the stored rows being rewritten.
 * Also what updateCampaign writes (#610): only the fields it is sent.
 * Runs the real router on a fake database that answers with the stored row and keeps what it is
 * given to write.
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

// The QR image is not the point: keep the URL it was made from
vi.mock('qrcode', () => ({
  default: {
    toDataURL: vi.fn(async (url: string) => `qr:${url}`),
    toBuffer: vi.fn(),
    toString: vi.fn(),
  },
}));

const USER_ID = '550e8400-e29b-41d4-a716-446655440000';
const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const CAMPAIGN_ID = '770e8400-e29b-41d4-a716-446655440001';
const TEMPLATE_ID = '770e8400-e29b-41d4-a716-446655440002';

const STORED = {
  id: CAMPAIGN_ID,
  organizationId: ORG_ID,
  diagnosticTemplateId: TEMPLATE_ID,
  diagnosisId: null,
  name: 'Fair 2026',
  description: null,
  shortCode: 'AbCd2345',
  // As createCampaign saved it before #503
  trackingUrl: 'http://localhost:3000/d/AbCd2345?utm_source=qrcode&utm_medium=offline',
  utmSource: 'qrcode',
  utmMedium: 'offline',
  utmCampaign: 'fair-2026',
  utmContent: null,
  scanCount: 0,
  completionCount: 0,
  isActive: true,
  expiresAt: null,
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-10-01T00:00:00Z'),
};
const EXPECTED = 'http://localhost:3000/q/AbCd2345?utm_source=qrcode&utm_medium=offline&utm_campaign=fair-2026';

const { store } = vi.hoisted(() => ({
  store: {
    inserted: [] as Record<string, unknown>[],
    updated: [] as { set: Record<string, unknown>; where: unknown }[],
  },
}));
// The distribution router uses the global client
vi.mock('@/lib/db', () => {
  const returning = (row: () => Record<string, unknown>) => ({
    returning: vi.fn(async () => [row()]),
  });
  return {
    db: {
      query: {
        qrCampaigns: {
          findMany: vi.fn(async () => [{ ...STORED, diagnosticTemplate: { id: TEMPLATE_ID } }]),
          findFirst: vi.fn(async () => STORED),
        },
        diagnosticTemplates: { findFirst: vi.fn(async () => ({ id: TEMPLATE_ID })) },
      },
      insert: vi.fn(() => ({
        values: vi.fn((values: Record<string, unknown>) => {
          store.inserted.push(values);
          return returning(() => ({ ...STORED, ...values }));
        }),
      })),
      update: vi.fn(() => ({
        set: vi.fn((values: Record<string, unknown>) => ({
          where: vi.fn((condition: unknown) => {
            store.updated.push({ set: values, where: condition });
            return returning(() => ({ ...STORED, ...values }));
          }),
        })),
      })),
    },
  };
});

const { appRouter } = await import('@/server/routers/_app');
const { db } = await import('@/lib/db');

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

const org = { organizationId: ORG_ID };

beforeEach(() => {
  store.inserted.length = 0;
  store.updated.length = 0;
  vi.clearAllMocks();
});

describe('tracking URL of QR campaigns (#503)', () => {
  it('lists a campaign saved with /d/<code> with its /q/ URL (Copy URL)', async () => {
    const [campaign] = await adminCaller().distribution.listCampaigns(org);
    expect(campaign.trackingUrl).toBe(EXPECTED);
  });

  it('builds the QR code of the detail from the /q/ URL', async () => {
    const campaign = await adminCaller().distribution.getCampaign({ ...org, id: CAMPAIGN_ID });
    expect(campaign.trackingUrl).toBe(EXPECTED);
    expect(campaign.qrCodeDataUrl).toBe(`qr:${EXPECTED}`);
  });

  it('downloads a QR code that holds the /q/ URL (Download QR)', async () => {
    const result = await adminCaller().distribution.generateCampaignQR({
      ...org,
      campaignId: CAMPAIGN_ID,
    });
    expect(result).toEqual({ qrCode: `qr:${EXPECTED}`, shortCode: 'AbCd2345', trackingUrl: EXPECTED });
  });

  it('answers an update with the /q/ URL too', async () => {
    const updated = await adminCaller().distribution.updateCampaign({
      ...org,
      id: CAMPAIGN_ID,
      data: { isActive: false },
    });
    expect(updated.trackingUrl).toBe(EXPECTED);
  });

  it('answers NOT_FOUND when the campaign is deleted between the read and the update', async () => {
    vi.mocked(db.update).mockReturnValueOnce({
      set: vi.fn(() => ({ where: vi.fn(() => ({ returning: vi.fn(async () => []) })) })),
    } as unknown as ReturnType<typeof db.update>);
    await expect(
      adminCaller().distribution.updateCampaign({ ...org, id: CAMPAIGN_ID, data: { name: 'New' } })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('saves and returns the /q/ URL of a new campaign, with its UTM parameters', async () => {
    // The short code is free
    vi.mocked(db.query.qrCampaigns.findFirst).mockResolvedValueOnce(undefined);
    const created = await adminCaller().distribution.createCampaign({
      ...org,
      name: 'Seminar',
      diagnosticTemplateId: TEMPLATE_ID,
      utmCampaign: 'seminar-11',
    });
    const [values] = store.inserted;
    const code = values.shortCode as string;
    expect(code).toMatch(/^[A-Za-z0-9]{8}$/);
    const url = `http://localhost:3000/q/${code}?utm_source=qrcode&utm_medium=offline&utm_campaign=seminar-11`;
    expect(values.trackingUrl).toBe(url);
    expect(created.qrCodeDataUrl).toBe(`qr:${url}`);
    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(db.query.qrCampaigns.findFirst).toHaveBeenCalledTimes(1);
  });

  it('no longer offers the on-demand QR code of a template, which pointed at /d/<template id>', () => {
    expect(Object.keys(appRouter._def.procedures)).not.toContain('distribution.generateQRCode');
  });
});

/**
 * #610: the switch of the settings page sends { isActive } alone. Pausing and resuming used to
 * write expires_at = null, and the /q/ entry (#503) then forwarded an expired campaign again.
 * expiresAt: null still clears the expiry. What the database keeps is checked on PostgreSQL in
 * test/unit/integration/distribution-org-isolation.db.test.ts
 */
describe('updateCampaign writes only the fields it is sent (#610)', () => {
  const update = (data: Record<string, unknown>) =>
    adminCaller().distribution.updateCampaign({ ...org, id: CAMPAIGN_ID, data });
  const written = () => store.updated[0].set;

  it('does not write the expiry when the campaign is paused (the switch sends isActive alone)', async () => {
    await update({ isActive: false });
    expect(written()).not.toHaveProperty('expiresAt');
    expect(written()).toMatchObject({ isActive: false });
  });

  it('does not write the expiry when the campaign is resumed', async () => {
    await update({ isActive: true });
    expect(written()).not.toHaveProperty('expiresAt');
    expect(written()).toMatchObject({ isActive: true });
  });

  it('writes nothing but the name and the time of the update when only the name is sent', async () => {
    await update({ name: 'Fair 2026 (Osaka)' });
    expect(Object.keys(written()).sort()).toEqual(['name', 'updatedAt']);
  });

  it('changes the expiry when a new one is sent', async () => {
    await update({ expiresAt: '2026-12-31T15:00:00.000Z' });
    expect(written().expiresAt).toEqual(new Date('2026-12-31T15:00:00.000Z'));
  });

  it('clears the expiry when null is sent', async () => {
    await update({ isActive: true, expiresAt: null });
    expect(written()).toHaveProperty('expiresAt', null);
  });

  it('writes the row by its id within the organization', async () => {
    await update({ isActive: false });
    const { sql, params } = new PgDialect().sqlToQuery(
      store.updated[0].where as Parameters<PgDialect['sqlToQuery']>[0]
    );
    expect(sql).toContain('"qr_campaigns"."organization_id" = ');
    expect(params).toEqual(expect.arrayContaining([CAMPAIGN_ID, ORG_ID]));
  });
});
