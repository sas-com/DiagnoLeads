/**
 * Diagnosis builder: answer validation, scoring and the public views
 */
import {
  type ValidatedAnswers,
  validateDiagnosisAnswers,
} from '@/lib/features/diagnosis-builder/answers';
import {
  type DiagnosisDefinition,
  emptyDiagnosisDefinition,
} from '@/lib/features/diagnosis-builder/definition';
import {
  evaluate,
  findTier,
  toPublicDefinition,
  toPublicResult,
  withConsultationSignal,
} from '@/lib/features/diagnosis-builder/evaluate';
import { validateDefinition } from '@/lib/features/diagnosis-builder/validate';
import { describe, expect, it } from 'vitest';
import { cloudReadiness } from '../../../fixtures/diagnosis-builder';

/** Validate then evaluate, failing the test on invalid answers */
const score = (def: DiagnosisDefinition, raw: Record<string, unknown>) => {
  const result = validateDiagnosisAnswers(def, raw);
  if (!result.success) throw new Error(JSON.stringify(result.issues));
  return evaluate(def, result.answers);
};

const issuesOf = (def: DiagnosisDefinition, raw: Record<string, unknown>) => {
  const result = validateDiagnosisAnswers(def, raw);
  return result.success ? [] : result.issues;
};

const cloudAnswers = {
  hosting: 'cloud',
  team_size: 150,
  practices: ['iac', 'monitoring'],
  confidence: 5,
};

const onpremAnswers = {
  hosting: 'onprem',
  team_size: 5,
  migration_plan: 'this_year',
  confidence: 1,
};

const hybridAnswers = {
  hosting: 'hybrid',
  team_size: 50,
  migration_plan: 'this_year',
  confidence: 3,
};

describe('validateDiagnosisAnswers', () => {
  it('accepts every question type and trims text', () => {
    const result = validateDiagnosisAnswers(cloudReadiness(), {
      ...cloudAnswers,
      notes: '  よろしく  ',
    });
    expect(result).toEqual({
      success: true,
      answers: { ...cloudAnswers, notes: 'よろしく' },
    });
  });

  it('treats whitespace-only text as no answer', () => {
    const result = validateDiagnosisAnswers(cloudReadiness(), { ...cloudAnswers, notes: '   ' });
    expect(result).toEqual({ success: true, answers: cloudAnswers });
  });

  it('checks numbers against range and step, scales against whole numbers', () => {
    const def = cloudReadiness();
    expect(issuesOf(def, { ...cloudAnswers, team_size: 0 })).toEqual([
      { questionId: 'team_size', code: 'out_of_range' },
    ]);
    expect(issuesOf(def, { ...cloudAnswers, team_size: 1001 })[0].code).toBe('out_of_range');
    expect(issuesOf(def, { ...cloudAnswers, team_size: 2.5 })[0].code).toBe('out_of_range');
    expect(issuesOf(def, { ...cloudAnswers, team_size: '150' })[0].code).toBe('invalid_type');
    expect(issuesOf(def, { ...cloudAnswers, confidence: 6 })[0].code).toBe('out_of_range');
    expect(issuesOf(def, { ...cloudAnswers, confidence: 4.5 })[0].code).toBe('invalid_type');
    expect(issuesOf(def, { ...cloudAnswers, notes: 'x'.repeat(201) })[0].code).toBe('too_long');
  });

  it('rejects an exclusive option combined with others', () => {
    expect(issuesOf(cloudReadiness(), { ...cloudAnswers, practices: ['none', 'iac'] })).toEqual([
      { questionId: 'practices', code: 'exclusive_conflict' },
    ]);
  });

  it('rejects answers to hidden sections and requires shown ones', () => {
    expect(issuesOf(cloudReadiness(), { ...cloudAnswers, migration_plan: 'later' })).toEqual([
      { questionId: 'migration_plan', code: 'not_applicable' },
    ]);
    const { practices: _, ...withoutPractices } = cloudAnswers;
    expect(issuesOf(cloudReadiness(), withoutPractices)).toEqual([
      { questionId: 'practices', code: 'required' },
    ]);
  });

  it('client-supplied points are rejected, never read', () => {
    const def = cloudReadiness();
    expect(issuesOf(def, { ...cloudAnswers, score: 100, leadScore: 999 })).toEqual([
      { questionId: 'score', code: 'unknown_question' },
      { questionId: 'leadScore', code: 'unknown_question' },
    ]);
    // (the path question is invalid, so the cloud-only answer is not applicable either)
    expect(
      issuesOf(def, { ...cloudAnswers, hosting: { value: 'cloud', scores: { infra: 100 } } })
    ).toContainEqual({ questionId: 'hosting', code: 'invalid_type' });
    expect(issuesOf(def, { ...cloudAnswers, practices: [{ value: 'iac', points: 99 }] })).toEqual([
      { questionId: 'practices', code: 'invalid_type' },
    ]);
  });
});

describe('evaluate', () => {
  it('only takes validated answers, so raw request data cannot reach it', () => {
    // @ts-expect-error a plain object (e.g. a request body) is not ValidatedAnswers
    const unchecked = () => evaluate(cloudReadiness(), { hosting: 'cloud', score: 100 });
    expect(unchecked).toBeTypeOf('function');
  });

  it('fixture is a valid definition', () => {
    expect(validateDefinition(cloudReadiness()).errors).toEqual([]);
  });

  it('cloud path: scores, weighted overall, tiers, result type', () => {
    const result = score(cloudReadiness(), cloudAnswers);
    // infra: hosting 4 + practices (2 + 1) = 7 of 0..7; people: band 4 + practices 1 + scale 4
    expect(result.axes).toEqual({
      infra: { raw: 7, min: 0, max: 7, pct: 100 },
      people: { raw: 9, min: 0, max: 11, pct: 82 },
    });
    // (100 × 2 + 82 × 1) / 3 = 94
    expect(result.overall).toBe(94);
    expect(result.tiers).toEqual({ overall: 'high', infra_tiers: 'strong' });
    expect(result.resultTypeId).toBe('leader');
    expect(result.leadScore).toEqual({ points: 30, reasons: ['担当者が100人以上'] });
    expect(result.mql).toEqual({ level: 'fit', qualified: false, reasons: [{ code: 'below_min_score' }] });
  });

  it('on-premises path: hidden "practices" is neither scored nor counted in the range', () => {
    const result = score(cloudReadiness(), onpremAnswers);
    // infra range: hosting 0..4 + migration_plan 0..3 (practices 0..3 is left out)
    expect(result.axes.infra).toEqual({ raw: 3, min: 0, max: 7, pct: 43 });
    expect(result.axes.people).toEqual({ raw: 0, min: 0, max: 8, pct: 0 });
    // (43 × 2 + 0) / 3 = 28.7
    expect(result.overall).toBe(29);
    expect(result.tiers.overall).toBe('low');
    expect(result.resultTypeId).toBe('planner');
    expect(result.leadScore).toEqual({ points: 40, reasons: ['今年中に移行の予定がある'] });
    expect(result.mql).toEqual({
      level: 'none',
      qualified: false,
      reasons: [{ code: 'required_not_met', index: 0 }],
    });
  });

  it('ignores answers to hidden questions even if they reach evaluate', () => {
    const def = cloudReadiness();
    const forged = { ...onpremAnswers, practices: ['iac', 'monitoring', 'training'] };
    const result = evaluate(def, forged as unknown as ValidatedAnswers);
    expect(result).toEqual(score(def, onpremAnswers));
  });

  it('scale gives a share of its points; strong signal qualifies below the minimum score', () => {
    const result = score(cloudReadiness(), hybridAnswers);
    // infra: 2 + 3 = 5 of 7; people: band 2 + scale 4 × (3 − 1) / 4 = 2 → 4 of 8
    expect(result.axes.infra.pct).toBe(71);
    expect(result.axes.people).toEqual({ raw: 4, min: 0, max: 8, pct: 50 });
    expect(result.overall).toBe(64);
    expect(result.tiers.overall).toBe('mid');
    expect(result.mql).toEqual({
      level: 'interest',
      qualified: true,
      reasons: [
        { code: 'strong_signal', signalId: 'near_term_signal', reason: '今年中に移行する予定（強いシグナル）' },
        { code: 'below_min_score' },
      ],
    });
  });

  it('qualifies on the minimum score alone', () => {
    const def = cloudReadiness();
    def.mql.minScore = 30;
    const result = score(def, cloudAnswers);
    expect(result.mql).toEqual({ level: 'interest', qualified: true, reasons: [{ code: 'min_score_reached' }] });
  });

  it('the empty draft default qualifies no one', () => {
    const result = score(emptyDiagnosisDefinition('新しい診断'), {});
    expect(result.leadScore).toEqual({ points: 0, reasons: [] });
    expect(result.mql).toEqual({ level: 'fit', qualified: false, reasons: [{ code: 'no_strong_signal' }] });
  });

  it('minScore null: a high lead score alone does not qualify', () => {
    const def = cloudReadiness();
    def.mql.minScore = null;
    def.mql.strongSignals = [];
    def.leadScore.rules[0].points = 100;
    const result = score(def, cloudAnswers);
    expect(result.leadScore.points).toBe(100);
    expect(result.mql).toEqual({ level: 'fit', qualified: false, reasons: [{ code: 'no_strong_signal' }] });
  });

  it('keeps the lead score within 0..100 (the AX scale) and gives the rules\' reason texts', () => {
    const def = cloudReadiness();
    def.leadScore.rules[0].points = 100;
    def.leadScore.rules.push({
      id: 'always',
      when: { match: 'all', conditions: [] },
      points: 50,
      reason: '常に加点',
    });
    expect(score(def, cloudAnswers).leadScore).toEqual({
      points: 100,
      reasons: ['担当者が100人以上', '常に加点'],
    });
    def.leadScore.rules = [
      { id: 'minus', when: { match: 'all', conditions: [] }, points: -40, reason: '減点' },
    ];
    expect(score(def, cloudAnswers).leadScore).toEqual({ points: 0, reasons: ['減点'] });
  });

  it('a consultation request makes a fit respondent 関心あり, but not one outside the required conditions (#139)', () => {
    const fit = score(cloudReadiness(), cloudAnswers).mql;
    expect(fit.level).toBe('fit');
    expect(withConsultationSignal(fit)).toEqual({
      level: 'interest',
      qualified: true,
      reasons: [{ code: 'consultation' }],
    });
    const none = score(cloudReadiness(), onpremAnswers).mql;
    expect(none.level).toBe('none');
    expect(withConsultationSignal(none)).toBe(none);
    const interest = withConsultationSignal(fit);
    expect(withConsultationSignal(interest)).toBe(interest);
  });

  it('minScore null: qualifies only when a strong signal matches', () => {
    const def = cloudReadiness();
    def.mql.minScore = null;
    expect(score(def, cloudAnswers).mql).toEqual({
      level: 'fit',
      qualified: false,
      reasons: [{ code: 'no_strong_signal' }],
    });
    expect(score(def, hybridAnswers).mql).toEqual({
      level: 'interest',
      qualified: true,
      reasons: [{ code: 'strong_signal', signalId: 'near_term_signal', reason: '今年中に移行する予定（強いシグナル）' }],
    });
  });

  it('axis weights decide the overall score', () => {
    const def = cloudReadiness();
    def.axes[0].weight = 1;
    def.axes[1].weight = 3;
    // (100 × 1 + 82 × 3) / 4 = 86.5
    expect(score(def, cloudAnswers).overall).toBe(87);
  });

  it('multiple choice adds up the selected options', () => {
    const result = score(cloudReadiness(), {
      ...cloudAnswers,
      practices: ['iac', 'monitoring', 'training'],
    });
    expect(result.axes.infra.raw).toBe(7);
    expect(result.axes.people.raw).toBe(4 + 3 + 4);
    expect(result.axes.people.pct).toBe(100);
  });

  it('an exclusive option alone gives only its own points', () => {
    const result = score(cloudReadiness(), { ...cloudAnswers, practices: ['none'] });
    expect(result.axes.infra).toEqual({ raw: 4, min: 0, max: 7, pct: 57 });
    expect(result.axes.people.raw).toBe(8);
  });

  it('negative points widen the range below zero', () => {
    const def = cloudReadiness();
    const practices = def.questions[3];
    if (practices.type !== 'multiple') throw new Error('fixture');
    practices.options[3].scores = { infra: -2 };
    const result = score(def, { ...cloudAnswers, practices: ['none'] });
    // infra: hosting 4 − 2 = 2 in −2..7
    expect(result.axes.infra).toEqual({ raw: 2, min: -2, max: 7, pct: 44 });
  });

  it('an optional question may give 0 even if every option scores', () => {
    const def = cloudReadiness();
    const hosting = def.questions[0];
    const plan = def.questions[2];
    if (hosting.type !== 'single' || plan.type !== 'single') throw new Error('fixture');
    plan.required = false;
    plan.options = plan.options.map((o) => ({ ...o, scores: { infra: 1 } }));
    const result = score(def, { ...onpremAnswers, migration_plan: undefined });
    expect(result.axes.infra).toEqual({ raw: 0, min: 0, max: 5, pct: 0 });
  });

  it('result types: first match wins, null when nothing matches', () => {
    const def = cloudReadiness();
    expect(score(def, hybridAnswers).resultTypeId).toBe('planner');
    def.resultTypes = def.resultTypes.slice(0, 1);
    expect(score(def, hybridAnswers).resultTypeId).toBeNull();
  });

  describe('tier edges (minPct inclusive, maxPct exclusive, 100 inclusive)', () => {
    const overall = cloudReadiness().tierSets[0];

    it.each([
      [0, 'low'],
      [39, 'low'],
      [40, 'mid'],
      [69, 'mid'],
      [70, 'high'],
      [99, 'high'],
      [100, 'high'],
    ])('%i percent is tier %s', (pct, tier) => {
      expect(findTier(overall, pct)).toBe(tier);
    });

    it('returns null outside every tier', () => {
      expect(findTier({ id: 'x', tiers: [overall.tiers[0]] }, 40)).toBeNull();
    });

    /** One question whose option points are the percentage on a 0..100 axis */
    const ladder = (): DiagnosisDefinition => {
      const def = cloudReadiness();
      def.sections = [{ id: 'only', title: 'only', questionIds: ['level'] }];
      def.questions = [
        {
          id: 'level',
          type: 'single',
          label: 'level',
          required: true,
          options: [0, 39, 40, 69, 70, 100].map((points) => ({
            value: `p${points}`,
            label: String(points),
            scores: { infra: points },
          })),
        },
      ];
      def.axes = [{ id: 'infra', name: 'infra', weight: 1 }];
      def.tierSets = def.tierSets.slice(0, 1);
      def.resultTypes = def.resultTypes.filter((t) => t.id !== 'planner');
      def.resultBlocks = def.resultBlocks.filter((b) => !b.onlyFor);
      def.leadScore.rules = [];
      def.mql.required = [];
      def.mql.strongSignals = [];
      return def;
    };

    it.each([
      ['p0', 0, 'low'],
      ['p39', 39, 'low'],
      ['p40', 40, 'mid'],
      ['p69', 69, 'mid'],
      ['p70', 70, 'high'],
      ['p100', 100, 'high'],
    ])('evaluate: option %s gives %i percent, tier %s', (level, pct, tier) => {
      expect(validateDefinition(ladder()).errors).toEqual([]);
      const result = score(ladder(), { level });
      expect(result.overall).toBe(pct);
      expect(result.tiers.overall).toBe(tier);
    });
  });
});

describe('public views', () => {
  const internalKeys = ['scores', 'points', 'weight', 'bands', 'leadScore', 'mql', 'when', 'raw'];
  const internalValues = ['reason_large_team', 'reason_near_term', 'signal_near_term'];

  it('toPublicResult keeps percentages, tiers and the result type only', () => {
    const publicResult = toPublicResult(score(cloudReadiness(), cloudAnswers));
    expect(publicResult).toEqual({
      axes: { infra: { pct: 100 }, people: { pct: 82 } },
      overall: 94,
      tiers: { overall: 'high', infra_tiers: 'strong' },
      resultTypeId: 'leader',
    });
    const json = JSON.stringify(publicResult);
    for (const key of [...internalKeys, 'min', 'max', 'reasons', 'qualified']) {
      expect(json).not.toContain(`"${key}"`);
    }
    for (const value of internalValues) expect(json).not.toContain(value);
  });

  it('toPublicDefinition contains no points, weights, bands, conditions or lead rules', () => {
    const def = cloudReadiness();
    const json = JSON.stringify(toPublicDefinition(def));
    for (const key of internalKeys) expect(json).not.toContain(`"${key}"`);
    for (const value of internalValues) expect(json).not.toContain(value);
  });

  it('toPublicDefinition keeps what the respondent needs to answer and read the result', () => {
    const publicDef = toPublicDefinition(cloudReadiness());
    expect(publicDef.sections[1].showWhen).toEqual({
      questionId: 'hosting',
      anyOf: ['onprem', 'hybrid'],
    });
    expect(publicDef.questions[3]).toEqual({
      id: 'practices',
      type: 'multiple',
      label: '取り組んでいること',
      description: undefined,
      required: true,
      options: [
        { value: 'iac', label: '構成のコード化', hint: undefined },
        { value: 'monitoring', label: '監視', hint: undefined },
        { value: 'training', label: '研修', hint: undefined },
        { value: 'none', label: '特になし', hint: undefined },
      ],
      exclusiveOptions: ['none'],
    });
    expect(publicDef.questions[1]).toMatchObject({ type: 'number_range', min: 1, max: 1000 });
    expect(publicDef.axes).toEqual([
      { id: 'infra', name: '基盤' },
      { id: 'people', name: '体制' },
    ]);
    expect(publicDef.resultTypes[0]).toEqual({ id: 'leader', name: '先行型', summary: undefined });
    expect(publicDef.consent?.version).toBe('2026-10-01');
  });

  it('the public definition is enough to validate answers (no scores needed)', () => {
    // The browser can run the same answer checks on the public definition
    const publicDef = toPublicDefinition(cloudReadiness()) as unknown as DiagnosisDefinition;
    expect(validateDiagnosisAnswers(publicDef, cloudAnswers).success).toBe(true);
  });
});
