/**
 * Pre-meeting prep card (Refs #156): the draft from the diagnosis and the playbook, which never
 * overwrites what sales wrote, and the input checks. Playbook questions are made up.
 */
import {
  type PrepDraftSource,
  buildPrepDraft,
  draftQuestions,
  hasDraftMaterial,
  isPrepReady,
} from '@/lib/features/lead-prep/draft';
import { type PrepCardFields, prepCardFieldsSchema } from '@/lib/features/lead-prep/types/schemas';
import { describe, expect, it } from 'vitest';

const EMPTY: PrepCardFields = {
  estimatedSystem: null,
  estimatedSystemBasis: null,
  recentNews: null,
  hypotheses: {},
  firstQuestions: [],
};

const source = (values: Partial<PrepDraftSource> = {}): PrepDraftSource => ({
  targetSystem: 'as400',
  targetSystemFrom: 'diagnosis',
  primaryChallenge: 'people',
  challenges: ['people', 'cost'],
  urgencyReasons: ['support_end_soon'],
  difficultyReasons: ['programs_large'],
  playbookQuestions: {
    people: ['質問P1', '質問P2'],
    cost: ['質問C1', '質問C2'],
    data: ['質問D1'],
  },
  ...values,
});

// Echoes the key and values, so the test sees which message would be used
const t = (key: string, values?: Record<string, string>) =>
  values ? `${key}(${Object.values(values).join(',')})` : key;

describe('buildPrepDraft', () => {
  it('fills the system, the hypotheses of the chosen challenges and three questions', () => {
    const draft = buildPrepDraft(EMPTY, source(), t);
    expect(draft.estimatedSystem).toBe('pipeline.targetSystem.as400');
    expect(draft.estimatedSystemBasis).toBe('leadPrep.drafts.basisDiagnosis');
    expect(draft.hypotheses).toEqual({
      people:
        'leadPrep.drafts.primaryWithReasons(axDiagnosis.result.reasons.support_end_soon／axDiagnosis.result.reasons.programs_large)',
      cost: 'leadPrep.drafts.selected',
    });
    // The main challenge's questions first, then the other chosen one; not the unchosen "data"
    expect(draft.firstQuestions).toEqual(['質問P1', '質問P2', '質問C1']);
    expect(draft.recentNews).toBeNull();
  });

  it('never overwrites what sales wrote', () => {
    const written: PrepCardFields = {
      estimatedSystem: '自社開発の Java',
      estimatedSystemBasis: null,
      recentNews: '新工場を建設中',
      hypotheses: { people: '担当者が来年退職' },
      firstQuestions: ['自分で書いた質問'],
    };
    const draft = buildPrepDraft(written, source(), t);
    expect(draft.estimatedSystem).toBe('自社開発の Java');
    // The basis belongs to the system: not drafted for a system sales wrote
    expect(draft.estimatedSystemBasis).toBeNull();
    expect(draft.hypotheses.people).toBe('担当者が来年退職');
    expect(draft.hypotheses.cost).toBe('leadPrep.drafts.selected');
    expect(draft.firstQuestions).toEqual(['自分で書いた質問']);
  });

  it('works without a diagnosis: the lead field and no hypotheses', () => {
    const draft = buildPrepDraft(
      EMPTY,
      source({
        targetSystemFrom: 'lead',
        primaryChallenge: null,
        challenges: [],
        urgencyReasons: [],
        difficultyReasons: [],
        playbookQuestions: {},
      }),
      t
    );
    expect(draft.estimatedSystemBasis).toBe('leadPrep.drafts.basisLead');
    expect(draft.hypotheses).toEqual({});
    expect(draft.firstQuestions).toEqual([]);
  });

  it('writes the main challenge plainly when the diagnosis gave no reasons', () => {
    const draft = buildPrepDraft(
      EMPTY,
      source({ urgencyReasons: [], difficultyReasons: [] }),
      t
    );
    expect(draft.hypotheses.people).toBe('leadPrep.drafts.primary');
  });
});

describe('draftQuestions / hasDraftMaterial / isPrepReady', () => {
  it('takes at most three distinct questions', () => {
    expect(
      draftQuestions(
        source({ playbookQuestions: { people: ['A', 'A', 'B'], cost: ['C', 'D'] } })
      )
    ).toEqual(['A', 'B', 'C']);
  });

  it('knows when there is nothing to draft from', () => {
    expect(hasDraftMaterial(source())).toBe(true);
    expect(
      hasDraftMaterial(
        source({ targetSystem: null, primaryChallenge: null, challenges: [], playbookQuestions: {} })
      )
    ).toBe(false);
  });

  it('is ready once the three first questions are written', () => {
    expect(isPrepReady({ firstQuestions: ['a', 'b', 'c'] })).toBe(true);
    expect(isPrepReady({ firstQuestions: ['a', 'b', ' '] })).toBe(false);
  });
});

describe('prepCardFieldsSchema', () => {
  it('keeps blanks out and limits the questions to three', () => {
    const parsed = prepCardFieldsSchema.parse({
      estimatedSystem: '  ',
      recentNews: ' 新工場 ',
      hypotheses: { people: ' 退職 ', cost: '' },
      firstQuestions: ['a', '', 'b'],
    });
    expect(parsed).toEqual({
      estimatedSystem: null,
      estimatedSystemBasis: null,
      recentNews: '新工場',
      hypotheses: { people: '退職' },
      firstQuestions: ['a', 'b'],
    });
    expect(prepCardFieldsSchema.safeParse({ firstQuestions: ['a', 'b', 'c', 'd'] }).success).toBe(false);
    expect(prepCardFieldsSchema.safeParse({ hypotheses: { unknown: 'x' } }).success).toBe(true);
  });
});
