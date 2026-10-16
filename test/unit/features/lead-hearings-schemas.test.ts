/**
 * Lead hearing schemas: strict input, tolerant read of stored rows (Refs #84).
 */
import {
  createLeadHearingSchema,
  hearingFieldsSchema,
  parseStoredHearingFields,
  updateLeadHearingSchema,
} from '@/lib/features/lead-hearings/types/schemas';
import { describe, expect, it } from 'vitest';

const ORG_ID = '660e8400-e29b-41d4-a716-446655440000';
const ID = '990e8400-e29b-41d4-a716-446655440000';

const ok = (value: unknown) => ({ value, status: 'done', source: null });

describe('hearingFieldsSchema', () => {
  it('accepts a valid value for each field type', () => {
    const fields = {
      meetingFormat: ok('online'),
      attendeeRoles: ok(['executive', 'it_staff']),
      machineModel: ok('Model X'),
      scale: { value: { basis: 'acos_programs', bucket: '1000_2999' }, status: 'partial', source: 'corrected' },
      earliestRetirement: ok('2028-03'),
      challengeLevels: ok({ people: 'high', data: 'low' }),
      fiscalYearEndMonth: ok(3),
      nextMeetingDate: ok('2026-11-30'),
      outcomeNotes: { status: 'next', source: null },
      industry: { value: 'manufacturing', status: 'not_yet', source: 'prefilled' },
    };
    expect(hearingFieldsSchema.safeParse(fields).success).toBe(true);
  });

  it.each([
    ['an unknown key', { secretQuestion: ok('x') }],
    ['an unknown option', { meetingFormat: ok('carrier_pigeon') }],
    ['duplicate options', { attendeeRoles: ok(['executive', 'executive']) }],
    ['an empty multiple choice', { attendeeRoles: ok([]) }],
    ['an invalid month', { earliestRetirement: ok('2028-13') }],
    ['an invalid date', { nextMeetingDate: ok('2026-02-30') }],
    ['a number out of range', { fiscalYearEndMonth: ok(13) }],
    ['a fractional number', { fiscalYearEndMonth: ok(3.5) }],
    ['text that is too long', { machineModel: ok('x'.repeat(201)) }],
    ['a blank text', { impactIfUnaddressed: ok('   ') }],
    ['a bucket of another basis', { scale: ok({ basis: 'as400_programs', bucket: 'gte10000' }) }],
    ['an unknown level item', { challengeLevels: ok({ morale: 'high' }) }],
    ['an unknown status', { industry: { value: 'other', status: 'maybe', source: null } }],
    ['an unknown source', { industry: { value: 'other', status: 'done', source: 'guess' } }],
    ['a missing source', { industry: { value: 'other', status: 'done' } }],
    ['an extra entry key', { industry: { ...ok('other'), note: 'x' } }],
  ])('rejects %s', (_label, fields) => {
    expect(hearingFieldsSchema.safeParse(fields).success).toBe(false);
  });
});

describe('API input', () => {
  it('rejects unknown keys on create', () => {
    const base = { organizationId: ORG_ID, leadId: ID, heldOn: '2026-10-16' };
    expect(createLeadHearingSchema.safeParse(base).success).toBe(true);
    expect(createLeadHearingSchema.safeParse({ ...base, fields: {} }).success).toBe(false);
  });

  it('requires expectedUpdatedAt on update', () => {
    const base = { organizationId: ORG_ID, id: ID, heldOn: '2026-10-16', fields: {} };
    expect(updateLeadHearingSchema.safeParse(base).success).toBe(false);
    expect(
      updateLeadHearingSchema.safeParse({ ...base, expectedUpdatedAt: new Date() }).success
    ).toBe(true);
  });
});

describe('parseStoredHearingFields', () => {
  it('drops retired keys and invalid values and reports them', () => {
    const { fields, droppedKeys } = parseStoredHearingFields({
      industry: ok('distribution'),
      retiredField: ok('x'),
      meetingFormat: ok('retired_option'),
      dealRating: 'a',
    });
    expect(fields).toEqual({ industry: ok('distribution') });
    expect(droppedKeys).toEqual(['retiredField', 'meetingFormat', 'dealRating']);
  });

  it.each([null, 'x', [1, 2]])('reads %o as no fields', (raw) => {
    expect(parseStoredHearingFields(raw)).toEqual({ fields: {}, droppedKeys: [] });
  });
});
