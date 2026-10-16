/**
 * Hearing editor form rules (Refs #84)
 */
import { getHearingField } from '@/lib/features/lead-hearings/catalog';
import {
  changeHearingValue,
  computeFormMissingItems,
  confirmHearingEntry,
  countBySection,
  hearingHintText,
  hearingYearOptions,
  joinYearMonth,
  setHearingLevel,
  setHearingStatus,
  splitYearMonth,
  toDiagnosticLocale,
  toSavedHearingFields,
  toggleHearingOption,
} from '@/lib/features/lead-hearings/form';
import { computeMissingItems } from '@/lib/features/lead-hearings/missing';
import type {
  HearingFields,
  HearingPrefillSnapshot,
} from '@/lib/features/lead-hearings/types/schemas';
import { describe, expect, it } from 'vitest';

const field = (key: string) => {
  const found = getHearingField(key);
  if (!found) throw new Error(key);
  return found;
};

describe('changeHearingValue', () => {
  it('marks a changed diagnosis value as corrected and done', () => {
    const entry = { value: 'as400', status: 'not_yet', source: 'prefilled' } as const;
    expect(changeHearingValue(field('targetSystem'), entry, 'acos', false)).toEqual({
      value: 'acos',
      status: 'done',
      source: 'corrected',
    });
  });

  it('keeps the source when the value did not really change (trailing spaces)', () => {
    const entry = { value: 'abc', status: 'done', source: 'confirmed' } as const;
    expect(changeHearingValue(field('machineModel'), entry, 'abc ', false).source).toBe(
      'confirmed'
    );
  });

  it('marks a typed value done unless the user picked a status', () => {
    const empty = { status: 'not_yet', source: null } as const;
    expect(changeHearingValue(field('machineModel'), empty, 'x', false).status).toBe('done');
    expect(changeHearingValue(field('machineModel'), empty, 'x', true).status).toBe('not_yet');
    const partial = { status: 'partial', source: null } as const;
    expect(changeHearingValue(field('machineModel'), partial, 'x', false).status).toBe('partial');
  });

  it('does not mark a half-entered year-month done', () => {
    const empty = { status: 'not_yet', source: null } as const;
    expect(changeHearingValue(field('hardwareSupportEnd'), empty, '2028-', false).status).toBe(
      'not_yet'
    );
  });
});

describe('confirmHearingEntry', () => {
  it('sets confirmed and done, keeping the value', () => {
    expect(confirmHearingEntry({ value: 'x', status: 'not_yet', source: 'prefilled' })).toEqual({
      value: 'x',
      status: 'done',
      source: 'confirmed',
    });
  });
});

describe('toSavedHearingFields', () => {
  it('leaves out untouched fields and incomplete values, trims text', () => {
    expect(
      toSavedHearingFields({
        machineModel: { value: '  M1 ', status: 'done', source: null },
        hardwareSupportEnd: { value: '2028-', status: 'not_yet', source: null },
        earliestRetirement: { value: '2029-', status: 'partial', source: null },
        scale: { value: { basis: 'as400_programs', bucket: '' }, status: 'next', source: null },
      })
    ).toEqual({
      machineModel: { value: 'M1', status: 'done', source: null },
      earliestRetirement: { status: 'partial', source: null },
      scale: { status: 'next', source: null },
    });
  });
});

describe('hearingHintText', () => {
  const prefill = {
    submissionId: 's',
    diagnosticKey: 'ax-migration',
    diagnosticVersion: 1,
    submittedAt: '2026-10-01T00:00:00Z',
    verified: true,
    answers: { platform: 'as400', business_areas: ['unknown-value'] },
    challenges: null,
    hints: { targetSystem: ['platform'], businessAreas: ['business_areas'] },
  } satisfies HearingPrefillSnapshot;

  it('shows the diagnosis labels, or the stored value when the option is gone', () => {
    expect(hearingHintText(prefill, 'targetSystem', 'ja')).toBe('AS/400（IBM i）');
    expect(hearingHintText(prefill, 'businessAreas', 'ja')).toBe('unknown-value');
    expect(hearingHintText(prefill, 'industry', 'ja')).toBeNull();
    expect(hearingHintText(null, 'targetSystem', 'ja')).toBeNull();
  });
});

describe('setHearingStatus', () => {
  it('changes only the status', () => {
    expect(
      setHearingStatus({ value: 'x', status: 'not_yet', source: 'prefilled' }, 'next')
    ).toEqual({ value: 'x', status: 'next', source: 'prefilled' });
  });
});

describe('input values', () => {
  const options = [{ value: 'a' }, { value: 'b' }, { value: 'c' }];

  it('toggles an option keeping the catalog order, empty as undefined', () => {
    expect(toggleHearingOption(options, ['c'], 'a', true)).toEqual(['a', 'c']);
    expect(toggleHearingOption(options, ['a', 'c'], 'a', false)).toEqual(['c']);
    expect(toggleHearingOption(options, ['a'], 'a', false)).toBeUndefined();
  });

  it('sets and clears a level, empty as undefined', () => {
    expect(setHearingLevel({ people: 'high' }, 'cost', 'low')).toEqual({
      people: 'high',
      cost: 'low',
    });
    expect(setHearingLevel({ people: 'high', cost: 'low' }, 'cost', undefined)).toEqual({
      people: 'high',
    });
    expect(setHearingLevel({ people: 'high' }, 'people', undefined)).toBeUndefined();
  });

  it('splits and joins a year-month, keeping half-entered values', () => {
    expect(splitYearMonth('2028-04')).toEqual({ year: '2028', month: '04' });
    expect(splitYearMonth('2028-')).toEqual({ year: '2028', month: '' });
    expect(splitYearMonth(undefined)).toEqual({ year: '', month: '' });
    expect(joinYearMonth('2028', '04')).toBe('2028-04');
    expect(joinYearMonth('2028', '')).toBe('2028-');
    expect(joinYearMonth(undefined, '04')).toBe('-04');
    expect(joinYearMonth('', undefined)).toBeUndefined();
  });

  it('offers years around this year plus a stored year outside the range', () => {
    const years = hearingYearOptions(2026, '');
    expect(years[0]).toBe(2011);
    expect(years.at(-1)).toBe(2041);
    expect(hearingYearOptions(2026, '1990')[0]).toBe(1990);
  });

  it('falls back to Japanese for diagnosis labels', () => {
    expect(toDiagnosticLocale('en')).toBe('en');
    expect(toDiagnosticLocale('ja')).toBe('ja');
    expect(toDiagnosticLocale('fr')).toBe('ja');
  });
});

describe('computeFormMissingItems', () => {
  it.each<[string, HearingFields]>([
    ['an empty form', {}],
    [
      'half-entered and blank values',
      {
        hardwareSupportEnd: { value: '2028-', status: 'done', source: null },
        machineModel: { value: '   ', status: 'done', source: 'prefilled' },
        targetSystem: { value: 'as400', status: 'done', source: 'prefilled' },
        scale: { value: { basis: 'as400_programs', bucket: '' }, status: 'done', source: null },
      },
    ],
    [
      'statuses without values',
      {
        topChallenge: { status: 'not_applicable', source: null },
        impactIfUnaddressed: { status: 'next', source: null },
        competitorTypes: { value: ['none'], status: 'not_yet', source: 'prefilled' },
        nextMeetingDate: { value: '2026-11-01', status: 'partial', source: 'corrected' },
      },
    ],
  ])('matches the missing items of the saved fields for %s', (_, form) => {
    expect(computeFormMissingItems(form)).toEqual(computeMissingItems(toSavedHearingFields(form)));
  });
});

describe('countBySection', () => {
  it('counts distinct keys per section', () => {
    const counts = countBySection(['targetSystem', 'machineModel', 'targetSystem', 'dealRating']);
    expect(counts.get('currentSystem')).toBe(2);
    expect(counts.get('outcome')).toBe(1);
    expect(counts.has('meeting')).toBe(false);
  });
});
