/**
 * #698: the organization that receives the AX diagnosis is compared with another organization in
 * one way everywhere (isDiagnosisOrganization), whichever case the environment holds its uuid in.
 * PostgreSQL returns a uuid in lower case; z.string().uuid() lets an upper-case one through. With
 * the id set in upper case, lower case or as the default organization, every place answers as for
 * the id the database holds:
 * - the QR entry (GET /q/<code>): the AX diagnosis for a campaign that names no diagnosis
 * - the QR campaigns page (distribution.listCampaigns): the same destination
 * - the agency links page (agencyLinks.list): receivesDiagnoses
 * - a consultation request (diagnosisConsultationRecipients): the sales addresses
 * - the page views of the operator's pages (organizationOfPage) and the AX diagnosis's leads
 *   (resolveDiagnosisOrganizationId): the id as the database holds it
 */
import type { QrEntryCampaign } from '@/lib/features/distribution/short-code-entry';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** As PostgreSQL returns it */
const AX_ORG = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const OTHER_ORG = '0f1e2d3c-4b5a-4968-8776-655443322110';
const USER_ID = '550e8400-e29b-41d4-a716-446655440000';
const SALES = 'sales@example.jp';

const mocks = vi.hoisted(() => ({
  env: {
    NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
    AX_DIAGNOSIS_ORGANIZATION_ID: undefined as string | undefined,
    DEFAULT_ORGANIZATION_ID: undefined as string | undefined,
    AX_DIAGNOSIS_SALES_EMAIL: 'sales@example.jp',
  },
  findMany: vi.fn(),
  findOpenQrCampaign: vi.fn(),
  consultationRecipients: vi.fn(),
}));

vi.mock('@/lib/env', () => ({ env: mocks.env }));
vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/db', () => ({ db: { query: { qrCampaigns: { findMany: mocks.findMany } } } }));
vi.mock('@/lib/db/client', () => ({ db: { name: 'app-db' } }));
vi.mock('@/lib/features/distribution/short-code-entry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/features/distribution/short-code-entry')>()),
  findOpenQrCampaign: mocks.findOpenQrCampaign,
}));
vi.mock('@/lib/features/diagnostics/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/features/diagnostics/rate-limit')>()),
  consumeRateLimit: vi.fn().mockResolvedValue({ allowed: true, count: 1, retryAfterSeconds: 600 }),
}));
vi.mock('@/lib/features/leads/assignment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/features/leads/assignment')>()),
  consultationRecipients: mocks.consultationRecipients,
}));
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: () => {},
}));

const { GET } = await import('@/app/q/[code]/route');
const { appRouter } = await import('@/server/routers/_app');
const { diagnosisConsultationRecipients } = await import('@/lib/features/diagnostics/service');
const { resolveDiagnosisOrganizationId } = await import('@/lib/features/diagnostics/organization');
const { isDiagnosisOrganization } = await import(
  '@/lib/multi-tenant/helpers/diagnosis-organization'
);
const { organizationOfPage } = await import('@/lib/features/site-visits/record');
const { sitePageOf } = await import('@/lib/features/site-visits/pages');

function callerFor(organizationId: string) {
  const user = { id: USER_ID, email: 'admin@example.com', name: 'Admin' };
  const membership = {
    id: '880e8400-e29b-41d4-a716-446655440000',
    organizationId,
    userId: USER_ID,
    role: 'admin',
    organization: { id: organizationId, name: 'Org', slug: 'org', settings: {} },
  };
  // The agency links of the organization: none
  const select = () => ({
    from: () => ({
      leftJoin: () => ({
        where: () => ({ groupBy: () => ({ orderBy: async () => [] }) }),
      }),
    }),
  });
  return appRouter.createCaller({
    db: { select, query: { organizationMembers: { findFirst: async () => membership } } },
    session: { session: { id: 's', userId: USER_ID }, user },
    user,
    // biome-ignore lint/suspicious/noExplicitAny: test context
  } as any);
}

/** A campaign of the organization that names no diagnosis */
function campaignOf(organizationId: string) {
  return {
    id: '770e8400-e29b-41d4-a716-446655440001',
    organizationId,
    diagnosisId: null,
    shortCode: 'AbCd2345',
    utmSource: 'qrcode',
    utmMedium: 'offline',
    utmCampaign: null,
    utmContent: null,
    isActive: true,
    expiresAt: null,
  };
}

/** What each place answers for the organization */
async function answersFor(organizationId: string) {
  const campaign = campaignOf(organizationId);
  mocks.findMany.mockResolvedValue([campaign]);
  const entryCampaign: QrEntryCampaign = {
    campaignId: campaign.id,
    organizationId,
    diagnosisId: null,
    diagnosis: null,
    utm: { source: 'qrcode', medium: 'offline', campaign: null, content: null },
  };
  mocks.findOpenQrCampaign.mockResolvedValue(entryCampaign);
  const caller = callerFor(organizationId);

  const entry = await GET(new NextRequest('https://app.example/q/AbCd2345'), {
    params: Promise.resolve({ code: 'AbCd2345' }),
  });
  const [listed] = await caller.distribution.listCampaigns({ organizationId });
  const links = await caller.agencyLinks.list({ organizationId });
  await diagnosisConsultationRecipients({} as never, organizationId);
  const salesEmail = mocks.consultationRecipients.mock.calls.at(-1)?.[2];

  return {
    entrySendsToAxDiagnosis: entry.status === 307,
    listShowsAxDiagnosis: listed.destination.kind === 'ax_diagnosis',
    agencyLinksReceiveDiagnoses: links.receivesDiagnoses,
    salesHearOfConsultations: salesEmail === SALES,
  };
}

const all = (value: boolean) => ({
  entrySendsToAxDiagnosis: value,
  listShowsAxDiagnosis: value,
  agencyLinksReceiveDiagnoses: value,
  salesHearOfConsultations: value,
});

const SETTINGS = [
  { name: 'in lower case', ax: AX_ORG, fallback: undefined },
  { name: 'in upper case', ax: AX_ORG.toUpperCase(), fallback: undefined },
  { name: 'in mixed case', ax: 'A1B2c3d4-E5F6-4a7b-8C9D-0e1f2A3B4C5D', fallback: undefined },
  { name: 'as the default organization, in upper case', ax: undefined, fallback: AX_ORG.toUpperCase() },
];

describe('the organization that receives the AX diagnosis, compared in one way (#698)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.consultationRecipients.mockResolvedValue({ inApp: [], emails: [] });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  describe.each(SETTINGS)('with its id set $name', ({ ax, fallback }) => {
    beforeEach(() => {
      mocks.env.AX_DIAGNOSIS_ORGANIZATION_ID = ax;
      mocks.env.DEFAULT_ORGANIZATION_ID = fallback;
    });

    it('hands the id out as the database holds it', async () => {
      expect(resolveDiagnosisOrganizationId()).toBe(AX_ORG);
      expect(await organizationOfPage({} as never, sitePageOf('/ja') as never)).toBe(AX_ORG);
    });

    it('is the organization the database holds, everywhere', async () => {
      expect(await answersFor(AX_ORG)).toEqual(all(true));
    });

    it('is no other organization, anywhere', async () => {
      expect(await answersFor(OTHER_ORG)).toEqual(all(false));
    });
  });

  describe('with none set', () => {
    beforeEach(() => {
      mocks.env.AX_DIAGNOSIS_ORGANIZATION_ID = undefined;
      mocks.env.DEFAULT_ORGANIZATION_ID = undefined;
    });

    it('is no organization, anywhere', async () => {
      expect(resolveDiagnosisOrganizationId()).toBeNull();
      expect(await answersFor(AX_ORG)).toEqual(all(false));
    });
  });

  it('prefers the AX organization to the default one', () => {
    mocks.env.AX_DIAGNOSIS_ORGANIZATION_ID = AX_ORG.toUpperCase();
    mocks.env.DEFAULT_ORGANIZATION_ID = OTHER_ORG;
    expect(resolveDiagnosisOrganizationId()).toBe(AX_ORG);
  });

  it('compares both ids in one case and matches nothing while none is set', () => {
    expect(isDiagnosisOrganization(AX_ORG, AX_ORG.toUpperCase())).toBe(true);
    expect(isDiagnosisOrganization(AX_ORG.toUpperCase(), AX_ORG)).toBe(true);
    expect(isDiagnosisOrganization(OTHER_ORG, AX_ORG)).toBe(false);
    expect(isDiagnosisOrganization(AX_ORG, null)).toBe(false);
  });
});
