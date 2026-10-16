/**
 * Agency link codes, URLs and input schemas (Refs #147)
 */
import {
  AGENCY_CODE_LENGTH,
  AGENCY_CODE_PATTERN,
  buildAgencyLinkUrl,
  createAgencyLinkSchema,
  generateAgencyCode,
} from '@/lib/features/agency-links/types/schemas';
import { describe, expect, it } from 'vitest';

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';

describe('generateAgencyCode', () => {
  it('makes codes of the fixed length without look-alike letters', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateAgencyCode();
      expect(code).toHaveLength(AGENCY_CODE_LENGTH);
      expect(code).toMatch(AGENCY_CODE_PATTERN);
      expect(code).not.toMatch(/[01ilo]/);
    }
  });

  it('does not repeat codes', () => {
    const codes = new Set(Array.from({ length: 1000 }, generateAgencyCode));
    expect(codes.size).toBe(1000);
  });
});

describe('buildAgencyLinkUrl', () => {
  it('points to the AX diagnosis of the locale with the code', () => {
    expect(buildAgencyLinkUrl('https://example.com', 'ja', 'abcdefghjkmn')).toBe(
      'https://example.com/ja/ax-diagnosis?agency=abcdefghjkmn'
    );
  });

  it('ignores a path or trailing slash on the origin', () => {
    expect(buildAgencyLinkUrl('https://example.com/', 'en', 'abcdefghjkmn')).toBe(
      'https://example.com/en/ax-diagnosis?agency=abcdefghjkmn'
    );
  });
});

describe('createAgencyLinkSchema', () => {
  const base = { organizationId: ORG_ID, kind: 'telemarketing_agency' as const };

  it('trims the names and stores an empty campaign as null', () => {
    expect(
      createAgencyLinkSchema.parse({ ...base, agencyName: ' 代行A ', campaign: '  ' })
    ).toEqual({ ...base, agencyName: '代行A', campaign: null });
  });

  it('rejects an empty agency name, control characters and unknown kinds', () => {
    expect(createAgencyLinkSchema.safeParse({ ...base, agencyName: ' ' }).success).toBe(false);
    expect(createAgencyLinkSchema.safeParse({ ...base, agencyName: 'A\nB' }).success).toBe(false);
    expect(
      createAgencyLinkSchema.safeParse({ ...base, agencyName: 'A', campaign: 'x‮y' }).success
    ).toBe(false);
    expect(
      createAgencyLinkSchema.safeParse({ ...base, agencyName: 'A', kind: 'advertising' }).success
    ).toBe(false);
  });
});
