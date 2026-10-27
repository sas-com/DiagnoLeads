import { AX_MIGRATION_CONFIG } from '@/lib/features/diagnostics/ax-migration/config';
import {
  AX_PLATFORMS,
  axMigrationDefinition,
} from '@/lib/features/diagnostics/ax-migration/definition';
import {
  AX_POINT_TABLES,
  evaluateAxMigration,
  toPublicResult,
} from '@/lib/features/diagnostics/ax-migration/evaluate';
import { applicableQuestions, shownSections, validateAnswers } from '@/lib/features/diagnostics/engine';
import type { DiagnosticAnswers } from '@/lib/features/diagnostics/types';
import {
  accessAnswers,
  acosAnswers,
  answersByPlatform,
  as400Answers,
  otherAnswers,
} from '@/test/fixtures/ax-migration';
import { answeredChallengesIn } from '@/lib/features/diagnostics/ax-migration/challenge-categories';
import { describe, expect, it } from 'vitest';

const NON_TECHNICAL = new Set([
  'platform',
  'challenges',
  'access_challenges',
  'timeline',
  'industry',
  'role',
]);
/** Evaluation date fixed for the Access / Office support dates */
const NOW = new Date('2026-10-11T09:00:00+09:00');
/** Evaluate answers the API would accept (a renamed question or option fails here) */
const evaluate = (answers: DiagnosticAnswers, at: Date = NOW) => {
  const validation = validateAnswers(axMigrationDefinition, answers);
  expect(validation.success, JSON.stringify(validation)).toBe(true);
  return evaluateAxMigration(answers, AX_MIGRATION_CONFIG, at);
};

describe('axMigrationDefinition (v2)', () => {
  it('places every question in at least one section and has ja / en text', () => {
    const inSections = new Set(axMigrationDefinition.sections.flatMap((s) => s.questionIds));
    for (const question of axMigrationDefinition.questions) {
      expect(inSections.has(question.id)).toBe(true);
      expect(question.label.ja).not.toBe('');
      expect(question.label.en).not.toBe('');
      for (const option of question.options) {
        expect(option.label.ja).not.toBe('');
        expect(option.label.en).not.toBe('');
      }
    }
  });

  it.each(AX_PLATFORMS)('gives the %s path the same six steps', (platform) => {
    // platform, operation, assets, business, company size (optional, #150) (+ contact on screen)
    expect(shownSections(axMigrationDefinition, { platform }).map((s) => s.id)).toEqual([
      'platform',
      `${platform}-operation`,
      `${platform}-assets`,
      platform === 'access' ? 'business-access' : 'business',
      'company',
    ]);
  });

  it.each(AX_PLATFORMS)('keeps the %s path to at most 11 required questions', (platform) => {
    const required = applicableQuestions(axMigrationDefinition, { platform }).filter(
      (q) => q.required
    );
    expect(required.length).toBeLessThanOrEqual(11);
  });

  it('offers "I don\'t know" on every technical question', () => {
    const technical = axMigrationDefinition.questions.filter((q) => !NON_TECHNICAL.has(q.id));
    for (const question of technical) {
      expect(question.options.map((o) => o.value)).toContain('unknown');
    }
  });

  it('never requires a follow-up (detail) question', () => {
    const details = axMigrationDefinition.questions.filter((q) => q.detail);
    expect(details.length).toBeGreaterThan(0);
    for (const question of details) expect(question.required).toBe(false);
  });

  it.each(AX_PLATFORMS)('asks the kinds of data only as a follow-up on the Access path (%s)', (platform) => {
    const question = applicableQuestions(axMigrationDefinition, { platform }).find(
      (q) => q.id === 'access_data_kinds'
    );
    if (platform !== 'access') {
      expect(question).toBeUndefined();
      return;
    }
    expect(question).toMatchObject({ type: 'multiple', required: false, detail: true });
    // "I don't know" can go with what the respondent knows; "none" cannot
    expect(question?.exclusiveOptions).toEqual(['none']);
  });

  it('gives every option of a scored question a weight, and names the unscored questions', () => {
    // Asked for the lead, the size estimate or sales, not weighed option by option
    const unscored = [
      'platform',
      'industry',
      'business_areas',
      'legacy_edi',
      'acos_vendor',
      'access_version',
      'access_users',
      // Kinds of data in the tool (#826): for planning how the data is handled
      'access_data_kinds',
      // Company size (#150): checked against the organization's target ranges, not scored
      'annual_revenue',
      'employees',
      'sites',
    ];
    const ids = axMigrationDefinition.questions.map((q) => q.id);
    expect([...Object.keys(AX_POINT_TABLES), ...unscored].sort()).toEqual([...ids].sort());
    for (const [questionId, { tables, except = [] }] of Object.entries(AX_POINT_TABLES)) {
      const question = axMigrationDefinition.questions.find((q) => q.id === questionId);
      for (const option of question?.options ?? []) {
        if (except.includes(option.value)) continue;
        for (const table of tables) {
          expect(Object.keys(table), `${questionId}: ${option.value}`).toContain(option.value);
        }
      }
    }
  });

  it('only shows a section after the single-choice answer it depends on', () => {
    const { sections, questions } = axMigrationDefinition;
    sections.forEach((section, index) => {
      if (!section.showWhen) return;
      const { questionId, anyOf } = section.showWhen;
      const earlier = sections.slice(0, index).flatMap((s) => s.questionIds);
      expect(earlier, section.id).toContain(questionId);
      const question = questions.find((q) => q.id === questionId);
      expect(question?.type, section.id).toBe('single');
      const values = question?.options.map((o) => o.value) ?? [];
      for (const value of anyOf) expect(values, section.id).toContain(value);
    });
  });

  it.each(Object.entries(answersByPlatform))('accepts the typical %s answers', (_, answers) => {
    expect(validateAnswers(axMigrationDefinition, answers).success).toBe(true);
  });
});

describe('evaluateAxMigration', () => {
  describe('MQL (適合 = 業種 × システム, 関心あり = 適合 + 強いシグナル)', () => {
    /** Fit, without any strong signal */
    const fitOnly: DiagnosticAnswers = {
      ...as400Answers,
      role: 'it_staff',
      timeline: '1_2y',
      support_end: '1_3y',
    };

    it.each(['as400', 'acos', 'access'] as const)('counts %s as a legacy system', (platform) => {
      const result = evaluate(answersByPlatform[platform]);
      expect(result.mql.criteria.system).toBe(true);
      expect(result.mql.candidate).toBe(true);
    });

    it('counts VB, WebPerformer and other hosts on the other path, but not packages', () => {
      expect(evaluate(otherAnswers).mql.criteria.system).toBe(true);
      expect(
        evaluate({ ...otherAnswers, other_system: 'mainframe' }).mql.criteria.system
      ).toBe(true);
      expect(
        evaluate({ ...otherAnswers, other_system: 'package' }).mql.criteria.system
      ).toBe(false);
    });

    it('needs a target industry', () => {
      const result = evaluate({ ...as400Answers, industry: 'other' });
      expect(result.mql).toMatchObject({ qualified: false, candidate: false });
    });

    it('is only fit when the respondent shows no interest (completing it is not enough)', () => {
      expect(evaluate(fitOnly).mql).toMatchObject({
        level: 'fit',
        qualified: false,
        candidate: true,
        signals: [],
      });
    });

    it.each([
      ['a support end within a year', { support_end: 'within_1y' }, 'support_deadline'],
      ['a support end already passed', { support_end: 'passed' }, 'support_deadline'],
      ['a decision-making role', { role: 'executive' }, 'decision_role'],
      ['a switch within a year', { timeline: 'within_1y' }, 'timeline_soon'],
    ] as const)('is interested (MQL) with %s', (_, change, signal) => {
      expect(evaluate({ ...fitOnly, ...change }).mql).toMatchObject({
        level: 'interest',
        qualified: true,
        signals: [signal],
      });
    });

    it('is interested (MQL) with a consultation request', () => {
      const result = evaluateAxMigration(fitOnly, AX_MIGRATION_CONFIG, NOW, {
        consultationRequested: true,
      });
      expect(result.mql).toMatchObject({ level: 'interest', signals: ['consultation'] });
    });

    // #292 (owner 2026-10-21): every Access 2016-2021 is out of support now, so the support end
    // counts only together with an impact answer
    describe('the Access support end (#292)', () => {
      const ended = { ...accessAnswers, role: 'business_staff', timeline: '1_2y' };

      it('alone is not a strong signal', () => {
        expect(evaluate(ended).mql).toMatchObject({ level: 'fit', signals: [] });
        const ending = { ...ended, access_version: ['v2021'] };
        expect(evaluate(ending).mql).toMatchObject({ level: 'fit', signals: [] });
        const low = {
          ...ended,
          access_importance: 'support',
          access_users: '3_10',
          access_location: 'shared_folder',
        };
        expect(evaluate(low).mql.level).toBe('fit');
      });

      it.each<[string, DiagnosticAnswers]>([
        ['the main task of the department', { access_importance: 'main' }],
        ['the whole company or customers', { access_importance: 'company' }],
        ['11-30 users', { access_users: '11_30' }],
        ['31 users or more', { access_users: 'gte31' }],
        ['data outside Access', { access_features: ['vba', 'external_data'] }],
        ['data in a database', { access_location: 'database' }],
      ])('with %s is interest (MQL)', (_, change) => {
        expect(evaluate({ ...ended, ...change }).mql).toMatchObject({
          level: 'interest',
          qualified: true,
          signals: ['support_deadline'],
        });
        // The ending support (Office 2021 before its end date) qualifies the same way
        expect(evaluate({ ...ended, ...change, access_version: ['v2021'] }).mql.level).toBe(
          'interest'
        );
      });

      it('with a supported version and an impact answer is not a strong signal', () => {
        const supported = { ...ended, access_version: ['m365'], access_importance: 'company' };
        expect(evaluate(supported).mql.level).toBe('fit');
      });
    });

    describe('the Access path takes any industry and size (#292)', () => {
      /** Outside the target industry, low difficulty and urgency, no strong signal */
      const smallTool: DiagnosticAnswers = {
        ...accessAnswers,
        industry: 'other',
        role: 'business_staff',
        access_version: ['m365'],
        access_maintainer: 'team',
        access_tools: '1',
        access_screens_forms: 'lt20',
        access_features: ['none'],
        access_challenges: ['none'],
        annual_revenue: 'over_30b',
      };
      const target = { annual_revenue: ['1b_3b'], employees: [], sites: [] };

      it('is fit outside the target industry and size ranges, without showing them unmet', () => {
        const result = evaluateAxMigration(smallTool, AX_MIGRATION_CONFIG, NOW, {}, target);
        expect(result.companySize.fit).toBe('not_fit');
        expect(result.mql).toMatchObject({
          level: 'fit',
          candidate: true,
          unmet: [],
          waived: ['industry', 'company_size'],
          criteria: { industry: false, system: true, companySize: 'not_fit' },
        });
      });

      it('is interest with a strong signal in any industry', () => {
        const result = evaluateAxMigration(
          { ...smallTool, role: 'executive' },
          AX_MIGRATION_CONFIG,
          NOW,
          {},
          target
        );
        expect(result.mql).toMatchObject({ level: 'interest', signals: ['decision_role'] });
      });

      it('recommends a consultation in another industry', () => {
        const result = evaluate(smallTool);
        expect(result.difficulty.level).not.toBe('high');
        expect(result.urgency.level).not.toBe('high');
        expect(result.recommendation).toBe('consultation');
        // Without the waiver the industry alone would send it to "information"
        const strict = {
          ...AX_MIGRATION_CONFIG,
          mql: { ...AX_MIGRATION_CONFIG.mql, anyIndustryPlatforms: [] },
        };
        expect(evaluateAxMigration(smallTool, strict, NOW).recommendation).toBe('information');
      });

      it('leaves the host paths as they were: industry and size are required', () => {
        const host = { ...as400Answers, industry: 'other', annual_revenue: 'over_30b' };
        const result = evaluateAxMigration(host, AX_MIGRATION_CONFIG, NOW, {}, target);
        expect(result.mql).toMatchObject({
          level: 'none',
          unmet: ['industry', 'company_size'],
          waived: [],
        });
      });
    });

    it('is not an MQL outside the target, whatever the signals', () => {
      const result = evaluateAxMigration(
        { ...as400Answers, industry: 'other', role: 'executive' },
        AX_MIGRATION_CONFIG,
        NOW,
        { consultationRequested: true }
      );
      expect(result.mql).toMatchObject({
        level: 'none',
        qualified: false,
        unmet: ['industry'],
        signals: ['consultation', 'decision_role'],
      });
    });

    it('can switch back to the old rule (completing the diagnosis is the action)', () => {
      const old = { ...AX_MIGRATION_CONFIG, countWebDiagnosisAsMqlAction: true };
      expect(evaluateAxMigration(fitOnly, old, NOW).mql).toMatchObject({
        level: 'interest',
        signals: ['web_diagnosis'],
      });
    });
  });

  describe('target system on the lead', () => {
    it.each([
      [as400Answers, 'as400'],
      [acosAnswers, 'acos'],
      [accessAnswers, 'access'],
      [otherAnswers, 'vb'],
      [{ ...otherAnswers, other_system: 'webperformer' }, 'webperformer'],
      [{ ...otherAnswers, other_system: 'office_computer' }, 'other_legacy'],
      [{ ...otherAnswers, other_system: 'package' }, 'other'],
      [{ ...otherAnswers, other_system: 'unknown' }, null],
    ] as const)('maps the answers to %#', (answers, expected) => {
      expect(evaluate(answers as DiagnosticAnswers).targetSystem).toBe(expected);
    });
  });

  describe('difficulty', () => {
    it('rates a small, documented AS/400 system low', () => {
      const result = evaluate({
        ...as400Answers,
        as400_programs: 'lt500',
        as400_languages: ['rpg4'],
        source_docs: 'complete',
        integrations: 'few',
      });
      expect(result.difficulty.level).toBe('low');
      expect(result.reasons.difficulty).toEqual(['small_scale']);
    });

    it('does not call a system small when its size is unknown', () => {
      const result = evaluate({
        ...as400Answers,
        as400_programs: 'unknown',
        as400_languages: ['rpg4'],
        source_docs: 'complete',
        integrations: 'few',
      });
      expect(result.difficulty.level).toBe('low');
      expect(result.reasons.difficulty).toEqual([]);
    });

    it('rates a large AS/400 system with missing source high and says why', () => {
      const result = evaluate({
        ...as400Answers,
        as400_programs: 'gte5000',
        as400_languages: ['rpg3', 'cobol'],
        source_docs: 'source_missing',
        integrations: 'many',
      });
      expect(result.difficulty.level).toBe('high');
      expect(result.reasons.difficulty).toEqual(['programs_large', 'source_missing']);
    });

    it('counts several AS/400 languages as the hardest one, a development tool hardest of all', () => {
      const rpg3 = evaluate({ ...as400Answers, as400_languages: ['rpg3'] });
      const mixed = evaluate({
        ...as400Answers,
        as400_languages: ['rpg3', 'rpg4', 'cobol'],
      });
      const tool = evaluate({ ...as400Answers, as400_languages: ['tool'] });
      expect(mixed.difficulty.score).toBe(rpg3.difficulty.score);
      expect(tool.difficulty.score).toBeGreaterThan(rpg3.difficulty.score);
      expect(tool.reasons.difficulty).toContain('as400_tool');
      expect(tool.checkpoints).toContain('as400_tool');
    });

    it('does not count an AS/400 package as size, but says how to approach it', () => {
      const plain = evaluate({ ...as400Answers, as400_languages: ['rpg4'] });
      const packaged = evaluate({ ...as400Answers, as400_languages: ['package', 'rpg4'] });
      expect(packaged.difficulty.score).toBe(plain.difficulty.score);
      expect(packaged.checkpoints).toContain('as400_package');
    });

    it('estimates the AS/400 size from the business areas when the programs are unknown', () => {
      const unknown = { ...as400Answers, as400_programs: 'unknown' };
      const base = evaluate(unknown).difficulty.score;
      const wide = evaluate({
        ...unknown,
        business_areas: ['sales', 'purchasing', 'inventory', 'production', 'accounting'],
      }).difficulty.score;
      const narrow = evaluate({ ...unknown, business_areas: ['sales'] }).difficulty.score;
      expect(wide).toBeGreaterThan(base);
      expect(narrow).toBeLessThan(base);
      // A known number of programs wins over the estimate
      expect(
        evaluate({ ...as400Answers, business_areas: ['sales'] }).difficulty.score
      ).toBe(evaluate(as400Answers).difficulty.score);
    });

    it('never rates missing source low, however small the system', () => {
      const result = evaluate({
        ...as400Answers,
        as400_programs: 'lt500',
        as400_languages: ['rpg4'],
        source_docs: 'source_missing',
        integrations: 'few',
      });
      expect(result.difficulty.level).toBe('medium');
    });

    it('asks first whether the maintenance company will hand over the source', () => {
      const result = evaluate({ ...as400Answers, source_docs: 'vendor_held' });
      expect(result.reasons.difficulty).toContain('source_vendor_held');
      expect(result.checkpoints[0]).toBe('source_vendor_held');
    });

    it('rates ACOS assembler and an unknown size by series', () => {
      const cobol = evaluate(acosAnswers);
      const assembler = evaluate({ ...acosAnswers, acos_languages: ['assembler'] });
      expect(assembler.difficulty.score).toBeGreaterThan(cobol.difficulty.score);
      expect(assembler.reasons.difficulty).toContain('acos_assembler');
      expect(assembler.checkpoints).toContain('acos_assembler');

      const unknownSize = { ...acosAnswers, acos_programs: 'unknown' };
      expect(evaluate(unknownSize).difficulty.score).toBeGreaterThan(
        evaluate({ ...unknownSize, acos_series: 'acos2' }).difficulty.score
      );
    });

    it('rates a small COBOL-only ACOS with full source low, and an outdated one medium', () => {
      const small = { ...acosAnswers, acos_programs: 'lt1000', acos_series: 'acos2' };
      expect(evaluate(small).difficulty.level).toBe('low');
      expect(evaluate({ ...small, source_docs: 'no_docs' }).difficulty.level).toBe(
        'medium'
      );
    });

    it('rates a single plain Access tool low and many elaborate tools high', () => {
      const plain = evaluate({
        ...accessAnswers,
        access_tools: '1',
        access_screens_forms: 'lt20',
        access_features: ['none'],
        access_maintainer: 'team',
      });
      const heavy = evaluate({
        ...accessAnswers,
        access_tools: 'gte51',
        access_screens_forms: 'gte101',
        access_features: ['vba', 'external_data', 'devices'],
      });
      expect(plain.difficulty.level).toBe('low');
      expect(heavy.difficulty.level).toBe('high');
      expect(heavy.reasons.difficulty).toEqual(['access_many_screens', 'access_many_tools']);
    });

    it('treats skipped and "I don\'t know" follow-ups as neutral; answers move it both ways', () => {
      const base = evaluate(as400Answers).difficulty.score;
      expect(
        evaluate({ ...as400Answers, as400_screens_forms: 'unknown' }).difficulty.score
      ).toBe(base);
      expect(
        evaluate({ ...as400Answers, as400_screens_forms: 'gte1000' }).difficulty.score
      ).toBeGreaterThan(base);
      expect(
        evaluate({ ...as400Answers, as400_screens_forms: 'lt300' }).difficulty.score
      ).toBeLessThan(base);
    });
  });

  describe('urgency', () => {
    it('is high when support has ended and nobody maintains the system', () => {
      const result = evaluate({
        ...acosAnswers,
        support_end: 'passed',
        maintenance: 'none',
      });
      expect(result.urgency.level).toBe('high');
      expect(result.reasons.urgency).toEqual(['maintenance_none', 'support_passed']);
    });

    it('is high when the last people who can change it leave before the deadline', () => {
      const retiring = { ...as400Answers, maintenance: 'retiring', challenges: ['none'] };
      expect(evaluate({ ...retiring, support_end: '1_3y' }).urgency.level).toBe('high');
      expect(evaluate({ ...retiring, support_end: 'beyond_3y' }).urgency.level).toBe(
        'medium'
      );
      expect(
        evaluate({ ...retiring, maintenance: 'none', support_end: 'beyond_3y' }).urgency
          .level
      ).toBe('high');
    });

    it('keeps an ended support at least medium, and counts no own machine as no deadline', () => {
      const calm = { ...otherAnswers, maintenance: 'team', challenges: ['none'] };
      expect(evaluate({ ...calm, support_end: 'passed' }).urgency.level).not.toBe('low');
      expect(evaluate({ ...calm, support_end: 'no_hardware' }).urgency.score).toBe(
        evaluate({ ...calm, support_end: 'beyond_3y' }).urgency.score
      );
    });

    it('weighs an ACOS contract date less than on other machines (NEC keeps ACOS going)', () => {
      const deadline = { maintenance: 'team', support_end: 'within_1y', challenges: ['none'] };
      expect(evaluate({ ...acosAnswers, ...deadline }).urgency.score).toBeLessThan(
        evaluate({ ...as400Answers, ...deadline }).urgency.score
      );
    });

    it('raises urgency for phone-line EDI, which ends in December 2028', () => {
      const as400 = evaluate({ ...as400Answers, legacy_edi: 'yes' });
      expect(as400.urgency.score).toBeGreaterThan(evaluate(as400Answers).urgency.score);
      expect(as400.checkpoints).toContain('legacy_edi');
      const acos = evaluate({ ...acosAnswers, acos_integrations: ['edi', 'legacy_edi'] });
      expect(acos.urgency.score).toBeGreaterThan(evaluate(acosAnswers).urgency.score);
      expect(acos.checkpoints).toContain('legacy_edi');
    });

    it('is high for an unsupported Access whose author has left', () => {
      const result = evaluate(accessAnswers);
      expect(result.urgency.level).toBe('high');
      expect(result.reasons.urgency).toEqual(['access_no_maintainer', 'access_support_ended']);
    });

    it('works out the Office support status from the end dates', () => {
      const office2021 = { ...accessAnswers, access_version: ['v2021'] };
      expect(evaluate(office2021).reasons.urgency).toContain('access_support_ending');
      // Updates still ship on the end date (2026-10-13), so that whole day counts as supported
      expect(evaluate(office2021, new Date('2026-10-13T23:00:00+09:00')).reasons.urgency).toContain(
        'access_support_ending'
      );
      expect(evaluate(office2021, new Date('2026-10-14T09:00:00+09:00')).reasons.urgency).toContain(
        'access_support_ended'
      );
      const office2024 = { ...accessAnswers, access_version: ['v2024', 'm365'] };
      expect(evaluate(office2024).checkpoints).not.toContain('access_support');
      expect(evaluate(office2024, new Date('2029-01-01T09:00:00+09:00')).checkpoints).toContain(
        'access_support'
      );
    });

    it('always shows an Office out of support among the urgency reasons (#288)', () => {
      const result = evaluate({
        ...accessAnswers,
        access_importance: 'company',
        access_location: 'cloud',
        access_features: ['none'],
      });
      expect(result.reasons.urgency).toHaveLength(2);
      expect(result.reasons.urgency).toContain('access_support_ended');
    });

    it('takes the weakest version when several are in use', () => {
      const mixed = evaluate({ ...accessAnswers, access_version: ['m365', 'le2013'] });
      expect(mixed.reasons.urgency).toContain('access_support_ended');
    });

    it('keeps urgency high when nobody can fix a tool the whole company depends on', () => {
      const result = evaluate({
        ...accessAnswers,
        access_version: ['m365'],
        access_challenges: ['none'],
        access_importance: 'company',
      });
      expect(result.urgency.level).toBe('high');
    });

    it('does not let a distant timeline lower the urgency', () => {
      const soon = evaluate({ ...acosAnswers, timeline: 'within_1y' });
      const later = evaluate({ ...acosAnswers, timeline: 'beyond_3y' });
      expect(later.urgency).toEqual(soon.urgency);
    });

    it('is low without deadlines, with a team and no plan', () => {
      const result = evaluate({
        ...otherAnswers,
        support_end: 'beyond_3y',
        maintenance: 'team',
        timeline: 'undecided',
        challenges: ['none'],
      });
      expect(result.urgency.level).toBe('low');
      expect(result.reasons.urgency).toEqual(['no_deadline']);
    });

    it('raises urgency for an unsupported IBM i version given as a follow-up', () => {
      const calm = { ...as400Answers, maintenance: 'team', support_end: 'beyond_3y' };
      const base = evaluate(calm);
      const old = evaluate({ ...calm, as400_version: 'le72' });
      expect(old.urgency.score).toBeGreaterThan(base.urgency.score);
      expect(old.checkpoints).toContain('as400_version');
      const current = evaluate({ ...calm, as400_version: 'v75_76' });
      expect(current.urgency.score).toBeLessThan(base.urgency.score);
      expect(current.checkpoints).not.toContain('as400_version');
    });
  });

  describe('checkpoints', () => {
    it('always covers the ACOS character codes, and the network database when there is one', () => {
      expect(evaluate(acosAnswers).checkpoints).toContain('acos_charset');
      const adbs = evaluate({
        ...acosAnswers,
        support_end: 'beyond_3y',
        acos_database: ['adbs', 'files'],
        acos_languages: ['simple'],
      });
      expect(adbs.checkpoints).toEqual([
        'acos_charset',
        'acos_network_db',
        'acos_simple_language',
        'acos_online',
      ]);
    });

    it('puts missing source and a near deadline first and shows at most four', () => {
      const result = evaluate({
        ...as400Answers,
        source_docs: 'source_missing',
        support_end: 'within_1y',
        as400_languages: ['rpg3'],
        integrations: 'many',
        gaiji: 'many',
      });
      expect(result.checkpoints).toEqual([
        'source_missing',
        'support_deadline',
        'rpg3',
        'integrations_many',
      ]);
    });

    it('adds the AS/400 follow-up findings: devices and data staff pull out themselves', () => {
      const result = evaluate({
        ...as400Answers,
        as400_devices: ['labels', 'handheld'],
        as400_query: 'many',
      });
      expect(result.checkpoints).toEqual([
        'docs_outdated',
        'as400_devices',
        'as400_query',
        'as400_screens',
      ]);
    });

    it('lists Access-specific work that fits the recommended path (#303)', () => {
      // Fix: no web system suggested
      expect(evaluate(accessAnswers).checkpoints).toEqual([
        'access_no_maintainer',
        'access_support',
        'access_64bit',
        'access_backup',
      ]);
      // Web: the web system, then the VBA and Excel work to rebuild
      expect(
        evaluate({
          ...accessAnswers,
          access_maintainer: 'team',
          access_version: ['m365'],
          access_challenges: ['remote'],
        }).checkpoints
      ).toEqual(['access_web', 'access_vba', 'access_excel']);
      // Replace: whether a service covers the tool, and how to move the data
      expect(
        evaluate({
          ...accessAnswers,
          access_maintainer: 'team',
          access_version: ['m365'],
          access_screens_forms: 'lt20',
          access_features: ['excel'],
        }).checkpoints
      ).toEqual(['access_replace_fit', 'access_data_export']);
    });

    it('no longer suggests a web system on every Access result (#303)', () => {
      expect(evaluate(accessAnswers).checkpoints).not.toContain('access_web');
    });

    it('keeps the path of an Access result in the public result, and null elsewhere (#303)', () => {
      expect(toPublicResult(evaluate(accessAnswers)).accessPath).toEqual({
        path: 'fix',
        reasons: ['support_end', 'rules_in_tool'],
      });
      expect(toPublicResult(evaluate(as400Answers)).accessPath).toBeNull();
      // Stored before #303
      const { accessPath: _omitted, ...stored } = evaluate(accessAnswers);
      expect(toPublicResult(stored as ReturnType<typeof evaluate>).accessPath).toBeNull();
    });

    it('starts many Access tools with an inventory', () => {
      const result = evaluate({
        ...accessAnswers,
        access_maintainer: 'team',
        access_version: ['m365'],
        access_tools: '21_50',
      });
      expect(result.checkpoints[0]).toBe('access_inventory');
    });
  });

  describe('SQL signals (①②必須＋③④のいずれか)', () => {
    it('is a candidate when the system is known, the problem is felt and the timeline is near', () => {
      expect(evaluate(as400Answers).sqlSignals).toEqual({
        candidate: true,
        systemKnown: true,
        problemAware: true,
        timelineVisible: true,
        decisionAccess: true,
      });
    });

    it('does not know the system while the size is unknown', () => {
      const result = evaluate({ ...acosAnswers, acos_programs: 'unknown' });
      expect(result.sqlSignals.systemKnown).toBe(false);
      expect(result.sqlSignals.candidate).toBe(false);
    });

    it('counts an ended support as problem awareness', () => {
      const result = evaluate({
        ...otherAnswers,
        challenges: ['none'],
        support_end: 'passed',
      });
      expect(result.sqlSignals.problemAware).toBe(true);
    });
  });

  describe('needsHearing', () => {
    it('asks for a hearing when half the technical answers are unknown', () => {
      const result = evaluate({
        ...as400Answers,
        maintenance: 'unknown',
        support_end: 'unknown',
        integrations: 'unknown',
      });
      expect(result.needsHearing).toBe(true);
    });

    it('does not for a single unknown', () => {
      expect(evaluate({ ...as400Answers, integrations: 'unknown' }).needsHearing).toBe(
        false
      );
    });
  });

  describe('primary challenge', () => {
    it('is people when one or two people keep the system running', () => {
      const result = evaluate({ ...as400Answers, challenges: ['none'] });
      expect(result.challenges.primary).toBe('people');
    });

    it('maps the server-based challenges onto the four categories', () => {
      const result = evaluate({
        ...otherAnswers,
        challenges: ['blackbox', 'deadline', 'remote'],
      });
      expect(result.challenges.selected.sort()).toEqual(['agility', 'people']);
    });

    it('maps the Access challenges onto the four categories', () => {
      const result = evaluate({ ...accessAnswers, access_challenges: ['manual', 'remote'] });
      expect(result.challenges.selected.sort()).toEqual(['agility', 'cost']);
    });

    it('counts the worry about Office support as a challenge, not as none', () => {
      const result = evaluate({
        ...accessAnswers,
        access_maintainer: 'team',
        access_version: ['m365'],
        access_challenges: ['support'],
      });
      expect(result.challenges.primary).toBe('agility');
      expect(result.challenges.selected).toEqual(['agility']);
    });

    it('is empty when there is no challenge and nothing points at one', () => {
      const result = evaluate({ ...otherAnswers, challenges: ['none'] });
      expect(result.challenges.primary).toBeNull();
    });
  });

  it('shows the respondent no lead score or sales judgement', () => {
    const result = toPublicResult(evaluate(as400Answers));
    expect(Object.keys(result).sort()).toEqual([
      'accessPath',
      'challenges',
      'checkpoints',
      'difficulty',
      'needsHearing',
      'platform',
      'reasons',
      'recommendation',
      'urgency',
    ]);
  });
});

describe('answeredChallengesIn (#658)', () => {
  it('lists the chosen options of one category from either challenge question', () => {
    const answers = { challenges: ['deadline', 'people', 'remote'], access_challenges: ['support', 'manual'] };
    expect(answeredChallengesIn(answers, 'agility')).toEqual([
      { questionId: 'challenges', value: 'deadline' },
      { questionId: 'challenges', value: 'remote' },
      { questionId: 'access_challenges', value: 'support' },
    ]);
    expect(answeredChallengesIn(answers, 'cost')).toEqual([
      { questionId: 'access_challenges', value: 'manual' },
    ]);
  });

  it('gives nothing for "none" or no answer', () => {
    expect(answeredChallengesIn({ challenges: ['none'] }, 'agility')).toEqual([]);
    expect(answeredChallengesIn({}, 'people')).toEqual([]);
  });
});
