/**
 * The public QR entry (/q/<code>, #503): which campaigns answer, and where the visitor is sent.
 * The SQL (case, organization of the diagnosis) is checked against PostgreSQL in
 * test/unit/integration/qr-short-code-entry.db.test.ts.
 */
import { generateShortCode } from '@/lib/features/distribution/qr-code';
import {
  findOpenQrCampaign,
  isCampaignOpen,
  qrEntryRedirectPath,
} from '@/lib/features/distribution/short-code-entry';
import { SHORT_CODE_PATTERN } from '@/lib/features/distribution/types';
import { describe, expect, it, vi } from 'vitest';

const NOW = new Date('2026-10-24T10:00:00Z');
const UTM = { source: 'qrcode', medium: 'offline', campaign: 'fair-2026', content: 'booth' };

describe('isCampaignOpen', () => {
  it('answers while the campaign is active and has no end', () => {
    expect(isCampaignOpen({ isActive: true, expiresAt: null }, NOW)).toBe(true);
  });

  it('does not answer a paused campaign', () => {
    expect(isCampaignOpen({ isActive: false, expiresAt: null }, NOW)).toBe(false);
  });

  it('answers until the end, not from it', () => {
    const before = new Date(NOW.getTime() + 1);
    expect(isCampaignOpen({ isActive: true, expiresAt: before }, NOW)).toBe(true);
    expect(isCampaignOpen({ isActive: true, expiresAt: NOW }, NOW)).toBe(false);
    expect(isCampaignOpen({ isActive: true, expiresAt: new Date('2026-10-01T00:00:00Z') }, NOW)).toBe(
      false
    );
  });

  it('does not answer a paused campaign before its end either', () => {
    expect(isCampaignOpen({ isActive: false, expiresAt: new Date('2027-01-01') }, NOW)).toBe(false);
  });
});

describe('qrEntryRedirectPath', () => {
  it("sends to the AX diagnosis with the campaign's UTM parameters when there is no published diagnosis", () => {
    expect(qrEntryRedirectPath(UTM, null)).toBe(
      '/ja/ax-diagnosis?utm_source=qrcode&utm_medium=offline&utm_campaign=fair-2026&utm_content=booth'
    );
  });

  it('sends to the public page of the published builder diagnosis', () => {
    expect(qrEntryRedirectPath(UTM, 'cloud-readiness')).toBe(
      '/ja/d/cloud-readiness?utm_source=qrcode&utm_medium=offline&utm_campaign=fair-2026&utm_content=booth'
    );
  });

  it('leaves out the empty UTM parameters', () => {
    expect(qrEntryRedirectPath({ ...UTM, campaign: null, content: '' }, null)).toBe(
      '/ja/ax-diagnosis?utm_source=qrcode&utm_medium=offline'
    );
  });

  it('keeps the parameters in the query, whatever they contain', () => {
    const path = qrEntryRedirectPath(
      { ...UTM, campaign: '展示会 2026&ref=x', content: '/../admin?' },
      null
    );
    const url = new URL(path, 'https://app.example');
    expect(url.pathname).toBe('/ja/ax-diagnosis');
    expect(url.searchParams.get('utm_campaign')).toBe('展示会 2026&ref=x');
    expect(url.searchParams.get('utm_content')).toBe('/../admin?');
    expect(url.searchParams.has('ref')).toBe(false);
  });

  it('is always a path of this app, so the visitor stays on the host', () => {
    for (const slug of [null, 'cloud-readiness']) {
      const path = qrEntryRedirectPath(UTM, slug);
      expect(path.startsWith('/ja/')).toBe(true);
      expect(new URL(path, 'https://app.example').host).toBe('app.example');
    }
    // A slug is a path segment, never more
    expect(qrEntryRedirectPath(UTM, '/evil.example')).toMatch(/^\/ja\/d\/%2Fevil\.example\?/);
  });

  it('uses the language it is given', () => {
    expect(qrEntryRedirectPath(UTM, null, 'en')).toMatch(/^\/en\/ax-diagnosis\?/);
  });
});

describe('SHORT_CODE_PATTERN', () => {
  it('accepts every code generateShortCode makes', () => {
    for (let i = 0; i < 200; i++) expect(SHORT_CODE_PATTERN.test(generateShortCode(8))).toBe(true);
  });

  it('refuses what cannot be a code', () => {
    for (const code of ['', 'abc-def', 'abc/def', '../x', 'abc def', 'abc%2F', 'Ａbc', 'a'.repeat(65)]) {
      expect(SHORT_CODE_PATTERN.test(code), code).toBe(false);
    }
  });
});

describe('findOpenQrCampaign', () => {
  /** A database that answers the one select with these rows */
  function dbAnswering(rows: unknown[]) {
    const chain = {
      from: vi.fn(() => chain),
      leftJoin: vi.fn(() => chain),
      where: vi.fn(() => chain),
      limit: vi.fn(async () => rows),
    };
    return { select: vi.fn(() => chain) };
  }

  const ROW = {
    id: 'c1',
    organizationId: 'org-a',
    isActive: true,
    expiresAt: null,
    utmSource: 'qrcode',
    utmMedium: 'offline',
    utmCampaign: 'fair-2026',
    utmContent: null,
    diagnosisId: null,
    diagnosisSlug: null,
  };

  it('does not ask the database for what cannot be a code', async () => {
    const db = dbAnswering([ROW]);
    // biome-ignore lint/suspicious/noExplicitAny: fake database
    expect(await findOpenQrCampaign(db as any, 'ab/cd', NOW)).toBeNull();
    expect(db.select).not.toHaveBeenCalled();
  });

  it("returns the campaign's organization, UTM parameters and diagnosis", async () => {
    const db = dbAnswering([{ ...ROW, diagnosisId: 'd1', diagnosisSlug: 'cloud-readiness' }]);
    // biome-ignore lint/suspicious/noExplicitAny: fake database
    expect(await findOpenQrCampaign(db as any, 'AbCd2345', NOW)).toEqual({
      campaignId: 'c1',
      organizationId: 'org-a',
      diagnosis: { id: 'd1', slug: 'cloud-readiness' },
      utm: { source: 'qrcode', medium: 'offline', campaign: 'fair-2026', content: null },
    });
  });

  it('has no diagnosis when the campaign has none in its organization', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: fake database
    const campaign = await findOpenQrCampaign(dbAnswering([ROW]) as any, 'AbCd2345', NOW);
    expect(campaign?.diagnosis).toBeNull();
  });

  it('finds nothing for an unknown, paused or expired code', async () => {
    const cases = [[], [{ ...ROW, isActive: false }], [{ ...ROW, expiresAt: new Date('2026-10-01') }]];
    for (const rows of cases) {
      // biome-ignore lint/suspicious/noExplicitAny: fake database
      expect(await findOpenQrCampaign(dbAnswering(rows) as any, 'AbCd2345', NOW)).toBeNull();
    }
  });
});
