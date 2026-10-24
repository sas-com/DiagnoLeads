import {
  LEAD_STATUSES,
  leadPipelineFieldsSchema,
  makesLostOnHold,
  normalizeLeadStatus,
  qualificationUpdateFields,
  statusUpdateFields,
} from '@/lib/features/leads/types/pipeline';
import { describe, expect, it } from 'vitest';

describe('LEAD_STATUSES', () => {
  it('defines the 5-stage pipeline in order', () => {
    expect(LEAD_STATUSES).toEqual(['new', 'nurturing', 'negotiating', 'won', 'lost']);
  });
});

describe('statusUpdateFields', () => {
  it('turns the negotiated flag on for negotiating and won', () => {
    expect(statusUpdateFields('negotiating')).toEqual({ status: 'negotiating', hasNegotiated: true });
    expect(statusUpdateFields('won')).toEqual({ status: 'won', hasNegotiated: true });
  });

  it('never writes the flag as false (so it cannot be cleared)', () => {
    expect(statusUpdateFields('new')).toEqual({ status: 'new' });
    expect(statusUpdateFields('nurturing')).toEqual({ status: 'nurturing' });
    expect(statusUpdateFields('lost')).toEqual({ status: 'lost' });
  });

  it('does not record any SQL judgement', () => {
    expect(statusUpdateFields('negotiating')).not.toHaveProperty('sqlDecidedAt');
  });
});

describe('qualificationUpdateFields', () => {
  const now = new Date('2026-10-09T00:00:00Z');
  const earlier = new Date('2026-09-01T00:00:00Z');
  const empty = { mqlQualifiedAt: null, sqlDecision: null, sqlDecidedAt: null };

  it('writes nothing when no judgement is given', () => {
    expect(qualificationUpdateFields({}, empty, now)).toEqual({});
  });

  it('records the MQL date once and keeps it on re-confirmation', () => {
    expect(qualificationUpdateFields({ mqlQualified: true }, empty, now)).toEqual({
      mqlQualifiedAt: now,
    });
    expect(
      qualificationUpdateFields({ mqlQualified: true }, { ...empty, mqlQualifiedAt: earlier }, now)
    ).toEqual({ mqlQualifiedAt: earlier });
    expect(qualificationUpdateFields({ mqlQualified: false }, { ...empty, mqlQualifiedAt: earlier }, now)).toEqual({
      mqlQualifiedAt: null,
    });
  });

  it('records the SQL decision with its date', () => {
    expect(qualificationUpdateFields({ sqlDecision: 'qualified' }, null, now)).toEqual({
      sqlDecision: 'qualified',
      sqlDecidedAt: now,
    });
  });

  it('keeps the date when the same decision is saved again', () => {
    const existing = { ...empty, sqlDecision: 'qualified', sqlDecidedAt: earlier };
    expect(qualificationUpdateFields({ sqlDecision: 'qualified' }, existing, now).sqlDecidedAt).toBe(earlier);
  });

  it('re-dates a changed decision and clears it when reset', () => {
    const existing = { ...empty, sqlDecision: 'qualified', sqlDecidedAt: earlier };
    expect(qualificationUpdateFields({ sqlDecision: 'not_qualified' }, existing, now)).toEqual({
      sqlDecision: 'not_qualified',
      sqlDecidedAt: now,
    });
    expect(qualificationUpdateFields({ sqlDecision: null }, existing, now)).toEqual({
      sqlDecision: null,
      sqlDecidedAt: null,
    });
  });
});

describe('normalizeLeadStatus', () => {
  it('maps legacy values', () => {
    expect(normalizeLeadStatus('contacted')).toBe('nurturing');
    expect(normalizeLeadStatus('qualified')).toBe('negotiating');
    expect(normalizeLeadStatus('converted')).toBe('won');
  });

  it('trims and lowercases current values', () => {
    expect(normalizeLeadStatus(' Won ')).toBe('won');
  });

  it('passes non-string values through', () => {
    expect(normalizeLeadStatus(undefined)).toBeUndefined();
  });
});

describe('leadPipelineFieldsSchema', () => {
  it('accepts the sales flow values', () => {
    const result = leadPipelineFieldsSchema.parse({
      inflowSource: 'referral_partner',
      conversionPoint: 'web_diagnosis',
      dealPhase: 'simple_diagnosis',
      targetSystem: 'access',
      referrerName: 'Partner Inc.',
      lostReason: null,
      sqlDecision: 'not_qualified',
    });
    expect(result.dealPhase).toBe('simple_diagnosis');
    expect(result.lostReason).toBeNull();
  });

  it('rejects unknown values', () => {
    expect(() => leadPipelineFieldsSchema.parse({ dealPhase: 'closing' })).toThrow();
    expect(() => leadPipelineFieldsSchema.parse({ targetSystem: 'windows' })).toThrow();
    expect(() => leadPipelineFieldsSchema.parse({ sqlDecision: 'maybe' })).toThrow();
  });
});

describe('makesLostOnHold (#445)', () => {
  const nurturingOnHold = { status: 'nurturing', lostReason: 'on_hold' };
  const lostOnHold = { status: 'lost', lostReason: 'on_hold' };

  it('refuses a new lead lost on hold', () => {
    expect(makesLostOnHold(null, { status: 'lost', lostReason: 'on_hold' })).toBe(true);
    expect(makesLostOnHold(undefined, { status: 'lost', lostReason: 'timing' })).toBe(false);
    expect(makesLostOnHold(null, { status: 'nurturing', lostReason: 'on_hold' })).toBe(false);
  });

  it('refuses moving a lead on hold to lost, or giving a lost lead the reason on hold', () => {
    expect(makesLostOnHold(nurturingOnHold, { status: 'lost' })).toBe(true);
    expect(makesLostOnHold({ status: 'lost', lostReason: 'budget' }, { lostReason: 'on_hold' })).toBe(
      true
    );
  });

  it('allows putting a lead on hold while nurturing, and leaving lost with another reason', () => {
    expect(makesLostOnHold({ status: 'new', lostReason: null }, nurturingOnHold)).toBe(false);
    expect(makesLostOnHold(nurturingOnHold, { status: 'lost', lostReason: 'timing' })).toBe(false);
    expect(makesLostOnHold(lostOnHold, { lostReason: null })).toBe(false);
    expect(makesLostOnHold(lostOnHold, { status: 'nurturing' })).toBe(false);
  });

  it('lets a lead lost on hold before #445 be saved while it stays so', () => {
    expect(makesLostOnHold(lostOnHold, { status: 'lost' })).toBe(false);
    expect(makesLostOnHold(lostOnHold, {})).toBe(false);
  });
});
