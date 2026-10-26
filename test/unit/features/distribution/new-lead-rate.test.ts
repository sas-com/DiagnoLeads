/**
 * The new-lead rate of a QR campaign (新規リード率, #700): the one rule the settings page and
 * getCampaignStats both use, from the two counts of the campaign row (owner decisions of
 * 2026-10-26 on #700: "—" without scans, not capped at 100).
 */
import { campaignNewLeadRate } from '@/lib/features/distribution/types';
import { describe, expect, it } from 'vitest';

describe('campaignNewLeadRate (#700)', () => {
  it('is the new leads counted on the campaign over its scans, in percent', () => {
    expect(campaignNewLeadRate({ scanCount: 8, completionCount: 2 })).toBe(25);
    expect(campaignNewLeadRate({ scanCount: 8, completionCount: 3 })).toBe(37.5);
  });

  it('rounds once, to one decimal', () => {
    expect(campaignNewLeadRate({ scanCount: 3, completionCount: 1 })).toBe(33.3);
    expect(campaignNewLeadRate({ scanCount: 3, completionCount: 2 })).toBe(66.7);
  });

  it('is 0 for a campaign with scans and no new lead yet', () => {
    expect(campaignNewLeadRate({ scanCount: 5, completionCount: 0 })).toBe(0);
  });

  it('cannot be computed without scans: null, which the page shows as "—" (not 0%)', () => {
    expect(campaignNewLeadRate({ scanCount: 0, completionCount: 0 })).toBeNull();
  });

  it('cannot be computed without scans also when new leads were counted', () => {
    expect(campaignNewLeadRate({ scanCount: 0, completionCount: 2 })).toBeNull();
  });

  it('is not capped: more new leads than scans show as over 100', () => {
    expect(campaignNewLeadRate({ scanCount: 4, completionCount: 5 })).toBe(125);
  });
});
