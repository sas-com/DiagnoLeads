import type { HelpArticle } from '../types';

export const organizationsNewArticle: HelpArticle = {
  id: 'organizations-new',
  locale: 'ja',
  title: '組織を作成',
  summary:
    '新しい組織を作ります。リードや診断の結果は組織ごとに分けて管理され、作った人がその組織のオーナーになります。',
  routes: ['/organizations/new'],
  reviewedAt: '2026-10-28',
  blocks: [
    {
      type: 'steps',
      items: [
        '組織名を入れます。',
        '組織スラッグ（組織を見分ける識別子）を、小文字の英数字とハイフンで入れます。ほかの組織と同じものは使えません。',
        [
          { type: 'ui', text: '作成する' },
          { type: 'text', text: 'を押します。' },
        ],
      ],
    },
    {
      type: 'p',
      content: [
        { type: 'text', text: '作ったあとは、' },
        { type: 'link', text: 'メンバー管理', href: '/settings/members' },
        { type: 'text', text: 'でメンバーを招待し、' },
        { type: 'link', text: '組織設定', href: '/settings/organization' },
        { type: 'text', text: 'で相談申込の窓口とヒアリングの項目を決めます。' },
      ],
    },
    {
      type: 'note',
      tone: 'tip',
      content:
        'ほかの組織のリードは、組織を切り替えるまで見えません。組織はヘッダーの組織の切り替えで選びます。',
    },
  ],
};
