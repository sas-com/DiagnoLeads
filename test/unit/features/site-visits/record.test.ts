import type { Database } from '@/lib/db/client';
import { siteVisitSalts, siteVisits } from '@/lib/db/schema';
import { sitePageOf } from '@/lib/features/site-visits/pages';
import {
  SITE_VISIT_DAILY_CAP,
  SITE_VISIT_RATE_LIMIT,
  SITE_VISIT_RATE_LIMIT_48,
  addressLimitsOf,
  recordSiteVisit,
} from '@/lib/features/site-visits/record';
import { visitParamsOf } from '@/lib/features/site-visits/request';
import { forgetDaySaltForTests } from '@/lib/features/site-visits/visitor';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The order of the refusals of one view and the salt kept by the server (#412). The rules
// themselves run against PostgreSQL in test/unit/integration/site-visits.db.test.ts

const { consumeRateLimit, consumeRateLimits, findPublicDiagnosis } = vi.hoisted(() => ({
  consumeRateLimit: vi.fn(),
  consumeRateLimits: vi.fn(),
  findPublicDiagnosis: vi.fn(),
}));
vi.mock('@/lib/features/diagnostics/rate-limit', () => ({ consumeRateLimit, consumeRateLimits }));
vi.mock('@/lib/features/diagnosis-builder/public-diagnosis', () => ({ findPublicDiagnosis }));
vi.mock('@/lib/features/diagnostics/organization', () => ({
  resolveDiagnosisOrganizationId: () => 'org-operator',
}));

const CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';

/** Just enough of the database for the salt and the view: counts what is asked of it */
function fakeDb() {
  const asked = { saltInserts: 0, saltReads: 0, saltDeletes: 0, views: [] as unknown[] };
  const db = {
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        if (table === siteVisits) {
          asked.views.push(values);
          return Promise.resolve();
        }
        expect(table).toBe(siteVisitSalts);
        asked.saltInserts++;
        return { onConflictDoNothing: () => Promise.resolve() };
      },
    }),
    select: () => {
      asked.saltReads++;
      return { from: () => ({ where: () => Promise.resolve([{ salt: 'salt-of-the-day' }]) }) };
    },
    delete: () => {
      asked.saltDeletes++;
      return { where: () => Promise.resolve() };
    },
  };
  return { db: db as unknown as Database, asked };
}

const view = (
  db: Database,
  path: string,
  overrides: Partial<{ ip: string; now: Date }> = {}
) => {
  const page = sitePageOf(path);
  if (!page) throw new Error(`not measured: ${path}`);
  return recordSiteVisit(db, {
    page,
    params: visitParamsOf(''),
    referrerHost: null,
    ip: overrides.ip ?? '203.0.113.5',
    userAgent: CHROME,
    now: overrides.now ?? new Date('2026-10-23T03:00:00Z'),
  });
};

describe('addressLimitsOf', () => {
  it('counts an IPv4 address by itself', () => {
    const limits = addressLimitsOf('salt', '203.0.113.5');
    expect(limits.map(({ rule }) => rule)).toEqual([SITE_VISIT_RATE_LIMIT]);
    expect(limits[0].identifier).not.toContain('203.0.113');
  });

  it('counts an IPv6 address by its /64, then by its /48', () => {
    const limits = addressLimitsOf('salt', '2001:db8:1:2::5');
    expect(limits.map(({ rule }) => rule)).toEqual([SITE_VISIT_RATE_LIMIT, SITE_VISIT_RATE_LIMIT_48]);
    const sameSlash64 = addressLimitsOf('salt', '2001:db8:1:2:aaaa::9');
    const otherSlash64 = addressLimitsOf('salt', '2001:0db8:0001:00ff::1');
    const otherSlash48 = addressLimitsOf('salt', '2001:db8:3:2::5');
    expect(sameSlash64.map(({ identifier }) => identifier)).toEqual(
      limits.map(({ identifier }) => identifier)
    );
    expect(otherSlash64[0].identifier).not.toBe(limits[0].identifier);
    expect(otherSlash64[1].identifier).toBe(limits[1].identifier);
    expect(otherSlash48[1].identifier).not.toBe(limits[1].identifier);
  });

  it('changes with the salt of the day', () => {
    expect(addressLimitsOf('salt-2', '203.0.113.5')[0].identifier).not.toBe(
      addressLimitsOf('salt', '203.0.113.5')[0].identifier
    );
  });
});

describe('recordSiteVisit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    forgetDaySaltForTests();
    consumeRateLimits.mockResolvedValue({ allowed: true });
    consumeRateLimit.mockResolvedValue({ allowed: true, count: 1, retryAfterSeconds: 60 });
    findPublicDiagnosis.mockResolvedValue({ organizationId: 'org-builder' });
  });

  it('records a view within the limits', async () => {
    const { db, asked } = fakeDb();
    expect(await view(db, '/ja/ax-migration')).toBe('recorded');
    expect(asked.views).toEqual([
      expect.objectContaining({ organizationId: 'org-operator', day: '2026-10-23' }),
    ]);
    expect(consumeRateLimit).toHaveBeenCalledWith(
      db,
      SITE_VISIT_DAILY_CAP,
      'org-operator:2026-10-23',
      expect.any(Date)
    );
  });

  it('refuses past the address limits before looking up the diagnosis or counting the cap', async () => {
    consumeRateLimits.mockResolvedValue({ allowed: false, rule: 'site-visit-48', retryAfterSeconds: 60 });
    const { db, asked } = fakeDb();
    expect(await view(db, '/ja/d/dx-check')).toBe('rate_limited');
    expect(findPublicDiagnosis).not.toHaveBeenCalled();
    expect(consumeRateLimit).not.toHaveBeenCalled();
    expect(asked.views).toEqual([]);
  });

  it('flags the one view past the daily cap and writes none past it', async () => {
    const { db, asked } = fakeDb();
    consumeRateLimit.mockResolvedValueOnce({
      allowed: false,
      count: SITE_VISIT_DAILY_CAP.limit + 1,
      retryAfterSeconds: 60,
    });
    consumeRateLimit.mockResolvedValueOnce({
      allowed: false,
      count: SITE_VISIT_DAILY_CAP.limit + 2,
      retryAfterSeconds: 60,
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await view(db, '/ja/d/dx-check')).toBe('daily_cap_reached');
    expect(await view(db, '/ja/d/dx-check')).toBe('daily_cap');
    expect(asked.views).toEqual([]);
    expect(consumeRateLimit).toHaveBeenCalledWith(
      db,
      SITE_VISIT_DAILY_CAP,
      'org-builder:2026-10-23',
      expect.any(Date)
    );
    // Logged once, with the organization and the day only
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('203.0.113.5');
    warn.mockRestore();
  });

  it('applies only the daily cap without a trusted address', async () => {
    const { db } = fakeDb();
    expect(await view(db, '/ja/ax-migration', { ip: '' })).toBe('recorded');
    expect(consumeRateLimits).not.toHaveBeenCalled();
    expect(consumeRateLimit).toHaveBeenCalledTimes(1);
  });

  it('reads the salt from the database once a day, refused views included', async () => {
    const { db, asked } = fakeDb();
    await view(db, '/ja/ax-migration');
    consumeRateLimits.mockResolvedValue({ allowed: false, rule: 'site-visit', retryAfterSeconds: 60 });
    await view(db, '/ja/ax-migration');
    await view(db, '/ja/ax-migration');
    expect(asked).toMatchObject({ saltInserts: 1, saltReads: 1, saltDeletes: 1 });

    // The next day (in Japan) makes or reads that day's salt, and deletes the past ones
    await view(db, '/ja/ax-migration', { now: new Date('2026-10-23T15:00:00Z') });
    expect(asked).toMatchObject({ saltInserts: 2, saltReads: 2, saltDeletes: 2 });
  });

  it('does not count a column that does not exist', async () => {
    const { db, asked } = fakeDb();
    expect(await view(db, '/ja/ax-migration/column/made-up-column')).toBe('unknown_page');
    expect(asked.saltReads).toBe(0);
    expect(consumeRateLimits).not.toHaveBeenCalled();
  });
});
