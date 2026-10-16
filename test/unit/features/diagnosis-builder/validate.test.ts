/**
 * Diagnosis builder: definition checks (one test per error / warning code)
 */
import {
  type DiagnosisDefinition,
  type DiagnosisQuestion,
  emptyDiagnosisDefinition,
} from '@/lib/features/diagnosis-builder/definition';
import {
  type DefinitionErrorCode,
  estimateSeconds,
  validateDefinition,
} from '@/lib/features/diagnosis-builder/validate';
import { describe, expect, it } from 'vitest';
import { cloudReadiness } from '../../../fixtures/diagnosis-builder';

const errorsOf = (def: unknown) => validateDefinition(def).errors;
const codes = (def: unknown) => errorsOf(def).map((e) => e.code);
const warningCodes = (def: unknown) => validateDefinition(def).warnings.map((w) => w.code);

/** Errors with the given code, as `path → detail` for readable assertions */
const find = (def: unknown, code: DefinitionErrorCode) =>
  errorsOf(def).filter((e) => e.code === code);

const scoredSingle = (id: string): DiagnosisQuestion => ({
  id,
  type: 'single',
  label: id,
  required: true,
  options: [
    { value: 'a', label: 'a', scores: { infra: 1 } },
    { value: 'b', label: 'b', scores: { infra: 0 } },
  ],
});

/** Add questions to the first section */
const withQuestions = (def: DiagnosisDefinition, questions: DiagnosisQuestion[]) => {
  def.questions.push(...questions);
  def.sections[0].questionIds.push(...questions.map((q) => q.id));
  return def;
};

describe('validateDefinition', () => {
  it('accepts the fixture without errors or warnings', () => {
    const result = validateDefinition(cloudReadiness());
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.definition?.title).toBe(cloudReadiness().title);
  });

  describe('shape and size', () => {
    it('schema_invalid: reports the zod path and issue code', () => {
      const def = { ...cloudReadiness(), schemaVersion: 2 };
      expect(errorsOf(def)).toEqual([
        { path: ['schemaVersion'], code: 'schema_invalid', detail: 'invalid_literal' },
      ]);
    });

    it('schema_invalid: colors are hex only (no free CSS)', () => {
      const def = cloudReadiness();
      def.tierSets[0].tiers[0].color = 'red; background:url(x)';
      expect(find(def, 'schema_invalid')[0].path).toEqual(['tierSets', 0, 'tiers', 0, 'color']);
    });

    it('schema_invalid: file questions do not exist', () => {
      const def = cloudReadiness() as unknown as { questions: Record<string, unknown>[] };
      def.questions[5] = { id: 'notes', type: 'file', label: 'x', required: false };
      expect(codes(def)).toContain('schema_invalid');
    });

    it('too_many_questions: more than 60 (its own code, not schema_invalid)', () => {
      const sixty = withQuestions(
        cloudReadiness(),
        Array.from({ length: 54 }, (_, i) => scoredSingle(`extra_${i}`))
      );
      expect(codes(sixty)).toEqual([]);
      const def = withQuestions(sixty, [scoredSingle('extra_54')]);
      expect(errorsOf(def)).toEqual([
        { path: ['questions'], code: 'too_many_questions', detail: '61' },
      ]);
    });

    it('definition_too_large: above 200KB serialized', () => {
      const def = { ...cloudReadiness(), padding: 'x'.repeat(200 * 1024) };
      expect(errorsOf(def)).toEqual([{ path: [], code: 'definition_too_large' }]);
    });

    it('duplicate_id', () => {
      const def = cloudReadiness();
      def.axes.push({ id: 'infra', name: 'again', weight: 1 });
      expect(find(def, 'duplicate_id')).toEqual([
        { path: ['axes', 2, 'id'], code: 'duplicate_id', detail: 'infra' },
      ]);
    });

    it('duplicate_id: option values within a question', () => {
      const def = cloudReadiness();
      const hosting = def.questions[0];
      if (hosting.type !== 'single') throw new Error('fixture');
      hosting.options[1].value = 'onprem';
      expect(find(def, 'duplicate_id')[0].path).toEqual(['questions', 0, 'options', 1, 'value']);
    });
  });

  describe('references', () => {
    it('unknown_question: a section lists a missing question', () => {
      const def = cloudReadiness();
      def.sections[3].questionIds.push('ghost');
      expect(find(def, 'unknown_question')[0]).toMatchObject({
        path: ['sections', 3, 'questionIds', 2],
        detail: 'ghost',
      });
    });

    it('unknown_question: a lead score rule refers to a missing question', () => {
      const def = cloudReadiness();
      def.leadScore.rules[0].when.conditions[0] = { type: 'number', questionId: 'ghost', min: 1 };
      expect(find(def, 'unknown_question')[0].path).toEqual([
        'leadScore',
        'rules',
        0,
        'when',
        'conditions',
        0,
        'questionId',
      ]);
    });

    it('unknown_option: in a section condition, a rule condition and exclusiveOptions', () => {
      const def = cloudReadiness();
      def.sections[1].showWhen = { questionId: 'hosting', anyOf: ['onprem', 'mainframe'] };
      def.mql.strongSignals[0].when.conditions[0] = {
        type: 'answer',
        questionId: 'migration_plan',
        anyOf: ['someday'],
      };
      const practices = def.questions[3];
      if (practices.type !== 'multiple') throw new Error('fixture');
      practices.exclusiveOptions = ['nothing'];
      expect(find(def, 'unknown_option').map((e) => e.detail)).toEqual([
        'mainframe',
        'nothing',
        'someday',
      ]);
    });

    it('unknown_axis: option scores, tier sets and score blocks', () => {
      const def = cloudReadiness();
      const hosting = def.questions[0];
      if (hosting.type !== 'single') throw new Error('fixture');
      hosting.options[0].scores = { culture: 1 };
      def.tierSets[1].axisId = 'culture';
      def.resultBlocks.push({ type: 'score', axisId: 'culture' });
      expect(find(def, 'unknown_axis').map((e) => e.path)).toEqual([
        ['questions', 0, 'options', 0, 'scores', 'culture'],
        ['tierSets', 1, 'axisId'],
        ['resultBlocks', 6, 'axisId'],
      ]);
    });

    it('unknown_tier_set and unknown_tier', () => {
      const def = cloudReadiness();
      def.resultTypes[0].when.conditions[0] = { type: 'tier', tierSetId: 'ghost', anyOf: ['high'] };
      def.resultTypes[1].when.conditions.push({
        type: 'tier',
        tierSetId: 'overall',
        anyOf: ['top'],
      });
      def.resultBlocks[3] = { type: 'tierText', tierSetId: 'overall', texts: { top: 'x' } };
      expect(codes(def)).toEqual(['unknown_tier_set', 'unknown_tier', 'unknown_tier']);
    });

    it('unknown_result_type: a block shown only for a missing type', () => {
      const def = cloudReadiness();
      def.resultBlocks[4].onlyFor = ['ghost'];
      expect(find(def, 'unknown_result_type')[0].path).toEqual(['resultBlocks', 4, 'onlyFor', 0]);
    });
  });

  describe('order and reachability', () => {
    it('condition_forward_reference: a section depends on a later question', () => {
      const def = cloudReadiness();
      // "plan" now comes before the section that asks about hosting
      def.sections = [def.sections[1], def.sections[0], def.sections[2], def.sections[3]];
      expect(find(def, 'condition_forward_reference')).toEqual([
        {
          path: ['sections', 0, 'showWhen', 'questionId'],
          code: 'condition_forward_reference',
          detail: 'hosting',
        },
      ]);
      // ...so its question can never be shown
      expect(codes(def)).toContain('unreachable_question');
    });

    it('condition_forward_reference: a section depends on its own question', () => {
      const def = cloudReadiness();
      def.sections[1].questionIds.push('hosting');
      def.sections[0].questionIds = ['team_size'];
      expect(codes(def)).toContain('condition_forward_reference');
    });

    it('condition_question_type: sections branch on single-choice answers only', () => {
      const def = cloudReadiness();
      def.sections[3].showWhen = { questionId: 'team_size', anyOf: ['x'] };
      expect(find(def, 'condition_question_type')[0].path).toEqual([
        'sections',
        3,
        'showWhen',
        'questionId',
      ]);
    });

    it('condition_question_type: answer conditions need a choice, number conditions a number', () => {
      const def = cloudReadiness();
      def.leadScore.rules[0].when.conditions[0] = {
        type: 'answer',
        questionId: 'notes',
        anyOf: ['a'],
      };
      def.leadScore.rules[1].when.conditions[0] = { type: 'number', questionId: 'hosting', min: 1 };
      expect(codes(def)).toEqual(['condition_question_type', 'condition_question_type']);
    });

    it('unreachable_section: no value can show it', () => {
      const def = cloudReadiness();
      def.sections[2].showWhen = { questionId: 'hosting', anyOf: [] };
      expect(find(def, 'unreachable_section')).toEqual([
        { path: ['sections', 2], code: 'unreachable_section', detail: 'practices' },
      ]);
      expect(find(def, 'unreachable_question')[0].detail).toBe('practices');
    });

    it('unreachable_section: depends on a question that is itself never shown', () => {
      const def = cloudReadiness();
      def.sections[2].showWhen = { questionId: 'hosting', anyOf: [] };
      def.sections.push({
        id: 'deeper',
        title: 'deeper',
        questionIds: [],
        showWhen: { questionId: 'hosting', anyOf: ['cloud'] },
      });
      // "deeper" is fine: hosting is in "basics", which is always shown
      expect(find(def, 'unreachable_section').map((e) => e.detail)).toEqual(['practices']);

      def.sections.push({
        id: 'after_plan',
        title: 'after plan',
        questionIds: [],
        showWhen: { questionId: 'practices', anyOf: ['iac'] },
      });
      // practices is a multiple-choice question
      expect(codes(def)).toContain('condition_question_type');
    });

    it('unreachable_question: listed in no section', () => {
      const def = cloudReadiness();
      def.questions.push(scoredSingle('orphan'));
      expect(find(def, 'unreachable_question')).toEqual([
        { path: ['questions', 6], code: 'unreachable_question', detail: 'orphan' },
      ]);
    });

    it('unreachable_result_type: after a type that always matches', () => {
      const def = cloudReadiness();
      def.resultTypes.push({ id: 'never', name: 'never', when: { match: 'all', conditions: [] } });
      expect(find(def, 'unreachable_result_type')).toEqual([
        { path: ['resultTypes', 3], code: 'unreachable_result_type', detail: 'never' },
      ]);
    });
  });

  describe('questions', () => {
    it('too_few_options: choice questions need at least 2', () => {
      const def = cloudReadiness();
      const hosting = def.questions[0];
      if (hosting.type !== 'single') throw new Error('fixture');
      hosting.options = hosting.options.slice(0, 1);
      expect(find(def, 'too_few_options')[0].path).toEqual(['questions', 0, 'options']);
    });

    it('invalid_range: scale and number questions, bands and conditions', () => {
      const def = cloudReadiness();
      const confidence = def.questions[4];
      const team = def.questions[1];
      if (confidence.type !== 'scale' || team.type !== 'number_range') throw new Error('fixture');
      confidence.min = 5;
      confidence.max = 5;
      team.bands = [{ min: 0, max: 5, scores: { people: 1 } }];
      def.leadScore.rules[0].when.conditions[0] = {
        type: 'number',
        questionId: 'team_size',
        min: 10,
        max: 5,
      };
      expect(find(def, 'invalid_range').map((e) => e.path)).toEqual([
        ['questions', 1, 'bands', 0],
        ['questions', 4],
        ['leadScore', 'rules', 0, 'when', 'conditions', 0],
      ]);
    });

    it('band_overlap: bands share a number', () => {
      const def = cloudReadiness();
      const team = def.questions[1];
      if (team.type !== 'number_range') throw new Error('fixture');
      team.bands = [
        { min: 10, max: 99, scores: { people: 2 } },
        { min: 1, max: 10, scores: { people: 0 } },
      ];
      expect(find(def, 'band_overlap')).toEqual([
        { path: ['questions', 1, 'bands', 0], code: 'band_overlap' },
      ]);
    });

    it('axes_missing', () => {
      const def = cloudReadiness();
      def.axes = [];
      expect(codes(def)).toContain('axes_missing');
    });
  });

  describe('tiers', () => {
    const withTiers = (ranges: [number, number][]) => {
      const def = cloudReadiness();
      def.tierSets[0].tiers = ranges.map(([minPct, maxPct], i) => ({
        id: ['low', 'mid', 'high'][i] ?? `t${i}`,
        name: `t${i}`,
        color: '#000000',
        minPct,
        maxPct,
      }));
      return def;
    };

    it('accepts adjacent tiers in any order', () => {
      expect(
        errorsOf(
          withTiers([
            [70, 100],
            [0, 40],
            [40, 70],
          ])
        )
      ).toEqual([]);
      // a single tier covering everything is fine too
      expect(codes(withTiers([[0, 100]])).filter((c) => c.startsWith('tier_'))).toEqual([]);
    });

    it('tier_gap: in the middle, at 0 and at 100', () => {
      expect(
        find(
          withTiers([
            [0, 40],
            [41, 100],
          ]),
          'tier_gap'
        )
      ).toEqual([{ path: ['tierSets', 0, 'tiers', 1], code: 'tier_gap', detail: '40' }]);
      expect(find(withTiers([[10, 100]]), 'tier_gap')[0].detail).toBe('0');
      expect(find(withTiers([[0, 99]]), 'tier_gap')[0].detail).toBe('99');
      expect(find(withTiers([]), 'tier_gap')).toHaveLength(1);
    });

    it('tier_overlap', () => {
      expect(
        find(
          withTiers([
            [0, 40],
            [39, 100],
          ]),
          'tier_overlap'
        )
      ).toEqual([{ path: ['tierSets', 0, 'tiers', 1], code: 'tier_overlap', detail: '39' }]);
    });

    it('tier_range_invalid: empty or reversed range', () => {
      expect(
        find(
          withTiers([
            [0, 50],
            [50, 50],
            [50, 100],
          ]),
          'tier_range_invalid'
        )[0].path
      ).toEqual(['tierSets', 0, 'tiers', 1]);
    });

    it('duplicate_tier_target: two tier sets for the overall score', () => {
      const def = cloudReadiness();
      def.tierSets.push({ ...structuredClone(def.tierSets[0]), id: 'overall_again' });
      expect(find(def, 'duplicate_tier_target')[0].path).toEqual(['tierSets', 2]);
    });
  });

  describe('publishing requirements', () => {
    it('consent_missing: no consent or an empty text', () => {
      const def = cloudReadiness();
      def.consent = undefined;
      expect(find(def, 'consent_missing')).toEqual([
        { path: ['consent'], code: 'consent_missing' },
      ]);
      const blank = cloudReadiness();
      if (!blank.consent) throw new Error('fixture');
      blank.consent.text = '   ';
      expect(codes(blank)).toEqual(['consent_missing']);
    });

    it.each(['http://example.com/contact', 'javascript:alert(1)', 'ftp://example.com/x'])(
      'url_not_https: CTA %s',
      (url) => {
        const def = cloudReadiness();
        def.resultBlocks[5] = { type: 'cta', label: 'go', url };
        expect(find(def, 'url_not_https')).toEqual([
          { path: ['resultBlocks', 5, 'url'], code: 'url_not_https' },
        ]);
      }
    );

    it('url_not_https: privacy policy link', () => {
      const def = cloudReadiness();
      if (!def.consent) throw new Error('fixture');
      def.consent.privacyPolicyUrl = 'http://example.com/privacy';
      expect(codes(def)).toEqual(['url_not_https']);
    });
  });

  describe('warnings', () => {
    it('many_questions: above 12, not at 12', () => {
      const twelve = withQuestions(
        cloudReadiness(),
        Array.from({ length: 6 }, (_, i) => scoredSingle(`extra_${i}`))
      );
      expect(warningCodes(twelve)).toEqual([]);
      const thirteen = withQuestions(twelve, [scoredSingle('extra_6')]);
      expect(validateDefinition(thirteen).warnings).toEqual([
        { path: ['questions'], code: 'many_questions', detail: '13' },
      ]);
      expect(validateDefinition(thirteen).errors).toEqual([]);
    });

    it('long_estimated_time: above 5 minutes, not at 5 minutes', () => {
      const text = (id: string): DiagnosisQuestion => ({
        id,
        type: 'text',
        label: id,
        required: false,
        maxLength: 100,
      });
      // fixture: 10 + 12 + 10 + 15 + 8 + 45 = 100 seconds
      expect(estimateSeconds(cloudReadiness())).toBe(100);
      const def = cloudReadiness();
      def.sections[3].questionIds.push('t1', 't2', 't3', 't4');
      def.questions.push(text('t1'), text('t2'), text('t3'), text('t4'));
      expect(estimateSeconds(def)).toBe(280);
      expect(warningCodes(def)).toEqual([]);
      def.sections[3].questionIds.push('t5');
      def.questions.push(text('t5'));
      expect(validateDefinition(def).warnings).toEqual([
        { path: [], code: 'long_estimated_time', detail: '325' },
      ]);
    });

    it('question_without_score: scored types only, text questions are exempt', () => {
      const def = cloudReadiness();
      const confidence = def.questions[4];
      if (confidence.type !== 'scale') throw new Error('fixture');
      confidence.scores = { people: 0 };
      expect(validateDefinition(def).warnings).toEqual([
        { path: ['questions', 4], code: 'question_without_score', detail: 'confidence' },
      ]);
      expect(validateDefinition(def).errors).toEqual([]);
    });

    it('mql_never_qualifies: no minimum score and no strong signal', () => {
      const def = cloudReadiness();
      def.mql.minScore = null;
      expect(warningCodes(def)).toEqual([]);
      def.mql.strongSignals = [];
      expect(validateDefinition(def).warnings).toEqual([
        { path: ['mql'], code: 'mql_never_qualifies' },
      ]);
      expect(validateDefinition(def).errors).toEqual([]);
    });
  });
});

describe('lead score scale and reason texts (#122 re-plan)', () => {
  it('the MQL minimum score is on the 0–100 lead score scale', () => {
    for (const minScore of [-1, 101]) {
      const def = cloudReadiness();
      def.mql.minScore = minScore;
      expect(find(def, 'schema_invalid').map((e) => e.path)).toEqual([['mql', 'minScore']]);
    }
  });

  it('lead score rules and strong signals carry a reason text, not a locales key', () => {
    const def = cloudReadiness() as unknown as {
      leadScore: { rules: Record<string, unknown>[] };
    };
    def.leadScore.rules[0].reason = '';
    expect(find(def, 'schema_invalid').map((e) => e.path)).toEqual([
      ['leadScore', 'rules', 0, 'reason'],
    ]);
  });
});

describe('emptyDiagnosisDefinition', () => {
  it('parses, is not publishable yet, and warns that no one can qualify', () => {
    const result = validateDefinition(emptyDiagnosisDefinition('新しい診断'));
    expect(result.definition?.mql).toEqual({ required: [], strongSignals: [], minScore: null });
    expect(result.errors.map((e) => e.code)).toEqual(['axes_missing', 'consent_missing']);
    expect(result.warnings.map((w) => w.code)).toEqual(['mql_never_qualifies']);
  });
});
