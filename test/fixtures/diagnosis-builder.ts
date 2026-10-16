/**
 * A fictional "cloud readiness" quiz for diagnosis builder tests.
 * Generic made-up content only (the repository is public).
 *
 * Paths: hosting = onprem / hybrid → section "plan"; hosting = cloud → section "practices".
 * Axes: infra (weight 2) and people (weight 1).
 */
import type { DiagnosisDefinition } from '@/lib/features/diagnosis-builder/definition';

const base: DiagnosisDefinition = {
  schemaVersion: 1,
  locale: 'ja',
  title: 'クラウド準備度チェック（テスト用）',
  description: 'テスト用の架空の診断です。',
  sections: [
    { id: 'basics', title: '現状', questionIds: ['hosting', 'team_size'] },
    {
      id: 'plan',
      title: '移行の予定',
      questionIds: ['migration_plan'],
      showWhen: { questionId: 'hosting', anyOf: ['onprem', 'hybrid'] },
    },
    {
      id: 'practices',
      title: '運用',
      questionIds: ['practices'],
      showWhen: { questionId: 'hosting', anyOf: ['cloud'] },
    },
    { id: 'wrap', title: '最後に', questionIds: ['confidence', 'notes'] },
  ],
  questions: [
    {
      id: 'hosting',
      type: 'single',
      label: 'システムはどこで動いていますか',
      required: true,
      options: [
        { value: 'onprem', label: '自社設備', scores: { infra: 0 } },
        { value: 'hybrid', label: '併用', scores: { infra: 2 } },
        { value: 'cloud', label: 'クラウド', scores: { infra: 4 } },
      ],
    },
    {
      id: 'team_size',
      type: 'number_range',
      label: '担当者の人数',
      required: true,
      min: 1,
      max: 1000,
      unit: '人',
      bands: [
        { min: 1, max: 9, scores: { people: 0 } },
        { min: 10, max: 99, scores: { people: 2 } },
        { min: 100, max: 1000, scores: { people: 4 } },
      ],
    },
    {
      id: 'migration_plan',
      type: 'single',
      label: '移行の予定',
      required: true,
      options: [
        { value: 'none', label: '予定なし', scores: { infra: 0 } },
        { value: 'later', label: '来年以降', scores: { infra: 1 } },
        { value: 'this_year', label: '今年中', scores: { infra: 3 } },
      ],
    },
    {
      id: 'practices',
      type: 'multiple',
      label: '取り組んでいること',
      required: true,
      options: [
        { value: 'iac', label: '構成のコード化', scores: { infra: 2 } },
        { value: 'monitoring', label: '監視', scores: { infra: 1, people: 1 } },
        { value: 'training', label: '研修', scores: { people: 2 } },
        { value: 'none', label: '特になし', scores: { infra: 0 } },
      ],
      exclusiveOptions: ['none'],
    },
    {
      id: 'confidence',
      type: 'scale',
      label: '自信の度合い',
      required: true,
      min: 1,
      max: 5,
      minLabel: '低い',
      maxLabel: '高い',
      scores: { people: 4 },
    },
    { id: 'notes', type: 'text', label: '自由記述', required: false, maxLength: 200 },
  ],
  axes: [
    { id: 'infra', name: '基盤', weight: 2 },
    { id: 'people', name: '体制', weight: 1 },
  ],
  tierSets: [
    {
      id: 'overall',
      tiers: [
        { id: 'low', name: '準備段階', color: '#d14343', minPct: 0, maxPct: 40 },
        { id: 'mid', name: '移行中', color: '#e0a100', minPct: 40, maxPct: 70 },
        { id: 'high', name: '活用段階', color: '#1f9d55', minPct: 70, maxPct: 100 },
      ],
    },
    {
      id: 'infra_tiers',
      axisId: 'infra',
      tiers: [
        { id: 'weak', name: '弱い', color: '#d14343', minPct: 0, maxPct: 50 },
        { id: 'strong', name: '強い', color: '#1f9d55', minPct: 50, maxPct: 100 },
      ],
    },
  ],
  resultTypes: [
    {
      id: 'leader',
      name: '先行型',
      when: { match: 'all', conditions: [{ type: 'tier', tierSetId: 'overall', anyOf: ['high'] }] },
    },
    {
      id: 'planner',
      name: '計画型',
      when: {
        match: 'any',
        conditions: [{ type: 'answer', questionId: 'migration_plan', anyOf: ['this_year'] }],
      },
    },
    { id: 'starter', name: '準備型', when: { match: 'all', conditions: [] } },
  ],
  resultBlocks: [
    { type: 'heading', text: '診断結果' },
    { type: 'score' },
    { type: 'axisChart' },
    {
      type: 'tierText',
      tierSetId: 'overall',
      texts: { low: '低い段階です。', mid: '中間です。', high: '進んでいます。' },
    },
    { type: 'text', text: '計画型の方へ', onlyFor: ['planner'] },
    { type: 'cta', label: '相談する', url: 'https://example.com/contact' },
  ],
  leadScore: {
    rules: [
      {
        id: 'large_team',
        when: { match: 'all', conditions: [{ type: 'number', questionId: 'team_size', min: 100 }] },
        points: 30,
        reasonKey: 'reason_large_team',
      },
      {
        id: 'near_term',
        when: {
          match: 'all',
          conditions: [{ type: 'answer', questionId: 'migration_plan', anyOf: ['this_year'] }],
        },
        points: 40,
        reasonKey: 'reason_near_term',
      },
    ],
  },
  mql: {
    required: [{ type: 'number', questionId: 'team_size', min: 10 }],
    strongSignals: [
      {
        id: 'near_term_signal',
        when: {
          match: 'all',
          conditions: [{ type: 'answer', questionId: 'migration_plan', anyOf: ['this_year'] }],
        },
        reasonKey: 'signal_near_term',
      },
    ],
    minScore: 50,
  },
  consent: { version: '2026-10-01', text: '回答内容の利用に同意します。' },
};

/** A fresh copy that each test may change */
export const cloudReadiness = (): DiagnosisDefinition => structuredClone(base);
