/**
 * Lead page view models: the diagnosis stored on a lead and the card fields (Refs #107, #109)
 */
import {
  cardOfField,
  isLeadCardId,
  isLeadTab,
  splitCardFields,
  type LeadFieldValues,
} from '@/lib/features/leads/detail-fields';
import { flattenExtraData, readLeadDiagnosis } from '@/lib/features/leads/diagnosis-view';
import { describe, expect, it } from 'vitest';

const SUBMISSION = '44444444-4444-4444-8444-444444444444';
const OTHER_SUBMISSION = '55555555-5555-4555-8555-555555555555';

/** What the AX diagnosis writes on a lead it created (submission-service.ts) */
const axSummary = {
  urgency: 'high',
  platform: 'as400',
  challenges: ['people', 'cost'],
  department: null,
  difficulty: 'low',
  sqlSignals: true,
  diagnosedAt: '2026-10-16T01:30:00.000Z',
  mqlCandidate: true,
  needsHearing: false,
  submissionId: SUBMISSION,
  primaryChallenge: 'people',
  consultationRequested: true,
};

describe('readLeadDiagnosis', () => {
  it('reads every known key of the AX summary', () => {
    const { ax, extra } = readLeadDiagnosis({ axMigration: axSummary });
    expect(ax).toEqual({
      submissionId: SUBMISSION,
      platform: 'as400',
      targetSystem: null,
      difficulty: 'low',
      urgency: 'high',
      primaryChallenge: 'people',
      needsHearing: false,
      diagnosedAt: '2026-10-16T01:30:00.000Z',
      detailsAnsweredAt: null,
      challenges: ['people', 'cost'],
      department: null,
      mqlCandidate: true,
      sqlSignals: true,
      consultationRequested: true,
      otherSystems: [],
    });
    // Nothing left over: no raw data to fall back to
    expect(extra).toEqual([]);
  });

  it('reads the other systems diagnosed from the result screen', () => {
    const { ax } = readLeadDiagnosis({
      axMigration: {
        ...axSummary,
        otherSystems: [
          {
            submissionId: OTHER_SUBMISSION,
            diagnosedAt: '2026-10-16T02:00:00.000Z',
            platform: 'access',
            targetSystem: 'access',
            difficulty: 'medium',
            urgency: 'low',
            primaryChallenge: null,
            needsHearing: true,
          },
        ],
      },
    });
    expect(ax?.otherSystems).toEqual([
      expect.objectContaining({
        submissionId: OTHER_SUBMISSION,
        platform: 'access',
        targetSystem: 'access',
        difficulty: 'medium',
        urgency: 'low',
        primaryChallenge: null,
        needsHearing: true,
      }),
    ]);
  });

  it('treats null, missing and false values as not set', () => {
    const { ax, extra } = readLeadDiagnosis({
      axMigration: {
        submissionId: null,
        platform: null,
        difficulty: null,
        urgency: undefined,
        challenges: null,
        mqlCandidate: false,
        consultationRequested: null,
      },
    });
    expect(ax).toMatchObject({
      submissionId: null,
      platform: null,
      difficulty: null,
      urgency: null,
      challenges: [],
      mqlCandidate: false,
      sqlSignals: false,
      consultationRequested: false,
    });
    expect(extra).toEqual([]);
  });

  it('keeps unknown keys, older data and custom fields as flat key / value text', () => {
    const { ax, extra } = readLeadDiagnosis(
      {
        axMigration: { ...axSummary, legacyScore: 42, difficulty: 'extreme' },
        legacyForm: { q1: 'yes', nested: { flag: true }, list: ['a', 'b'] },
        empty: null,
      },
      { budget: 1000, note: '' }
    );
    // A value of a known key it cannot read (an unknown level) is not lost
    expect(ax?.difficulty).toBeNull();
    expect(extra).toEqual(
      expect.arrayContaining([
        { key: 'axMigration.legacyScore', value: 42 },
        { key: 'axMigration.difficulty', value: 'extreme' },
        { key: 'legacyForm.q1', value: 'yes' },
        { key: 'legacyForm.nested.flag', value: true },
        { key: 'legacyForm.list', value: 'a, b' },
        { key: 'budget', value: 1000 },
      ])
    );
    expect(extra).toHaveLength(6);
    // Never JSON
    for (const entry of extra) expect(String(entry.value)).not.toMatch(/[{[]/);
  });

  it('reads nothing from empty or non-object data', () => {
    expect(readLeadDiagnosis({})).toEqual({ ax: null, extra: [] });
    expect(readLeadDiagnosis(null, null)).toEqual({ ax: null, extra: [] });
    expect(readLeadDiagnosis('text')).toEqual({ ax: null, extra: [{ key: 'responses', value: 'text' }] });
  });

  it('flattens arrays of objects with their position', () => {
    expect(flattenExtraData([{ a: 1 }, { a: 2 }], 'items')).toEqual([
      { key: 'items[1].a', value: 1 },
      { key: 'items[2].a', value: 2 },
    ]);
  });
});

const lead = (overrides: Partial<LeadFieldValues> = {}): LeadFieldValues => ({
  status: 'new',
  name: 'Lead Person',
  company: null,
  email: 'lead@example.com',
  phone: '',
  inflowSource: null,
  agencyName: null,
  acquisitionCost: 0,
  referrerName: null,
  conversionPoint: 'web_diagnosis',
  dealPhase: null,
  targetSystem: null,
  score: null,
  mqlQualifiedAt: null,
  sqlDecision: null,
  lostReason: 'budget',
  ...overrides,
});

describe('splitCardFields', () => {
  it('splits the fields with a value from the empty ones, in display order', () => {
    expect(splitCardFields('contact', lead())).toEqual({
      filled: ['name', 'email'],
      empty: ['company', 'phone'],
    });
    // A cost of 0 is a value
    expect(splitCardFields('inflow', lead()).filled).toEqual(['acquisitionCost', 'conversionPoint']);
  });

  it('shows the lost / on-hold reason only for a lost lead', () => {
    expect(splitCardFields('pipeline', lead()).filled).not.toContain('lostReason');
    expect(splitCardFields('pipeline', lead()).empty).not.toContain('lostReason');
    expect(splitCardFields('pipeline', lead({ status: 'lost' })).filled).toContain('lostReason');
    expect(splitCardFields('pipeline', lead({ status: 'lost', lostReason: null })).empty).toContain(
      'lostReason'
    );
  });

  it('counts a score of 0 and an MQL date as values', () => {
    const { filled } = splitCardFields('pipeline', lead({ score: 0, mqlQualifiedAt: new Date() }));
    expect(filled).toEqual(['score', 'mqlQualified']);
  });
});

describe('URL parameters', () => {
  it('accepts only known tabs, cards and fields', () => {
    expect(isLeadTab('diagnosis')).toBe(true);
    expect(isLeadTab('settings')).toBe(false);
    expect(isLeadCardId('pipeline')).toBe(true);
    expect(isLeadCardId('status')).toBe(false);
    expect(cardOfField('lostReason')).toBe('pipeline');
    expect(cardOfField('email')).toBe('contact');
    expect(cardOfField('responses')).toBeNull();
  });
});
