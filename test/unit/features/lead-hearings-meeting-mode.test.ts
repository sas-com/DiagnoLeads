/**
 * Hearing meeting mode helpers (Refs #96)
 */
import {
  DEFAULT_HEARING_CATALOG,
  HEARING_REQUIRED_ITEMS,
  type HearingRequiredItem,
} from '@/lib/features/lead-hearings/catalog';
import { computeFormMissingItems } from '@/lib/features/lead-hearings/form';
import {
  defaultHearingEditorMode,
  hasRecordedHearingValues,
  hearingModeStorageKey,
  itemHasStatus,
  meetingProgress,
  otherFieldsBySection,
  parseHearingEditorMode,
  requiredItemFields,
  toggleHearingItemStatus,
} from '@/lib/features/lead-hearings/meeting-mode';
import { describe, expect, it } from 'vitest';

const item = (id: string): HearingRequiredItem => {
  const found = HEARING_REQUIRED_ITEMS.find((i) => i.id === id);
  if (!found) throw new Error(id);
  return found;
};

describe('editor mode', () => {
  it('opens a new hearing (only diagnosis values) in the meeting mode', () => {
    expect(defaultHearingEditorMode({})).toBe('meeting');
    expect(
      defaultHearingEditorMode({
        targetSystem: { value: 'as400', status: 'not_yet', source: 'prefilled' },
      })
    ).toBe('meeting');
  });

  it.each([
    ['a status', { meetingFormat: { status: 'next', source: null } }],
    ['a value entered', { meetingFormat: { value: 'online', status: 'not_yet', source: null } }],
    ['a confirmed value', { targetSystem: { value: 'as400', status: 'not_yet', source: 'confirmed' } }],
  ] as const)('opens a hearing with %s in the detail mode', (_name, fields) => {
    expect(hasRecordedHearingValues(fields)).toBe(true);
    expect(defaultHearingEditorMode(fields)).toBe('detail');
  });

  it('stores the mode per user and reads back only known modes', () => {
    expect(hearingModeStorageKey('u1')).not.toBe(hearingModeStorageKey('u2'));
    expect(hearingModeStorageKey(null)).toBe(hearingModeStorageKey(undefined));
    expect(parseHearingEditorMode('meeting')).toBe('meeting');
    expect(parseHearingEditorMode('detail')).toBe('detail');
    expect(parseHearingEditorMode('tabs')).toBeNull();
    expect(parseHearingEditorMode(null)).toBeNull();
  });
});

describe('meeting layout', () => {
  it('lists the fields of an item in the item order', () => {
    expect(
      requiredItemFields(DEFAULT_HEARING_CATALOG, item('nextMeeting')).map((f) => f.field.key)
    ).toEqual(['nextMeetingDate', 'nextMeetingAttendees']);
  });

  it('puts every field either in a required item or among the others, once', () => {
    const required = DEFAULT_HEARING_CATALOG.requiredItems.flatMap((i) =>
      requiredItemFields(DEFAULT_HEARING_CATALOG, i).map((f) => f.field.key)
    );
    const others = otherFieldsBySection(DEFAULT_HEARING_CATALOG).flatMap((s) =>
      s.fields.map((f) => f.field.key)
    );
    const all = DEFAULT_HEARING_CATALOG.sections.flatMap((s) => s.fields.map((f) => f.field.key));
    expect([...required, ...others].sort()).toEqual([...all].sort());
    expect(others).toContain('meetingFormat');
    expect(others).not.toContain('targetSystem');
  });
});

describe('toggleHearingItemStatus', () => {
  it('sets the status on every key of the item and keeps values', () => {
    const form = toggleHearingItemStatus(
      { nextMeetingAttendees: { value: ['our_sales'], status: 'done', source: null } },
      item('nextMeeting'),
      'next'
    );
    expect(form.nextMeetingDate).toEqual({ status: 'next', source: null });
    expect(form.nextMeetingAttendees).toEqual({
      value: ['our_sales'],
      status: 'next',
      source: null,
    });
    expect(itemHasStatus(form, item('nextMeeting'), 'next')).toBe(true);
  });

  it('takes the status back on a second tap: done with a value, otherwise not yet', () => {
    const once = toggleHearingItemStatus(
      { nextMeetingAttendees: { value: ['our_sales'], status: 'done', source: null } },
      item('nextMeeting'),
      'not_applicable'
    );
    const twice = toggleHearingItemStatus(once, item('nextMeeting'), 'not_applicable');
    expect(twice.nextMeetingDate?.status).toBe('not_yet');
    expect(twice.nextMeetingAttendees?.status).toBe('done');
  });

  it('switches from one quick status to the other', () => {
    const next = toggleHearingItemStatus({}, item('competitors'), 'next');
    const na = toggleHearingItemStatus(next, item('competitors'), 'not_applicable');
    expect(na.competitorTypes?.status).toBe('not_applicable');
  });
});

describe('meetingProgress', () => {
  it('counts filled items; not applicable counts, next time does not', () => {
    let form = toggleHearingItemStatus({}, item('competitors'), 'not_applicable');
    form = toggleHearingItemStatus(form, item('timing'), 'next');
    expect(meetingProgress(computeFormMissingItems(form), HEARING_REQUIRED_ITEMS)).toEqual({
      filled: 1,
      total: 12,
    });
  });
});
