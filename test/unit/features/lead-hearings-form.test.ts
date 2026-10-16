/**
 * Hearing editor form rules (Refs #84)
 */
import { getHearingField } from '@/lib/features/lead-hearings/catalog';
import {
  changeHearingValue,
  confirmHearingEntry,
  hearingHintText,
  toSavedHearingFields,
} from '@/lib/features/lead-hearings/form';
import type { HearingPrefillSnapshot } from '@/lib/features/lead-hearings/types/schemas';
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
