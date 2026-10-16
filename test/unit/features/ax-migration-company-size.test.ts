/**
 * Company size questions and the target customer check of the AX diagnosis (Refs #150).
 */
import {
  AX_COMPANY_SIZE_OPTIONS,
  type AxTargetCompany,
  emptyAxTargetCompany,
  evaluateCompanySize,
} from '@/lib/features/diagnostics/ax-migration/company-size';
import { axMigrationDefinition } from '@/lib/features/diagnostics/ax-migration/definition';
import { buildSalesMessage } from '@/lib/features/diagnostics/ax-migration/notify';
import { evaluateAxMigration } from '@/lib/features/diagnostics/ax-migration/evaluate';
import { validateAnswers } from '@/lib/features/diagnostics/engine';
import { as400Answers } from '@/test/fixtures/ax-migration';
import { describe, expect, it } from 'vitest';

const target = (values: Partial<AxTargetCompany>): AxTargetCompany => ({
  ...emptyAxTargetCompany(),
  ...values,
});
const MID_SIZED = target({ annual_revenue: ['1b_3b', '3b_10b'], employees: ['50_299'] });

describe('company size questions', () => {
  it('are optional, offer "I don\'t know" and use the ranges of the code', () => {
    for (const [id, values] of Object.entries(AX_COMPANY_SIZE_OPTIONS)) {
      const question = axMigrationDefinition.questions.find((q) => q.id === id);
      expect(question, id).toMatchObject({ type: 'single', required: false });
      expect(question?.detail, id).toBeUndefined();
      expect(question?.options.map((o) => o.value)).toEqual([...values, 'unknown']);
    }
  });

  it('let a respondent skip them', () => {
    expect(validateAnswers(axMigrationDefinition, as400Answers).success).toBe(true);
    const answered = validateAnswers(axMigrationDefinition, {
      ...as400Answers,
      annual_revenue: '3b_10b',
      employees: 'unknown',
      sites: '2_4',
    });
    expect(answered.success).toBe(true);
  });

  it('reject a range the question does not offer', () => {
    const result = validateAnswers(axMigrationDefinition, { ...as400Answers, sites: '100' });
    expect(result.success).toBe(false);
  });
});

describe('evaluateCompanySize', () => {
  it('is not_configured without any condition', () => {
    expect(evaluateCompanySize({ annual_revenue: 'under_1b' }, null).fit).toBe('not_configured');
    expect(evaluateCompanySize({}, emptyAxTargetCompany()).fit).toBe('not_configured');
  });

  it('fits when every conditioned question is answered within the ranges', () => {
    expect(
      evaluateCompanySize({ annual_revenue: '3b_10b', employees: '50_299', sites: 'gte10' }, MID_SIZED)
    ).toEqual({ fit: 'fit', outside: [], unanswered: [] });
  });

  it('is not_fit when an answer is outside, even if another is unanswered', () => {
    expect(evaluateCompanySize({ annual_revenue: 'over_30b' }, MID_SIZED)).toEqual({
      fit: 'not_fit',
      outside: ['annual_revenue'],
      unanswered: ['employees'],
    });
  });

  it('is unknown when nothing is outside but a conditioned question is not answered', () => {
    expect(
      evaluateCompanySize({ annual_revenue: '1b_3b', employees: 'unknown' }, MID_SIZED)
    ).toEqual({ fit: 'unknown', outside: [], unanswered: ['employees'] });
  });
});

describe('evaluateAxMigration with a target company size', () => {
  it('keeps a company outside the target out of the MQL candidates', () => {
    const outside = evaluateAxMigration(
      { ...as400Answers, annual_revenue: 'over_30b' },
      undefined,
      undefined,
      MID_SIZED
    );
    expect(outside.mql.candidate).toBe(false);
    expect(outside.mql.qualified).toBe(false);
    expect(outside.mql.criteria.companySize).toBe('not_fit');
    expect(outside.companySize.outside).toEqual(['annual_revenue']);
  });

  it('never excludes a company that did not answer', () => {
    const skipped = evaluateAxMigration(as400Answers, undefined, undefined, MID_SIZED);
    expect(skipped.mql.candidate).toBe(true);
    expect(skipped.mql.criteria.companySize).toBe('unknown');
  });

  it('keeps the result without a target as before', () => {
    const plain = evaluateAxMigration({ ...as400Answers, annual_revenue: 'over_30b' });
    expect(plain.mql.candidate).toBe(true);
    expect(plain.mql.criteria.companySize).toBe('not_configured');
  });

  it('does not change what the respondent is offered', () => {
    const answers = { ...as400Answers, annual_revenue: 'over_30b' };
    expect(evaluateAxMigration(answers, undefined, undefined, MID_SIZED).recommendation).toBe(
      evaluateAxMigration(answers).recommendation
    );
  });

  it('tells sales the company size only when a condition is set', () => {
    const base = {
      organizationId: 'org',
      leadId: 'lead',
      submissionId: 'sub',
      company: 'テスト製作所',
      name: '山田',
      email: 'yamada@example.com',
      leadCreated: true,
      identityUnverified: false,
      consultationRequested: false,
      requestedAt: new Date('2026-10-16T01:00:00Z'),
    };
    const outside = evaluateAxMigration(
      { ...as400Answers, annual_revenue: 'over_30b' },
      undefined,
      undefined,
      MID_SIZED
    );
    expect(buildSalesMessage({ ...base, result: outside }).message).toContain(
      '企業規模: 対象外（MQL候補から除外）'
    );
    const plain = evaluateAxMigration(as400Answers);
    expect(buildSalesMessage({ ...base, result: plain }).message).not.toContain('企業規模');
  });
});
