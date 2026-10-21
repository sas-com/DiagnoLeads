import {
  type AxMqlFacts,
  type AxMqlRules,
  judgeAxMql,
  mergeLeadMql,
  readAxMql,
  withConsultationSignal,
} from '@/lib/features/diagnostics/ax-migration/mql';
import { describe, expect, it } from 'vitest';

const rules: AxMqlRules = {
  anyIndustryPlatforms: ['access'],
  anySizePlatforms: ['access'],
  strongSignals: {
    consultation: true,
    supportEnd: ['passed', 'within_1y'],
    accessSupport: ['ended', 'ending'],
    accessSupportWith: {
      importance: ['main', 'company'],
      users: ['11_30', 'gte31'],
      features: ['external_data'],
      locations: ['database'],
    },
    roles: ['executive'],
    timelines: ['within_1y'],
  },
  minScore: null,
};

/** Fit, with nothing that shows interest */
const fit: AxMqlFacts = {
  industry: true,
  system: true,
  consultationRequested: false,
  supportEnd: '1_3y',
  accessSupport: undefined,
  role: 'it_staff',
  timeline: '2_3y',
  leadScore: 50,
};

describe('judgeAxMql', () => {
  // #150: only a size outside the target ranges fails the required condition
  it.each([
    ['not_fit', 'none', ['company_size']],
    ['unknown', 'fit', []],
    ['fit', 'fit', []],
    ['not_configured', 'fit', []],
  ] as const)('with a company size %s the lead is %s', (companySize, level, unmet) => {
    const mql = judgeAxMql({ ...fit, companySize }, rules);
    expect(mql.level).toBe(level);
    expect(mql.unmet).toEqual(unmet);
    expect(mql.criteria.companySize).toBe(companySize);
  });

  it('keeps a company outside the size ranges out even after a consultation request', () => {
    const stored = judgeAxMql({ ...fit, companySize: 'not_fit' }, rules);
    const requested = withConsultationSignal(stored, rules);
    expect(requested).toMatchObject({ level: 'none', qualified: false, unmet: ['company_size'] });
    expect(readAxMql(stored).unmet).toEqual(['company_size']);
  });

  it('is fit only with the required conditions and no strong signal', () => {
    expect(judgeAxMql(fit, rules)).toEqual({
      level: 'fit',
      qualified: false,
      candidate: true,
      criteria: { industry: true, system: true, action: false, companySize: 'not_configured' },
      signals: [],
      unmet: [],
      waived: [],
    });
  });

  it.each([
    ['consultation', { consultationRequested: true }],
    ['support_deadline', { supportEnd: 'within_1y' }],
    ['support_deadline', { accessSupport: 'ending', access: { importance: 'main' } }],
    ['decision_role', { role: 'executive' }],
    ['timeline_soon', { timeline: 'within_1y' }],
  ] as const)('is interested (MQL) with the %s signal', (signal, change) => {
    expect(judgeAxMql({ ...fit, ...change }, rules)).toMatchObject({
      level: 'interest',
      qualified: true,
      candidate: true,
      signals: [signal],
    });
  });

  it('lists every signal found, in a fixed order', () => {
    const judged = judgeAxMql(
      { ...fit, timeline: 'within_1y', role: 'executive', consultationRequested: true },
      rules
    );
    expect(judged.signals).toEqual(['consultation', 'decision_role', 'timeline_soon']);
  });

  it('counts the minimum score as interest only when one is set', () => {
    expect(judgeAxMql({ ...fit, leadScore: 90 }, rules).level).toBe('fit');
    const withScore = { ...rules, minScore: 70 };
    expect(judgeAxMql({ ...fit, leadScore: 70 }, withScore)).toMatchObject({
      level: 'interest',
      signals: ['min_score'],
    });
    expect(judgeAxMql({ ...fit, leadScore: 69 }, withScore).level).toBe('fit');
  });

  it('is neither without the required conditions, even with signals, and says which', () => {
    expect(
      judgeAxMql({ ...fit, industry: false, system: false, consultationRequested: true }, rules)
    ).toMatchObject({
      level: 'none',
      qualified: false,
      candidate: false,
      signals: ['consultation'],
      unmet: ['industry', 'system'],
    });
    expect(judgeAxMql({ ...fit, system: false }, rules).unmet).toEqual(['system']);
  });

  it('turns a signal off with an empty list or false', () => {
    const off: AxMqlRules = {
      ...rules,
      strongSignals: {
        consultation: false,
        supportEnd: [],
        accessSupport: [],
        accessSupportWith: rules.strongSignals.accessSupportWith,
        roles: [],
        timelines: [],
      },
      minScore: null,
    };
    const judged = judgeAxMql(
      { ...fit, consultationRequested: true, supportEnd: 'passed', role: 'executive' },
      off
    );
    expect(judged.level).toBe('fit');
  });

  it('makes fit enough under the old rule (completing the diagnosis is the action)', () => {
    expect(judgeAxMql(fit, rules, true)).toMatchObject({
      level: 'interest',
      signals: ['web_diagnosis'],
    });
  });
});

// #292 (owner 2026-10-21): Access takes any industry and size; its support end needs an impact
describe('judgeAxMql on the Access path', () => {
  const access: AxMqlFacts = { ...fit, platform: 'access' };

  it('counts the support end alone as no signal', () => {
    for (const accessSupport of ['ended', 'ending']) {
      expect(judgeAxMql({ ...access, accessSupport }, rules)).toMatchObject({
        level: 'fit',
        signals: [],
      });
    }
    // Answers below the bar do not qualify it either
    const low = {
      importance: 'support',
      users: '3_10',
      features: ['vba', 'excel'],
      location: 'shared_folder',
    };
    expect(judgeAxMql({ ...access, accessSupport: 'ended', access: low }, rules).level).toBe(
      'fit'
    );
  });

  it.each([
    [{ importance: 'main' }],
    [{ importance: 'company' }],
    [{ users: '11_30' }],
    [{ users: 'gte31' }],
    [{ features: ['vba', 'external_data'] }],
    [{ location: 'database' }],
  ])('counts the support end with %j as interest', (impact) => {
    for (const accessSupport of ['ended', 'ending']) {
      expect(judgeAxMql({ ...access, accessSupport, access: impact }, rules)).toMatchObject({
        level: 'interest',
        signals: ['support_deadline'],
      });
    }
  });

  it('needs the support end: an impact answer alone is no signal', () => {
    const judged = judgeAxMql(
      { ...access, accessSupport: 'm365', access: { importance: 'company', users: 'gte31' } },
      rules
    );
    expect(judged.level).toBe('fit');
  });

  it('still counts another strong signal without an impact answer', () => {
    expect(
      judgeAxMql({ ...access, accessSupport: 'ended', role: 'executive' }, rules)
    ).toMatchObject({ level: 'interest', signals: ['decision_role'] });
  });

  it('does not count the support end when the qualifying lists are empty', () => {
    const none: AxMqlRules = {
      ...rules,
      strongSignals: {
        ...rules.strongSignals,
        accessSupportWith: { importance: [], users: [], features: [], locations: [] },
      },
    };
    const judged = judgeAxMql(
      { ...access, accessSupport: 'ended', access: { importance: 'company' } },
      none
    );
    expect(judged.level).toBe('fit');
  });

  it('is fit in any industry and at any company size, and shows neither as unmet', () => {
    const judged = judgeAxMql({ ...access, industry: false, companySize: 'not_fit' }, rules);
    expect(judged).toMatchObject({
      level: 'fit',
      candidate: true,
      unmet: [],
      waived: ['industry', 'company_size'],
      // What the answers say is kept for sales
      criteria: { industry: false, companySize: 'not_fit' },
    });
  });

  it('still requires the system', () => {
    expect(judgeAxMql({ ...access, system: false }, rules)).toMatchObject({
      level: 'none',
      unmet: ['system'],
    });
  });

  it('keeps the waiver when the stored judgement is read or a consultation is added', () => {
    const stored = judgeAxMql({ ...access, industry: false, companySize: 'not_fit' }, rules);
    expect(readAxMql(stored)).toMatchObject({ level: 'fit', candidate: true, unmet: [] });
    expect(withConsultationSignal(stored, rules)).toMatchObject({
      level: 'interest',
      signals: ['consultation'],
      waived: ['industry', 'company_size'],
    });
  });

  it('keeps industry and size required on the host paths', () => {
    for (const platform of ['as400', 'acos', 'other']) {
      const judged = judgeAxMql(
        { ...fit, platform, industry: false, companySize: 'not_fit' },
        rules
      );
      expect(judged).toMatchObject({
        level: 'none',
        unmet: ['industry', 'company_size'],
        waived: [],
      });
    }
  });

  it('leaves the host support end as it was', () => {
    expect(judgeAxMql({ ...fit, platform: 'as400', supportEnd: 'passed' }, rules)).toMatchObject({
      level: 'interest',
      signals: ['support_deadline'],
    });
  });
});

describe('readAxMql', () => {
  it('reads a result saved before #139 (no level) as fit or none', () => {
    const old = { qualified: true, candidate: true, criteria: { industry: true, system: true, action: true } };
    expect(readAxMql(old)).toMatchObject({ level: 'fit', qualified: false, signals: [] });
    expect(readAxMql({ candidate: false, criteria: { industry: false, system: true } })).toMatchObject({
      level: 'none',
      unmet: ['industry'],
    });
    expect(readAxMql(null).level).toBe('none');
  });

  it('keeps a stored level and known signals only', () => {
    expect(
      readAxMql({ level: 'interest', candidate: true, signals: ['decision_role', 'unknown'] })
    ).toMatchObject({ level: 'interest', qualified: true, signals: ['decision_role'] });
  });
});

describe('withConsultationSignal', () => {
  it('turns a fit result into interest', () => {
    const stored = judgeAxMql(fit, rules);
    expect(withConsultationSignal(stored, rules)).toMatchObject({
      level: 'interest',
      qualified: true,
      signals: ['consultation'],
    });
  });

  it('upgrades a result saved before #139 that was fit', () => {
    const old = { qualified: true, candidate: true, criteria: { industry: true, system: true } };
    expect(withConsultationSignal(old, rules).level).toBe('interest');
  });

  it('leaves a result outside the target outside', () => {
    const stored = judgeAxMql({ ...fit, industry: false }, rules);
    expect(withConsultationSignal(stored, rules)).toMatchObject({
      level: 'none',
      signals: ['consultation'],
    });
  });

  it('changes nothing when the consultation is not a signal', () => {
    const stored = judgeAxMql(fit, rules);
    const off = { ...rules, strongSignals: { ...rules.strongSignals, consultation: false } };
    expect(withConsultationSignal(stored, off).level).toBe('fit');
  });
});

describe('mergeLeadMql', () => {
  const interest = { level: 'interest' as const, signals: ['decision_role' as const], unmet: [] };
  const fitOnly = { level: 'fit' as const, signals: [], unmet: [] };

  it('takes the next judgement when the lead has none (created before #139)', () => {
    expect(mergeLeadMql(undefined, fitOnly)).toEqual(fitOnly);
  });

  it('keeps the higher level and never goes down', () => {
    expect(mergeLeadMql(fitOnly, interest)).toEqual(interest);
    expect(mergeLeadMql(interest, fitOnly)).toEqual(interest);
  });

  it('adds up the signals of the same level', () => {
    expect(
      mergeLeadMql(interest, { level: 'interest', signals: ['consultation'], unmet: [] }).signals
    ).toEqual(['consultation', 'decision_role']);
  });
});
