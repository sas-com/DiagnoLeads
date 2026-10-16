/**
 * Required hearing items: missing / unconfirmed rules (Refs #84).
 */
import { HEARING_REQUIRED_ITEMS } from '@/lib/features/lead-hearings/catalog';
import { computeMissingItems } from '@/lib/features/lead-hearings/missing';
import type { HearingFieldEntry, HearingFields } from '@/lib/features/lead-hearings/types/schemas';
import { describe, expect, it } from 'vitest';

const ALL_IDS = HEARING_REQUIRED_ITEMS.map((i) => i.id);
const entry = (overrides: Partial<HearingFieldEntry>): HearingFieldEntry => ({
  status: 'done',
  source: null,
  ...overrides,
});

describe('computeMissingItems', () => {
  it('reports every required item for an empty hearing', () => {
    const result = computeMissingItems({});
    expect(result.missing).toEqual(ALL_IDS);
    expect(result.unconfirmed).toEqual([]);
  });

  it('counts a done value as filled', () => {
    const result = computeMissingItems({ topChallenge: entry({ value: 'people' }) });
    expect(result.missing).not.toContain('topChallenge');
  });

  it('counts "partial" with a value as filled', () => {
    const result = computeMissingItems({
      impactIfUnaddressed: entry({ status: 'partial', value: 'x' }),
    });
    expect(result.missing).not.toContain('impact');
  });

  it('counts "not applicable" as filled even without a value', () => {
    const result = computeMissingItems({ hardwareSupportEnd: entry({ status: 'not_applicable' }) });
    expect(result.missing).not.toContain('supportEnd');
  });

  it.each(['next', 'not_yet'] as const)('counts "%s" as missing even with a value', (status) => {
    const result = computeMissingItems({ topChallenge: entry({ status, value: 'people' }) });
    expect(result.missing).toContain('topChallenge');
    expect(result.missingKeys).toContain('topChallenge');
  });

  it('counts "done" without a value as missing', () => {
    const result = computeMissingItems({
      businessAreas: entry({ value: [] }),
      impactIfUnaddressed: entry({}),
    });
    expect(result.missing).toContain('businessAreas');
    expect(result.missing).toContain('impact');
  });

  it('needs every key of an item', () => {
    const fields: HearingFields = { nextMeetingDate: entry({ value: '2026-11-01' }) };
    const result = computeMissingItems(fields);
    expect(result.missing).toContain('nextMeeting');
    expect(result.missingKeys).toContain('nextMeetingAttendees');
    expect(result.missingKeys).not.toContain('nextMeetingDate');
  });

  it('reports values still taken from the diagnosis as unconfirmed', () => {
    const result = computeMissingItems({
      attendeeRoles: entry({ value: ['executive'], source: 'prefilled' }),
      directionTiming: entry({ value: '1_2y', source: 'confirmed' }),
      targetSystem: entry({ value: 'as400', source: 'corrected' }),
      industry: entry({ value: 'manufacturing', source: 'prefilled' }),
    });
    // industry is not a required item
    expect(result.unconfirmed).toEqual(['attendeeRoles']);
    expect(result.unconfirmedKeys).toEqual(['attendeeRoles']);
    expect(result.missing).not.toContain('attendeeRoles');
    expect(result.missing).not.toContain('timing');
  });

  it('takes a replacement list of required items', () => {
    const result = computeMissingItems({}, [
      { id: 'only', labelKey: 'x', keys: ['dealRating'] },
    ]);
    expect(result.missing).toEqual(['only']);
  });
});
