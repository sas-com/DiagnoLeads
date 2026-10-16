/**
 * Builder diagnoses on the lead page and in the answers tab (Refs #121): the summary on the lead
 * read as typed values, and the answers labelled from the answered version.
 * Fictional diagnosis only.
 */
import { builderAnswerView } from '@/lib/features/lead-activity/service';
import { readLeadDiagnosis } from '@/lib/features/leads/diagnosis-view';
import { describe, expect, it } from 'vitest';
import { cloudReadiness } from '../../fixtures/diagnosis-builder';

const SUBMISSION = '44444444-4444-4444-8444-444444444444';

/** As written by submitBuilderDiagnosis (DiagnosisLeadSummary) */
const builderSummary = {
  diagnosisId: '55555555-5555-4555-8555-555555555555',
  slug: 'cloud-check',
  title: 'クラウド準備度チェック（テスト用）',
  version: 2,
  versionId: '66666666-6666-4666-8666-666666666666',
  submissionId: SUBMISSION,
  diagnosedAt: '2026-10-16T01:30:00.000Z',
  resultTypeId: 'planner',
  resultTypeName: '計画型',
  overall: 48,
  leadScore: 70,
  leadScoreReasons: ['担当者が100人以上', '今年中に移行の予定がある'],
  mqlLevel: 'interest',
  mqlQualified: true,
  mqlReasons: ['今年中に移行する予定（強いシグナル）', 'リードスコア 70 点（基準 50 点以上）'],
  consultationRequested: false,
};

describe('readLeadDiagnosis: builder summary', () => {
  it('reads the summary without showing it again as other data', () => {
    const view = readLeadDiagnosis({ diagnosis: builderSummary });
    expect(view.ax).toBeNull();
    expect(view.extra).toEqual([]);
    expect(view.builder).toEqual({
      submissionId: SUBMISSION,
      title: 'クラウド準備度チェック（テスト用）',
      version: 2,
      resultTypeName: '計画型',
      leadScore: 70,
      leadScoreReasons: ['担当者が100人以上', '今年中に移行の予定がある'],
      mqlLevel: 'interest',
      mqlReasons: ['今年中に移行する予定（強いシグナル）', 'リードスコア 70 点（基準 50 点以上）'],
      consultationRequested: false,
      diagnosedAt: '2026-10-16T01:30:00.000Z',
    });
  });

  it('keeps unknown keys as other data and reads wrong types as empty', () => {
    const view = readLeadDiagnosis({
      diagnosis: {
        ...builderSummary,
        version: 'two',
        leadScore: '70',
        mqlLevel: 'maybe',
        mqlQualified: false,
        mqlReasons: [1, ''],
        campaign: 'autumn',
      },
    });
    expect(view.builder).toMatchObject({
      version: null,
      leadScore: null,
      mqlLevel: 'none',
      mqlReasons: [],
    });
    expect(view.extra).toEqual([{ key: 'diagnosis.campaign', value: 'autumn' }]);
  });

  it('has no builder part for a lead without one (AX leads unchanged)', () => {
    expect(readLeadDiagnosis({})).toEqual({ ax: null, extra: [] });
    expect('builder' in readLeadDiagnosis({ diagnosis: 'text' })).toBe(false);
  });
});

describe('builderAnswerView', () => {
  it('labels the answers with the definition of the version answered', () => {
    const v1 = cloudReadiness();
    const view = builderAnswerView(
      {
        notes: '特になし',
        hosting: 'onprem',
        team_size: 150,
        practices: ['iac', 'gone'],
        confidence: 4,
        removed_question: 'x',
      },
      v1
    );
    expect(view.map((a) => [a.questionId, a.question.ja, a.values.map((v) => v.label.ja)])).toEqual(
      [
        ['hosting', 'システムはどこで動いていますか', ['自社設備']],
        ['team_size', '担当者の人数', ['150人']],
        ['practices', '取り組んでいること', ['構成のコード化', 'gone']],
        ['confidence', '自信の度合い', ['4（1〜5）']],
        ['notes', '自由記述', ['特になし']],
        ['removed_question', 'removed_question', ['x']],
      ]
    );
  });

  it('shows the stored values when the version is gone', () => {
    expect(builderAnswerView({ hosting: 'onprem', team_size: 3 }, null)).toEqual([
      {
        questionId: 'hosting',
        question: { ja: 'hosting', en: 'hosting' },
        detail: false,
        values: [{ value: 'onprem', label: { ja: 'onprem', en: 'onprem' } }],
      },
      {
        questionId: 'team_size',
        question: { ja: 'team_size', en: 'team_size' },
        detail: false,
        values: [{ value: '3', label: { ja: '3', en: '3' } }],
      },
    ]);
  });
});
