/**
 * Role checks of admin API procedures that had none (#356): analytics, A/B test and template
 * counters, embed configs, QR campaigns and the header lead search. (The feature flag router of
 * the issue is not mounted on the app router, so it cannot be called.)
 * Uses the real CASL abilities. The database is a fake that answers every query with no rows,
 * so a procedure that gets past its check returns empty results or NOT_FOUND, never FORBIDDEN.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/rls', () => ({ setCurrentUser: vi.fn().mockResolvedValue(undefined) }));

/** Any property, any call: awaiting it yields no rows */
function emptyDb(): unknown {
  const target = () => {};
  const proxy: unknown = new Proxy(target, {
    get: (_t, prop) => {
      if (prop === 'then') {
        return (resolve: (rows: unknown[]) => void) => resolve([]);
      }
      return proxy;
    },
    apply: () => proxy,
  });
  return proxy;
}

const { fakeDb } = vi.hoisted(() => ({ fakeDb: { current: null as unknown } }));
// embed and distribution use the global client
vi.mock('@/lib/db', () => ({
  get db() {
    return fakeDb.current;
  },
}));
vi.mock('@/lib/db/client', () => ({
  get db() {
    return fakeDb.current;
  },
}));
fakeDb.current = emptyDb();

const { appRouter } = await import('@/server/routers/_app');

const USER_ID = '550e8400-e29b-41d4-a716-446655440000';
const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const ID = '770e8400-e29b-41d4-a716-446655440001';

/** A role with no abilities at all stands for "cannot read leads" (every real role can) */
const NO_ROLE = 'no_role';

function callerAs(role: string) {
  const user = {
    id: USER_ID,
    email: 'test@example.com',
    name: 'Test',
    emailVerified: true,
    image: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const membership = {
    id: '880e8400-e29b-41d4-a716-446655440000',
    organizationId: ORG_ID,
    userId: USER_ID,
    role,
    createdAt: new Date(),
    updatedAt: new Date(),
    organization: { id: ORG_ID, name: 'Org', slug: 'org', settings: {} },
  };
  const db = emptyDb() as Record<string, unknown>;
  const ctx = {
    db: new Proxy(db as object, {
      get: (target, prop) =>
        prop === 'query'
          ? new Proxy(
              {},
              {
                get: (_t, table) =>
                  table === 'organizationMembers'
                    ? { findFirst: vi.fn().mockResolvedValue(membership) }
                    : (target as Record<string | symbol, unknown>)[prop],
              }
            )
          : (target as Record<string | symbol, unknown>)[prop],
    }),
    session: { session: { id: 's', userId: USER_ID }, user },
    user,
  };
  // biome-ignore lint/suspicious/noExplicitAny: test context
  return appRouter.createCaller(ctx as any);
}

type Caller = ReturnType<typeof callerAs>;
type Call = (caller: Caller) => Promise<unknown>;

const org = { organizationId: ORG_ID };

/** Procedures that read: refused to a member without the right to read leads */
const READS: Record<string, Call> = {
  'analytics.getOverview': (c) => c.analytics.getOverview(org),
  'analytics.getLeadTrend': (c) => c.analytics.getLeadTrend(org),
  'analytics.getSourceBreakdown': (c) => c.analytics.getSourceBreakdown(org),
  'analytics.getStatusBreakdown': (c) => c.analytics.getStatusBreakdown(org),
  'analytics.getConversionFunnel': (c) => c.analytics.getConversionFunnel(org),
  'analytics.getResponseTime': (c) => c.analytics.getResponseTime(org),
  'analytics.getAcquisitionCost': (c) => c.analytics.getAcquisitionCost(org),
  'analytics.getAgencyPerformance': (c) => c.analytics.getAgencyPerformance(org),
  'diagnosticTemplates.getBySlug': (c) => c.diagnosticTemplates.getBySlug({ ...org, slug: 'x' }),
  'leadSearch.suggest': (c) => c.leadSearch.suggest({ ...org, query: '山田' }),
  'embed.list': (c) => c.embed.list(org),
  'embed.get': (c) => c.embed.get({ ...org, id: ID }),
  'embed.getAccessLogs': (c) => c.embed.getAccessLogs({ ...org, embedConfigId: ID }),
  'embed.getStats': (c) => c.embed.getStats({ ...org, embedConfigId: ID }),
  'distribution.listCampaigns': (c) => c.distribution.listCampaigns(org),
  'distribution.getCampaign': (c) => c.distribution.getCampaign({ ...org, id: ID }),
  'distribution.getCampaignStats': (c) =>
    c.distribution.getCampaignStats({ ...org, campaignId: ID }),
  // A mutation, but it only builds a QR code
  'distribution.generateCampaignQR': (c) =>
    c.distribution.generateCampaignQR({ ...org, campaignId: ID }),
  // Picks a variant without writing (recordEvent records the impression)
  'abTests.selectVariant': (c) => c.abTests.selectVariant({ ...org, testId: ID }),
};

/** Counters of A/B tests and templates: same rule as the other changes in those routers */
const COUNTERS: Record<string, Call> = {
  'abTests.recordEvent': (c) =>
    c.abTests.recordEvent({ ...org, testId: ID, variantTemplateId: ID, eventType: 'impression' }),
  'diagnosticTemplates.incrementSubmission': (c) =>
    c.diagnosticTemplates.incrementSubmission({ ...org, id: ID }),
};

/** Changes to embed configs (API keys) and QR campaigns: those who can update settings */
const SETTINGS_WRITES: Record<string, Call> = {
  'embed.create': (c) =>
    c.embed.create({ ...org, name: 'x', diagnosticTemplateId: ID } as Parameters<
      Caller['embed']['create']
    >[0]),
  'embed.update': (c) => c.embed.update({ ...org, id: ID, data: { name: 'x' } }),
  'embed.regenerateApiKey': (c) => c.embed.regenerateApiKey({ ...org, id: ID }),
  'embed.delete': (c) => c.embed.delete({ ...org, id: ID }),
  'distribution.createCampaign': (c) =>
    c.distribution.createCampaign({ ...org, name: 'x', diagnosticTemplateId: ID } as Parameters<
      Caller['distribution']['createCampaign']
    >[0]),
  'distribution.updateCampaign': (c) =>
    c.distribution.updateCampaign({ ...org, id: ID, data: { name: 'x' } }),
  'distribution.deleteCampaign': (c) => c.distribution.deleteCampaign({ ...org, id: ID }),
};

const forbidden = expect.objectContaining({ code: 'FORBIDDEN' });

/** Resolves to the error code, or 'OK' when the call succeeded */
async function codeOf(call: Call, role: string): Promise<string> {
  try {
    await call(callerAs(role));
    return 'OK';
  } catch (error) {
    return (error as { code?: string }).code ?? String(error);
  }
}

describe('admin API role checks (#356)', () => {
  describe.each([
    ['embed.canManage', (c: Caller) => c.embed.canManage(org)],
    ['distribution.canManage', (c: Caller) => c.distribution.canManage(org)],
  ] as const)('%s (hides the buttons of the settings pages)', (_name, call) => {
    it.each(['owner', 'admin', 'group_owner', 'group_admin'])('is true for %s', async (role) => {
      await expect(call(callerAs(role))).resolves.toBe(true);
    });
    it.each(['member', 'parent_viewer'])('is false for %s', async (role) => {
      await expect(call(callerAs(role))).resolves.toBe(false);
    });
  });

  describe.each(Object.entries(READS))('%s', (_name, call) => {
    it('is refused without the right to read leads', async () => {
      await expect(call(callerAs(NO_ROLE))).rejects.toEqual(forbidden);
    });
    it.each(['parent_viewer', 'member'])('is allowed to %s', async (role) => {
      expect(await codeOf(call, role)).not.toBe('FORBIDDEN');
    });
  });

  describe.each(Object.entries(COUNTERS))('%s', (_name, call) => {
    it.each(['parent_viewer', NO_ROLE])('is refused to %s', async (role) => {
      await expect(call(callerAs(role))).rejects.toEqual(forbidden);
    });
    it.each(['owner', 'admin', 'group_admin', 'member'])('is allowed to %s', async (role) => {
      expect(await codeOf(call, role)).not.toBe('FORBIDDEN');
    });
  });

  describe.each(Object.entries(SETTINGS_WRITES))('%s', (_name, call) => {
    it.each(['member', 'parent_viewer', NO_ROLE])('is refused to %s', async (role) => {
      await expect(call(callerAs(role))).rejects.toEqual(forbidden);
    });
    it.each(['owner', 'admin', 'group_owner', 'group_admin'])('is allowed to %s', async (role) => {
      expect(await codeOf(call, role)).not.toBe('FORBIDDEN');
    });
  });
});
