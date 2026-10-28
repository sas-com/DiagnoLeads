import type { HelpArticle } from '../types';

export const leadHandoffArticle: HelpArticle = {
  id: 'lead-handoff',
  locale: 'ja',
  title: '引き継ぎ書',
  summary:
    '営業から技術部門へ渡す内容を1枚にまとめた画面です。商談が初回ヒアリングから次の段階へ進むとでき、そのまま印刷できます。',
  routes: ['/leads/[leadId]/handoff'],
  reviewedAt: '2026-10-28',
  blocks: [
    { type: 'h2', id: 'contents', text: '載っているもの' },
    {
      type: 'ul',
      items: [
        '商談フェーズ・引き継いだ日・営業の担当者',
        '初回商談のヒアリングの内容',
        '未確認の項目と、次回に確認すること',
        '持ち帰り事項（期限と確認先）',
      ],
    },
    { type: 'h2', id: 'how', text: '使い方' },
    {
      type: 'steps',
      items: [
        'リードの詳細で、商談フェーズを初回ヒアリングから次の段階へ進めます。',
        [
          { type: 'text', text: 'リードの詳細に出る' },
          { type: 'ui', text: '引き継ぎ書を開く' },
          { type: 'text', text: 'から、この画面を開きます。' },
        ],
        [
          { type: 'text', text: '内容を確かめ、必要なら' },
          { type: 'ui', text: '印刷' },
          { type: 'text', text: 'で紙や PDF にします。' },
        ],
      ],
    },
    {
      type: 'p',
      content: [
        { type: 'link', text: '組織の設定', href: '/settings/organization' },
        {
          type: 'text',
          text: 'で引き継ぎ書の送り先（技術部門のメンバーなど）を選んでおくと、引き継ぎ書ができたときにその人へ知らせます。送り先はオーナーと管理者が変えられます。',
        },
      ],
    },
    {
      type: 'faq',
      items: [
        {
          question: '「まだ初回ヒアリングから先に進んでいません」と出ます',
          answer:
            '商談フェーズが初回ヒアリングのままです。リードの詳細で商談フェーズを進めると、引き継ぎ先に知らせます。',
        },
        {
          question: 'ヒアリングの内容が空です',
          answer:
            'ヒアリングが記録されていません。リードの詳細の「ヒアリングを記録」から記録してください。',
        },
      ],
    },
  ],
};
