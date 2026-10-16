/**
 * Hearing prefill from a diagnosis made in the builder (Refs #121). The AX prefill keeps its own
 * tests (lead-hearings-prefill.test.ts). Fictional diagnosis only.
 */
import type { DiagnosisDefinition } from '@/lib/features/diagnosis-builder/definition';
import { hearingHintText } from '@/lib/features/lead-hearings/form';
import {
  type BuilderPrefillSubmission,
  buildBuilderHearingPrefill,
} from '@/lib/features/lead-hearings/prefill';
import { describe, expect, it } from 'vitest';
import { cloudReadiness } from '../../fixtures/diagnosis-builder';

function definition(): DiagnosisDefinition {
  const def = cloudReadiness();
  for (const question of def.questions) {
    if (question.id === 'migration_plan') {
      question.hearingField = {
        key: 'directionTiming',
        values: { none: 'undecided', later: '1_2y', this_year: 'within_1y' },
      };
    }
    // Same id as an AX question would not matter: labels come from this definition
    if (question.id === 'hosting') {
      question.hearingField = { key: 'businessAreas', values: { onprem: 'sales' } };
    }
    if (question.id === 'notes') question.hearingField = { key: 'challengeNotes' };
  }
  return def;
}

const submission = (
  answers: Record<string, unknown>,
  extra: Partial<BuilderPrefillSubmission> = {}
): BuilderPrefillSubmission => ({
  id: '11111111-1111-4111-8111-111111111111',
  diagnosticKey: 'd:22222222-2222-4222-8222-222222222222',
  diagnosticVersion: 3,
  answers,
  result: { overall: 40 },
  leadCreated: true,
  continuedFromSubmissionId: null,
  createdAt: new Date('2026-10-16T01:00:00Z'),
  definition: definition(),
  ...extra,
});

describe('buildBuilderHearingPrefill', () => {
  it('fills the mapped fields as prefilled values to confirm', () => {
    const { fields, snapshot } = buildBuilderHearingPrefill(
      submission({
        hosting: 'onprem',
        team_size: 150,
        migration_plan: 'this_year',
        confidence: 4,
        notes: '担当者が退職予定',
      })
    );
    expect(fields).toEqual({
      directionTiming: { value: 'within_1y', status: 'not_yet', source: 'prefilled' },
      businessAreas: { value: ['sales'], status: 'not_yet', source: 'prefilled' },
      challengeNotes: { value: '担当者が退職予定', status: 'not_yet', source: 'prefilled' },
    });
    expect(snapshot).toMatchObject({
      submissionId: '11111111-1111-4111-8111-111111111111',
      diagnosticKey: 'd:22222222-2222-4222-8222-222222222222',
      diagnosticVersion: 3,
      submittedAt: '2026-10-16T01:00:00.000Z',
      verified: true,
      challenges: null,
      diagnosisTitle: 'クラウド準備度チェック（テスト用）',
      // Only the mapped questions are copied
      answers: { hosting: 'onprem', migration_plan: 'this_year', notes: '担当者が退職予定' },
      hints: {
        businessAreas: ['hosting'],
        directionTiming: ['migration_plan'],
        challengeNotes: ['notes'],
      },
    });
    expect(snapshot.answerLabels?.migration_plan).toEqual({ this_year: '今年中' });
  });

  it('keeps the hint but no value when the answer has no hearing value', () => {
    const { fields, snapshot } = buildBuilderHearingPrefill(submission({ hosting: 'cloud' }));
    expect(fields.businessAreas).toBeUndefined();
    expect(snapshot.hints.businessAreas).toEqual(['hosting']);
    expect(hearingHintText(snapshot, 'businessAreas', 'ja')).toBe('クラウド');
  });

  it('labels hints from the answered version, never from the AX diagnosis', () => {
    const { snapshot } = buildBuilderHearingPrefill(submission({ migration_plan: 'later' }));
    expect(hearingHintText(snapshot, 'directionTiming', 'ja')).toBe('来年以降');
    expect(hearingHintText(snapshot, 'directionTiming', 'en')).toBe('来年以降');
  });

  it('uses the same verification rule as the AX diagnosis', () => {
    const matched = buildBuilderHearingPrefill(
      submission({ migration_plan: 'later' }, { leadCreated: false })
    );
    expect(matched.snapshot.verified).toBe(false);
    // Unverified answers are still offered, as with the AX diagnosis
    expect(matched.fields.directionTiming?.value).toBe('1_2y');
    const continued = buildBuilderHearingPrefill(
      submission(
        {},
        { leadCreated: false, continuedFromSubmissionId: '33333333-3333-4333-8333-333333333333' }
      )
    );
    expect(continued.snapshot.verified).toBe(true);
  });

  it('gives nothing for a definition without mappings, and ignores malformed answers', () => {
    const plain = buildBuilderHearingPrefill(
      submission({ migration_plan: 'this_year' }, { definition: cloudReadiness() })
    );
    expect(plain.fields).toEqual({});
    expect(plain.snapshot.hints).toEqual({});
    const odd = buildBuilderHearingPrefill(submission({ migration_plan: { a: 1 }, notes: 5 }));
    expect(odd.fields).toEqual({});
  });

  it('takes the first answered question when two fill the same field', () => {
    const def = definition();
    for (const q of def.questions) {
      if (q.id === 'hosting') {
        q.hearingField = { key: 'directionTiming', values: { onprem: 'undecided' } };
      }
    }
    const { fields, snapshot } = buildBuilderHearingPrefill(
      submission({ hosting: 'onprem', migration_plan: 'this_year' }, { definition: def })
    );
    expect(fields.directionTiming?.value).toBe('undecided');
    expect(snapshot.hints.directionTiming).toEqual(['hosting', 'migration_plan']);
  });
});
