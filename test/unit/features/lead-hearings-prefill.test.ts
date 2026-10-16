/**
 * Hearing prefill from the AX Web diagnosis: one test per mapping row (Refs #84).
 */
import { type PrefillSubmission, buildHearingPrefill } from '@/lib/features/lead-hearings/prefill';
import { describe, expect, it } from 'vitest';

const SUBMISSION_ID = '880e8400-e29b-41d4-a716-446655440000';

function submission(
  answers: Record<string, string | string[]>,
  extra: Partial<PrefillSubmission> = {}
): PrefillSubmission {
  return {
    id: SUBMISSION_ID,
    diagnosticKey: 'ax-migration',
    diagnosticVersion: 2,
    answers,
    result: {},
    leadCreated: true,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    ...extra,
  };
}

const prefilled = (value: unknown) => ({ value, status: 'not_yet', source: 'prefilled' });

describe('buildHearingPrefill', () => {
  it('fills the employee count from the company size question (#150)', () => {
    const { fields } = buildHearingPrefill(submission({ platform: 'as400', employees: '50_299' }));
    expect(fields.employeeCount).toEqual(prefilled('50_299'));
    const unknown = buildHearingPrefill(submission({ platform: 'as400', employees: 'unknown' }));
    expect(unknown.fields.employeeCount).toBeUndefined();
  });

  it('keeps a snapshot of the submission with only the questions the hearing reads', () => {
    const { snapshot } = buildHearingPrefill(
      submission({ platform: 'as400', gaiji: 'many', role: 'it_manager' })
    );
    expect(snapshot).toMatchObject({
      submissionId: SUBMISSION_ID,
      diagnosticKey: 'ax-migration',
      diagnosticVersion: 2,
      submittedAt: '2026-10-01T00:00:00.000Z',
      verified: true,
      answers: { platform: 'as400', role: 'it_manager' },
      challenges: null,
    });
    expect(snapshot.answers).not.toHaveProperty('gaiji');
  });

  it('flags a submission that did not create the lead as unverified', () => {
    const { snapshot } = buildHearingPrefill(submission({}, { leadCreated: false }));
    expect(snapshot.verified).toBe(false);
  });

  it('treats another system diagnosed from the lead\'s own result screen as verified (#67)', () => {
    const { snapshot } = buildHearingPrefill(
      submission({}, { leadCreated: false, continuedFromSubmissionId: 'first-submission' })
    );
    expect(snapshot.verified).toBe(true);
  });

  it('role → attendeeRoles', () => {
    const { fields, snapshot } = buildHearingPrefill(submission({ role: 'executive' }));
    expect(fields.attendeeRoles).toEqual(prefilled(['executive']));
    expect(snapshot.hints.attendeeRoles).toEqual(['role']);
  });

  it('industry → industry', () => {
    expect(buildHearingPrefill(submission({ industry: 'manufacturing' })).fields.industry).toEqual(
      prefilled('manufacturing')
    );
  });

  it.each([
    [{ platform: 'as400' }, 'as400'],
    [{ platform: 'acos' }, 'acos'],
    [{ platform: 'access' }, 'access'],
    [{ platform: 'other', other_system: 'vb' }, 'vb'],
    [{ platform: 'other', other_system: 'webperformer' }, 'webperformer'],
    [{ platform: 'other', other_system: 'office_computer' }, 'other_legacy'],
    [{ platform: 'other', other_system: 'mainframe' }, 'other_legacy'],
    [{ platform: 'other', other_system: 'package' }, 'package'],
    [{ platform: 'other', other_system: 'other_low_code' }, 'other'],
    [{ platform: 'other', other_system: 'unknown' }, 'unknown'],
  ])('platform / other_system %o → targetSystem %s', (answers, expected) => {
    expect(buildHearingPrefill(submission(answers)).fields.targetSystem).toEqual(
      prefilled(expected)
    );
  });

  it('acos_series / as400_version → only a hint for machineModel', () => {
    const acos = buildHearingPrefill(submission({ platform: 'acos', acos_series: 'acos4' }));
    expect(acos.fields.machineModel).toBeUndefined();
    expect(acos.snapshot.hints.machineModel).toEqual(['acos_series']);
    const as400 = buildHearingPrefill(submission({ platform: 'as400', as400_version: 'v73_74' }));
    expect(as400.snapshot.hints.machineModel).toEqual(['as400_version']);
  });

  it.each([
    ['as400', 'as400_programs', '500_1999'],
    ['acos', 'acos_programs', 'gte10000'],
    ['other', 'other_programs', 'lt300'],
    ['access', 'access_screens_forms', '20_50'],
  ])('%s size question %s → scale', (platform, question, bucket) => {
    const { fields } = buildHearingPrefill(submission({ platform, [question]: bucket }));
    expect(fields.scale).toEqual(prefilled({ basis: question, bucket }));
  });

  it('an unknown size leaves the scale empty with a hint', () => {
    const { fields, snapshot } = buildHearingPrefill(
      submission({ platform: 'as400', as400_programs: 'unknown' })
    );
    expect(fields.scale).toBeUndefined();
    expect(snapshot.hints.scale).toEqual(['as400_programs']);
  });

  it('business_areas → businessAreas, without "unknown"', () => {
    expect(
      buildHearingPrefill(submission({ business_areas: ['sales', 'accounting'] })).fields
        .businessAreas
    ).toEqual(prefilled(['sales', 'accounting']));
    expect(
      buildHearingPrefill(submission({ business_areas: ['unknown'] })).fields.businessAreas
    ).toBeUndefined();
  });

  it.each([
    [{ maintenance: 'vendor' }, 'none', 'yes'],
    [{ maintenance: 'none' }, 'none', 'no'],
    [{ maintenance: 'few' }, undefined, undefined],
    [{ access_maintainer: 'one' }, 'one', undefined],
    [{ access_maintainer: 'nobody' }, 'none', 'no'],
    [{ access_maintainer: 'vendor' }, undefined, 'yes'],
    [{ access_maintainer: 'team' }, undefined, undefined],
  ])('maintenance %o → inHouseExperts %s / vendorSupport %s', (answers, experts, vendor) => {
    const { fields, snapshot } = buildHearingPrefill(submission(answers));
    expect(fields.inHouseExperts).toEqual(experts ? prefilled(experts) : undefined);
    expect(fields.vendorSupport).toEqual(vendor ? prefilled(vendor) : undefined);
    expect(snapshot.hints.inHouseExperts).toEqual(Object.keys(answers));
  });

  it('maintenance "retiring" → a hint for the earliest retirement', () => {
    const { fields, snapshot } = buildHearingPrefill(submission({ maintenance: 'retiring' }));
    expect(fields.earliestRetirement).toBeUndefined();
    expect(snapshot.hints.earliestRetirement).toEqual(['maintenance']);
  });

  it('support_end / access_version → only a hint for the support end', () => {
    const { fields, snapshot } = buildHearingPrefill(
      submission({ support_end: 'within_1y', access_version: ['le2013'] })
    );
    expect(fields.hardwareSupportEnd).toBeUndefined();
    expect(snapshot.hints.hardwareSupportEnd).toEqual(['support_end', 'access_version']);
  });

  it('result challenges.selected → a hint for the challenge levels', () => {
    const { fields, snapshot } = buildHearingPrefill(
      submission(
        { challenges: ['people', 'cost'] },
        { result: { challenges: { primary: 'people', selected: ['people', 'cost'] } } }
      )
    );
    expect(fields.challengeLevels).toBeUndefined();
    expect(snapshot.hints.challengeLevels).toEqual(['challenges']);
    expect(snapshot.challenges).toEqual({ primary: 'people', selected: ['people', 'cost'] });
  });

  it('result challenges.primary → topChallenge (none when there is no primary)', () => {
    const withPrimary = buildHearingPrefill(
      submission({}, { result: { challenges: { primary: 'data', selected: ['data'] } } })
    );
    expect(withPrimary.fields.topChallenge).toEqual(prefilled('data'));
    const withoutPrimary = buildHearingPrefill(
      submission({}, { result: { challenges: { primary: null, selected: [] } } })
    );
    expect(withoutPrimary.fields.topChallenge).toBeUndefined();
  });

  it('challenge answers → a hint for the challenge notes', () => {
    const { fields, snapshot } = buildHearingPrefill(
      submission({ access_challenges: ['manual', 'remote'] })
    );
    expect(fields.challengeNotes).toBeUndefined();
    expect(snapshot.hints.challengeNotes).toEqual(['access_challenges']);
  });

  it('timeline → directionTiming', () => {
    expect(buildHearingPrefill(submission({ timeline: '1_2y' })).fields.directionTiming).toEqual(
      prefilled('1_2y')
    );
  });

  it('leaves out answers that are not options of the hearing field', () => {
    const { fields } = buildHearingPrefill(
      submission({ industry: 'retired_value', timeline: 'someday' })
    );
    expect(fields).toEqual({});
  });
});
