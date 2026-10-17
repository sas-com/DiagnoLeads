/**
 * Whether the customer allows AI source code analysis (Refs #160): reading the hearing answer,
 * when the assignee is told, and the notice text. Made-up names.
 */
import {
  aiSourceAnalysisOf,
  buildRestrictionNotice,
  isRestricted,
  shouldNotifyRestriction,
} from '@/lib/features/lead-hearings/ai-policy';
import { getHearingField } from '@/lib/features/lead-hearings/catalog';
import { describe, expect, it } from 'vitest';

const entry = (value: string) => ({ value, status: 'done' as const, source: null });

describe('hearing field', () => {
  it('asks allowed / on conditions / not allowed / unknown among the requirements', () => {
    const field = getHearingField('aiSourceAnalysis');
    expect(field).toMatchObject({ section: 'requirements', type: 'single' });
    expect(field && 'options' in field ? field.options.map((o) => o.value) : []).toEqual([
      'allowed',
      'conditional',
      'not_allowed',
      'unknown',
    ]);
    expect(getHearingField('aiSourceAnalysisConditions')).toMatchObject({ type: 'text' });
  });
});

describe('aiSourceAnalysisOf', () => {
  it('reads the answer and the conditions, and nothing when not recorded', () => {
    expect(
      aiSourceAnalysisOf({
        aiSourceAnalysis: entry('conditional'),
        aiSourceAnalysisConditions: entry('  社内の閉域環境のみ '),
      })
    ).toEqual({ value: 'conditional', conditions: '社内の閉域環境のみ' });
    expect(aiSourceAnalysisOf({ aiSourceAnalysis: entry('allowed') })).toEqual({
      value: 'allowed',
      conditions: null,
    });
    expect(aiSourceAnalysisOf({})).toBeNull();
    expect(
      aiSourceAnalysisOf({ aiSourceAnalysis: { status: 'next', source: null } })
    ).toBeNull();
  });
});

describe('isRestricted / shouldNotifyRestriction', () => {
  const policy = (value: 'allowed' | 'conditional' | 'not_allowed' | 'unknown') => ({
    value,
    conditions: null,
  });

  it('treats "not allowed" and "on conditions" as restrictions', () => {
    expect(isRestricted(policy('not_allowed'))).toBe(true);
    expect(isRestricted(policy('conditional'))).toBe(true);
    expect(isRestricted(policy('allowed'))).toBe(false);
    expect(isRestricted(policy('unknown'))).toBe(false);
    expect(isRestricted(null)).toBe(false);
  });

  it('tells only when the answer becomes a (different) restriction', () => {
    expect(shouldNotifyRestriction(null, policy('not_allowed'))).toBe(true);
    expect(shouldNotifyRestriction(policy('unknown'), policy('conditional'))).toBe(true);
    expect(shouldNotifyRestriction(policy('conditional'), policy('not_allowed'))).toBe(true);
    // Autosave of an unchanged answer
    expect(shouldNotifyRestriction(policy('not_allowed'), policy('not_allowed'))).toBe(false);
    expect(shouldNotifyRestriction(policy('not_allowed'), policy('allowed'))).toBe(false);
    expect(shouldNotifyRestriction(null, null)).toBe(false);
  });
});

describe('buildRestrictionNotice', () => {
  it('names the lead, the answer, who recorded it and the conditions', () => {
    const notice = buildRestrictionNotice({
      policy: { value: 'conditional', conditions: '社内の閉域環境のみ' },
      leadName: '山田 花子',
      company: '架空商事',
      recordedByName: '営業 太郎',
    });
    expect(notice.title).toBe('【要確認】架空商事 山田 花子 様：AI でのソースコード解析は「条件付き」');
    expect(notice.message).toContain('営業 太郎 さんが');
    expect(notice.message).toContain('条件：社内の閉域環境のみ');
  });
});
