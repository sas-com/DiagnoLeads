/**
 * Where a scan of a QR campaign goes, as the settings page shows it (#692, #695) and as the /q/
 * entry does it: for every case of the entry's rule (owner decisions in #663) the list of
 * campaigns (distribution.listCampaigns on the real router) and the entry (GET /q/<code>) give
 * the same answer. They share one function (openCampaignDestination, inside campaignDestination),
 * so this checks that both feed it the same facts:
 * - open, paused or expired (isCampaignOpen; an expired campaign is expired with its switch on)
 * - a campaign that names no diagnosis: the AX diagnosis for the AX organization's only, in
 *   whichever case the environment holds its id (#698)
 * - a campaign that names a builder diagnosis: /d/<slug> only while that page serves it
 * The query of the list for the diagnoses (servedCampaignDiagnoses) is checked against
 * findPublicDiagnosis on PostgreSQL in test/unit/integration/qr-campaign-destination.db.test.ts.
 */
import type { QrEntryCampaign } from '@/lib/features/distribution/short-code-entry';
import type {
  QrCampaignClosedReason,
  QrCampaignDestination,
} from '@/lib/features/distribution/types';
import { PgDialect } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/pg-proxy';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const NOW = new Date('2026-10-29T01:00:00Z');
const ORG_AX = '11111111-1111-4111-8111-11111111aaaa';
const ORG_OTHER = '22222222-2222-4222-8222-22222222bbbb';
const USER_ID = '550e8400-e29b-41d4-a716-446655440000';
const DIAGNOSIS = { id: '33333333-3333-4333-8333-333333333333', slug: 'cloud-readiness' };
/** Another organization's diagnosis /d/<slug> serves for the same slug */
const OTHERS_DIAGNOSIS = { id: '44444444-4444-4444-8444-444444444444', slug: 'cloud-readiness' };

const mocks = vi.hoisted(() => ({
  env: {
    NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
    AX_DIAGNOSIS_ORGANIZATION_ID: undefined as string | undefined,
    DEFAULT_ORGANIZATION_ID: undefined as string | undefined,
  },
  findMany: vi.fn(),
  findOpenQrCampaign: vi.fn(),
  findPublicDiagnosis: vi.fn(),
  queries: [] as { sql: string; params: unknown[] }[],
  servedRows: [] as unknown[][],
}));

// Both read the organization of the AX diagnosis from here, the router through
// lib/multi-tenant/helpers/diagnosis-organization.ts, the entry through
// lib/features/diagnostics/organization.ts (not stubbed)
vi.mock('@/lib/env', () => ({ env: mocks.env }));
vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));
// The router reads the campaigns with the global client, the entry with lib/db/client
vi.mock('@/lib/db', () => ({ db: { query: { qrCampaigns: { findMany: mocks.findMany } } } }));
vi.mock('@/lib/db/client', () => ({ db: { name: 'entry-db' } }));
vi.mock('@/lib/features/distribution/short-code-entry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/features/distribution/short-code-entry')>()),
  findOpenQrCampaign: mocks.findOpenQrCampaign,
}));
vi.mock('@/lib/features/diagnosis-builder/public-diagnosis', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/features/diagnosis-builder/public-diagnosis')>()),
  findPublicDiagnosis: mocks.findPublicDiagnosis,
}));
vi.mock('@/lib/features/diagnostics/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/features/diagnostics/rate-limit')>()),
  consumeRateLimit: vi.fn().mockResolvedValue({ allowed: true, count: 1, retryAfterSeconds: 600 }),
}));
vi.mock('@/lib/features/distribution/scans', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/features/distribution/scans')>()),
  recordQrScan: vi.fn().mockResolvedValue(true),
}));
vi.mock('@/lib/ops/alert', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ops/alert')>()),
  reportRejectedRequest: vi.fn(),
  reportServerError: vi.fn(),
}));
// The scan recording after the response is not the point here
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: () => {},
}));

const { GET } = await import('@/app/q/[code]/route');
const { appRouter } = await import('@/server/routers/_app');
const { isCampaignOpen, qrEntryRedirectPath } = await import(
  '@/lib/features/distribution/short-code-entry'
);

/**
 * ctx.db of the router: a drizzle client whose database answers the query for the diagnoses
 * with the rows the case's database would hold, and keeps what it was asked
 */
const proxy = drizzle(async (sql, params) => {
  mocks.queries.push({ sql, params });
  return { rows: mocks.servedRows };
});

function listAs(organizationId: string) {
  const user = { id: USER_ID, email: 'admin@example.com', name: 'Admin' };
  const membership = {
    id: '880e8400-e29b-41d4-a716-446655440000',
    organizationId,
    userId: USER_ID,
    role: 'admin',
    organization: { id: organizationId, name: 'Org', slug: 'org', settings: {} },
  };
  const ctxDb = {
    select: (...args: Parameters<typeof proxy.select>) => proxy.select(...args),
    query: { organizationMembers: { findFirst: vi.fn().mockResolvedValue(membership) } },
  };
  return appRouter
    .createCaller({
      db: ctxDb,
      session: { session: { id: 's', userId: USER_ID }, user },
      user,
      // biome-ignore lint/suspicious/noExplicitAny: test context
    } as any)
    .distribution.listCampaigns({ organizationId });
}

interface Case {
  name: string;
  /** The organization that receives the AX diagnosis, as the environment holds it */
  axOrganizationId?: string;
  /** As the default organization, when the AX one is not set */
  defaultOrganizationId?: string;
  organizationId: string;
  isActive?: boolean;
  expiresAt?: Date | null;
  diagnosisId?: string;
  /** The diagnosis the campaign names, when it is of the campaign's organization */
  ownDiagnosis?: { id: string; slug: string };
  /** What /d/<slug of ownDiagnosis> serves (findPublicDiagnosis), null for nothing */
  served?: { id: string; slug: string } | null;
  expected: QrCampaignDestination;
}

const AX: QrCampaignDestination = { kind: 'ax_diagnosis' };
const none = (...reasons: QrCampaignClosedReason[]): QrCampaignDestination => ({
  kind: 'none',
  reasons,
});
const names = { diagnosisId: DIAGNOSIS.id, ownDiagnosis: DIAGNOSIS };

/** Of another organization than the AX one: one that names a diagnosis /d/ serves, one none */
const SERVED: Case = {
  name: 'one whose diagnosis /d/<slug> serves',
  axOrganizationId: ORG_AX,
  organizationId: ORG_OTHER,
  ...names,
  served: DIAGNOSIS,
  expected: { kind: 'diagnosis', slug: DIAGNOSIS.slug },
};
const WITHOUT_DIAGNOSIS: Case = {
  name: "another organization's",
  axOrganizationId: ORG_AX,
  organizationId: ORG_OTHER,
  expected: { kind: 'none', reasons: ['not_ax_organization'] },
};

const CASES: Case[] = [
  // A campaign that names no diagnosis
  { name: "the AX organization's", axOrganizationId: ORG_AX, organizationId: ORG_AX, expected: AX },
  {
    name: "the AX organization's, its id in upper case in the environment (#698)",
    axOrganizationId: ORG_AX.toUpperCase(),
    organizationId: ORG_AX,
    expected: AX,
  },
  {
    name: "the default organization's while no AX organization is set, in upper case",
    defaultOrganizationId: ORG_AX.toUpperCase(),
    organizationId: ORG_AX,
    expected: AX,
  },
  WITHOUT_DIAGNOSIS,
  {
    name: 'any while no organization receives the AX diagnosis',
    organizationId: ORG_AX,
    expected: none('not_ax_organization'),
  },
  {
    name: 'one that ends later',
    axOrganizationId: ORG_AX,
    organizationId: ORG_AX,
    expiresAt: new Date(NOW.getTime() + 1),
    expected: AX,
  },
  // Paused and expired
  {
    name: 'a paused one',
    axOrganizationId: ORG_AX,
    organizationId: ORG_AX,
    isActive: false,
    expected: none('paused'),
  },
  {
    name: 'an expired one with its switch on',
    axOrganizationId: ORG_AX,
    organizationId: ORG_AX,
    expiresAt: new Date('2026-10-28T14:59:59.999Z'),
    expected: none('expired'),
  },
  {
    name: 'one at the instant of its end',
    axOrganizationId: ORG_AX,
    organizationId: ORG_AX,
    expiresAt: NOW,
    expected: none('expired'),
  },
  {
    name: "another organization's, paused and expired: every reason",
    axOrganizationId: ORG_AX,
    organizationId: ORG_OTHER,
    isActive: false,
    expiresAt: new Date('2026-10-01T00:00:00Z'),
    expected: none('paused', 'expired', 'not_ax_organization'),
  },
  // A campaign that names a builder diagnosis
  SERVED,
  {
    name: "the AX organization's whose diagnosis /d/<slug> serves: there, not the AX diagnosis",
    axOrganizationId: ORG_AX,
    organizationId: ORG_AX,
    ...names,
    served: DIAGNOSIS,
    expected: { kind: 'diagnosis', slug: DIAGNOSIS.slug },
  },
  {
    name: 'one whose diagnosis is not published (paused, archived, a draft, a slug two publish)',
    axOrganizationId: ORG_AX,
    organizationId: ORG_AX,
    ...names,
    served: null,
    expected: none('diagnosis_not_published'),
  },
  {
    name: "one whose slug /d/ serves another organization's diagnosis for",
    axOrganizationId: ORG_AX,
    organizationId: ORG_OTHER,
    ...names,
    served: OTHERS_DIAGNOSIS,
    expected: none('diagnosis_not_published'),
  },
  {
    name: 'one that names a diagnosis of another organization',
    axOrganizationId: ORG_AX,
    organizationId: ORG_OTHER,
    diagnosisId: OTHERS_DIAGNOSIS.id,
    expected: none('diagnosis_not_published'),
  },
  {
    name: 'a paused one whose diagnosis /d/<slug> serves',
    axOrganizationId: ORG_AX,
    organizationId: ORG_OTHER,
    isActive: false,
    ...names,
    served: DIAGNOSIS,
    expected: none('paused'),
  },
  {
    name: 'an expired one whose diagnosis is not published',
    axOrganizationId: ORG_AX,
    organizationId: ORG_AX,
    expiresAt: new Date('2026-10-01T00:00:00Z'),
    ...names,
    served: null,
    expected: none('expired', 'diagnosis_not_published'),
  },
];

const UTM = { source: 'qrcode', medium: 'offline', campaign: 'fair-2026', content: null };

function rowOf(c: Case) {
  return {
    id: '770e8400-e29b-41d4-a716-446655440001',
    organizationId: c.organizationId,
    diagnosticTemplateId: '770e8400-e29b-41d4-a716-446655440002',
    diagnosisId: c.diagnosisId ?? null,
    name: 'Fair 2026',
    description: null,
    shortCode: 'AbCd2345',
    trackingUrl: 'http://localhost:3000/d/AbCd2345',
    utmSource: UTM.source,
    utmMedium: UTM.medium,
    utmCampaign: UTM.campaign,
    utmContent: UTM.content,
    scanCount: 0,
    completionCount: 0,
    isActive: c.isActive ?? true,
    expiresAt: c.expiresAt ?? null,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-01T00:00:00Z'),
    diagnosticTemplate: { id: '770e8400-e29b-41d4-a716-446655440002', name: 'T', title: 'T' },
  };
}

/** Set up both sides with what the case's database and environment hold */
function arrange(c: Case) {
  mocks.env.AX_DIAGNOSIS_ORGANIZATION_ID = c.axOrganizationId;
  mocks.env.DEFAULT_ORGANIZATION_ID = c.defaultOrganizationId;
  const row = rowOf(c);
  mocks.findMany.mockResolvedValue([row]);
  // The list's query returns the organization's diagnoses /d/<slug> serves, of those named
  mocks.servedRows =
    c.ownDiagnosis && c.served?.id === c.ownDiagnosis.id ? [[c.served.id, c.served.slug]] : [];
  // The entry finds open campaigns only (isCampaignOpen, checked on PostgreSQL elsewhere)
  const entryCampaign: QrEntryCampaign = {
    campaignId: row.id,
    organizationId: row.organizationId,
    shortCode: row.shortCode,
    diagnosisId: row.diagnosisId,
    diagnosis: c.ownDiagnosis ?? null,
    utm: UTM,
  };
  mocks.findOpenQrCampaign.mockImplementation(async () =>
    isCampaignOpen(row, new Date()) ? entryCampaign : null
  );
  mocks.findPublicDiagnosis.mockImplementation(async (_db: unknown, slug: string) =>
    c.served && slug === c.ownDiagnosis?.slug
      ? { ...c.served, organizationId: 'whoever', name: 'Diagnosis', current: {} }
      : null
  );
}

async function scan() {
  const req = new NextRequest('https://app.example/q/AbCd2345', {
    headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' },
  });
  return GET(req, { params: Promise.resolve({ code: 'AbCd2345' }) });
}

describe('where a scan goes: the settings page and the /q/ entry (#692, #695)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.queries.length = 0;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each(CASES)('$name', async (c) => {
    arrange(c);

    const [listed] = await listAs(c.organizationId);
    const res = await scan();

    expect(listed.destination).toEqual(c.expected);
    if (c.expected.kind === 'none') {
      expect(res.status).toBe(404);
      expect(res.headers.get('location')).toBeNull();
    } else {
      expect(res.status).toBe(307);
      const slug = c.expected.kind === 'diagnosis' ? c.expected.slug : null;
      expect(res.headers.get('location')).toBe(
        qrEntryRedirectPath({ shortCode: 'AbCd2345', utm: UTM }, slug)
      );
    }
  });

  it('lists the campaigns of the organization only, and asks once for their diagnoses, within it', async () => {
    arrange(SERVED);
    const second = { ...rowOf(SERVED), id: '770e8400-e29b-41d4-a716-446655440009' };
    mocks.findMany.mockResolvedValue([rowOf(SERVED), second, rowOf(WITHOUT_DIAGNOSIS)]);

    const listed = await listAs(ORG_OTHER);

    expect(listed.map((campaign) => campaign.destination.kind)).toEqual([
      'diagnosis',
      'diagnosis',
      'none',
    ]);
    const { where } = mocks.findMany.mock.calls[0][0];
    const campaigns = new PgDialect().sqlToQuery(where);
    expect(campaigns.sql).toBe('"qr_campaigns"."organization_id" = $1');
    expect(campaigns.params).toEqual([ORG_OTHER]);
    expect(mocks.queries).toHaveLength(1);
    const [query] = mocks.queries;
    expect(query.sql).toContain('"diagnoses"."organization_id" = $1');
    expect(query.params[0]).toBe(ORG_OTHER);
    // Each diagnosis is asked for once
    expect(query.params.filter((param) => param === DIAGNOSIS.id)).toHaveLength(1);
  });

  it('does not ask for diagnoses when no campaign names one', async () => {
    arrange(WITHOUT_DIAGNOSIS);
    await listAs(ORG_OTHER);
    expect(mocks.queries).toHaveLength(0);
  });
});
