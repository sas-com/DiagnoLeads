import type { HelpArticle } from '../types';

export const analyticsArticle: HelpArticle = {
  id: 'analytics',
  locale: 'ja',
  title: '分析ダッシュボード',
  summary:
    'リードの獲得と、その後の進み具合を期間・流入元ごとに分析します。月の振り返りや、獲得の費用対効果の確認に使います。',
  routes: ['/analytics'],
  reviewedAt: '2026-10-28',
  related: ['glossary'],
  blocks: [
    { type: 'h2', id: 'tabs', text: 'タブ' },
    {
      type: 'table',
      header: ['タブ', '見るもの'],
      rows: [
        ['概要', 'リードの推移、状態の分布、MQL段階の内訳'],
        [
          '流入元',
          '流入元の内訳と詳細、流入元別の獲得費用、受注と費用対効果、営業代行の契約別のファネルと獲得単価',
        ],
        ['ファネル', 'リードが成約まで進む割合と、現行調査 → 移行 → AX 化の段階の進み具合'],
        ['パフォーマンス', '応答時間（初回連絡の記録をもとに出す予定で、今は準備中）'],
      ],
    },
    {
      type: 'p',
      content:
        '期間は、過去7日・30日・90日・全期間から選びます。MQL段階の内訳は、段階を押すとその条件でリード一覧が開きます。',
    },
    { type: 'h2', id: 'cost', text: '獲得費用と費用対効果' },
    {
      type: 'p',
      content:
        'リードに記録した獲得費用（税抜）を流入元ごとに足し、1 SQL あたり・1 成約あたりの費用と、受注額 ÷ 獲得費用（ROI）を出します。費用を記録していないリードは件数にだけ入ります。',
    },
    {
      type: 'note',
      tone: 'tip',
      content:
        '費用対効果を正しく出すには、営業代行や広告から来たリードに獲得費用を入れておきます。',
    },
    {
      type: 'p',
      content: [
        { type: 'ui', text: 'エクスポート' },
        { type: 'text', text: 'で分析のレポートをファイルに書き出せます。公開ページの訪問者数は' },
        { type: 'link', text: 'サイトの訪問', href: '/analytics/site' },
        { type: 'text', text: 'で見ます。' },
      ],
    },
  ],
};
