/**
 * Hearing input helpers of #130: the "other" note (schema, save, summary), typed dates and the
 * number display. Uses catalog keys and generic values only.
 */
import {
  DEFAULT_HEARING_CATALOG,
  HEARING_FIELDS,
  HEARING_OTHER_NOTE_MAX_LENGTH,
  getHearingField,
  hasOtherOption,
  isOtherOption,
} from '@/lib/features/lead-hearings/catalog';
import {
  changeHearingOtherNote,
  changeHearingValue,
  formatTypedDate,
  fromIsoDate,
  parseTypedDate,
  toIsoDate,
  toSavedHearingFields,
} from '@/lib/features/lead-hearings/form';
import { buildHearingSummary, hearingValueText } from '@/lib/features/lead-hearings/summary';
import { hearingSummaryLabels } from '@/lib/features/lead-hearings/summary-messages';
import {
  type HearingFields,
  hearingFieldsSchema,
  parseStoredHearingFields,
} from '@/lib/features/lead-hearings/types/schemas';
import { describe, expect, it } from 'vitest';

const field = (key: string) => {
  const found = getHearingField(key);
  if (!found) throw new Error(`no field ${key}`);
  return found;
};

describe('"other" options', () => {
  it('recognises "other" and "other_*" option keys only', () => {
    expect(isOtherOption('other')).toBe(true);
    expect(isOtherOption('other_integrator')).toBe(true);
    expect(isOtherOption('others')).toBe(false);
    expect(isOtherOption('mother')).toBe(false);
  });

  it('finds the choice fields that have one', () => {
    const keys = HEARING_FIELDS.filter((f) => hasOtherOption(f)).map((f) => f.key);
    expect(keys).toEqual(
      expect.arrayContaining(['attendeeRoles', 'targetSystem', 'pastBlockers', 'competitorTypes'])
    );
    expect(keys).not.toContain('meetingFormat');
    expect(keys).not.toContain('machineModel');
  });
});

describe('otherNote in the schema', () => {
  it('accepts a note next to a chosen "other" option, trimmed', () => {
    const parsed = hearingFieldsSchema.parse({
      attendeeRoles: { value: ['other'], status: 'done', source: null, otherNote: '  note A ' },
      competitorTypes: {
        value: ['other_integrator'],
        status: 'done',
        source: null,
        otherNote: 'note B',
      },
    });
    expect(parsed.attendeeRoles?.otherNote).toBe('note A');
    expect(parsed.competitorTypes?.otherNote).toBe('note B');
  });

  it('rejects a note without "other", on a field without "other", blank or too long', () => {
    const save = (fields: unknown) => hearingFieldsSchema.safeParse(fields).success;
    expect(
      save({
        attendeeRoles: { value: ['executive'], status: 'done', source: null, otherNote: 'x' },
      })
    ).toBe(false);
    expect(
      save({ meetingFormat: { value: 'online', status: 'done', source: null, otherNote: 'x' } })
    ).toBe(false);
    expect(
      save({ attendeeRoles: { value: ['other'], status: 'done', source: null, otherNote: '  ' } })
    ).toBe(false);
    expect(
      save({
        attendeeRoles: {
          value: ['other'],
          status: 'done',
          source: null,
          otherNote: 'a'.repeat(HEARING_OTHER_NOTE_MAX_LENGTH + 1),
        },
      })
    ).toBe(false);
    expect(
      save({
        attendeeRoles: {
          value: ['other'],
          status: 'done',
          source: null,
          otherNote: 'a'.repeat(HEARING_OTHER_NOTE_MAX_LENGTH),
        },
      })
    ).toBe(true);
  });

  it('reads hearings stored without notes as before, and stored notes', () => {
    const old = parseStoredHearingFields({
      attendeeRoles: { value: ['other'], status: 'done', source: null },
      targetSystem: { value: 'as400', status: 'done', source: 'confirmed' },
    });
    expect(old.droppedKeys).toEqual([]);
    expect(old.fields.attendeeRoles).toEqual({ value: ['other'], status: 'done', source: null });

    const withNote = parseStoredHearingFields({
      targetSystem: { value: 'other', status: 'done', source: null, otherNote: 'note C' },
    });
    expect(withNote.droppedKeys).toEqual([]);
    expect(withNote.fields.targetSystem?.otherNote).toBe('note C');
  });
});

describe('otherNote in the form', () => {
  const roles = field('attendeeRoles');

  it('keeps the note while the value changes, and saves it only with "other" chosen', () => {
    let entry = changeHearingValue(roles, { status: 'not_yet', source: null }, ['other'], false);
    entry = changeHearingOtherNote(entry, ' note A ');
    expect(toSavedHearingFields({ attendeeRoles: entry }).attendeeRoles).toEqual({
      value: ['other'],
      status: 'done',
      source: null,
      otherNote: 'note A',
    });

    // "other" unchosen: the note stays in the form but is not saved
    entry = changeHearingValue(roles, entry, ['executive'], false);
    expect(entry.otherNote).toBe(' note A ');
    expect(toSavedHearingFields({ attendeeRoles: entry }).attendeeRoles).toEqual({
      value: ['executive'],
      status: 'done',
      source: null,
    });

    // Chosen again: the note comes back
    entry = changeHearingValue(roles, entry, ['executive', 'other'], false);
    expect(toSavedHearingFields({ attendeeRoles: entry }).attendeeRoles?.otherNote).toBe('note A');
  });

  it('does not treat a note as a correction of the diagnosis value', () => {
    const entry = changeHearingOtherNote(
      { value: ['other'], status: 'not_yet', source: 'prefilled' },
      'note A'
    );
    expect(entry).toEqual({
      value: ['other'],
      status: 'not_yet',
      source: 'prefilled',
      otherNote: 'note A',
    });
    expect(changeHearingOtherNote(entry, undefined)).not.toHaveProperty('otherNote');
  });
});

describe('otherNote in the summary', () => {
  const ja = hearingSummaryLabels('ja');
  const en = hearingSummaryLabels('en');
  const roles = field('attendeeRoles');

  it('writes the note after the "other" label only', () => {
    const plain = hearingValueText(roles, ['executive', 'other'], ja) ?? '';
    const noted = hearingValueText(roles, ['executive', 'other'], ja, 'note A') ?? '';
    expect(noted.startsWith(plain)).toBe(true);
    expect(noted.endsWith('（note A）')).toBe(true);
    expect(hearingValueText(roles, ['other'], en, 'note A')).toMatch(/ \(note A\)$/);
    // A note left without "other" is not shown
    expect(hearingValueText(roles, ['executive'], ja, 'note A')).not.toContain('note A');
  });

  it('shows the note in the summary item and counts a changed note as a change', () => {
    const fields: HearingFields = {
      targetSystem: { value: 'other', status: 'done', source: null, otherNote: 'note B' },
    };
    const previous = {
      heldOn: '2026-10-01',
      fields: {
        targetSystem: { value: 'other', status: 'done', source: null, otherNote: 'note A' },
      } as HearingFields,
    };
    const summary = buildHearingSummary(
      { heldOn: '2026-10-16', fields },
      DEFAULT_HEARING_CATALOG,
      ja,
      previous
    );
    const item = summary.sections.flatMap((s) => s.items).find((i) => i.key === 'targetSystem');
    expect(item?.value).toContain('note B');
    expect(summary.changedSincePrevious).toEqual([
      expect.objectContaining({
        key: 'targetSystem',
        before: expect.stringContaining('note A'),
        after: expect.stringContaining('note B'),
      }),
    ]);
  });
});

describe('number display', () => {
  it('shows a month number as a month', () => {
    const fiscal = field('fiscalYearEndMonth');
    expect(hearingValueText(fiscal, 3, hearingSummaryLabels('ja'))).toBe('3月');
  });
});

describe('typed dates', () => {
  it.each([
    ['2026-10-20', '2026-10-20'],
    ['2026/10/20', '2026-10-20'],
    ['2026/1/5', '2026-01-05'],
    ['2026.10.20', '2026-10-20'],
    ['2026年10月20日', '2026-10-20'],
    ['20261020', '2026-10-20'],
    ['２０２６／１０／２０', '2026-10-20'],
    [' 2026-10-20 ', '2026-10-20'],
  ])('reads %s', (text, iso) => {
    expect(parseTypedDate(text)).toBe(iso);
  });

  it('tells a blank box from an invalid date', () => {
    expect(parseTypedDate('  ')).toBeUndefined();
    expect(parseTypedDate('2026-02-30')).toBeNull();
    expect(parseTypedDate('2026-13-01')).toBeNull();
    expect(parseTypedDate('2026/10')).toBeNull();
    expect(parseTypedDate('tomorrow')).toBeNull();
  });

  it('shows and converts dates without moving the day', () => {
    expect(formatTypedDate('2026-10-20', 'ja')).toBe('2026/10/20');
    expect(formatTypedDate('2026-10-20', 'en')).toBe('2026-10-20');
    expect(toIsoDate(new Date(2026, 0, 31))).toBe('2026-01-31');
    expect(fromIsoDate('2026-01-31')?.getDate()).toBe(31);
    expect(fromIsoDate('2026-02-30')).toBeUndefined();
    expect(fromIsoDate(undefined)).toBeUndefined();
  });
});
