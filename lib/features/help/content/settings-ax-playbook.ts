import type { HelpArticle } from '../types';

export const settingsAxPlaybookArticle: HelpArticle = {
  id: 'settings-ax-playbook',
  locale: 'ja',
  title: '営業の手引き',
  summary:
    'リードの画面に出す営業の手引き（課題別の聞き方・日程が決まらなかったときの文面など）と、対象顧客の規模を登録します。',
  routes: ['/settings/ax-playbook'],
  reviewedAt: '2026-10-28',
  blocks: [
    { type: 'h2', id: 'where', text: '登録した内容が出るところ' },
    {
      type: 'table',
      header: ['登録するもの', '出るところ'],
      rows: [
        [
          '課題別の手引き',
          'リードの詳細の「次に聞くこと」と事前調査カードの質問。診断結果の主な課題に合わせて出ます',
        ],
        ['まず確認する基本情報', 'この画面に控えとして残します（今はリードの画面には出ません）'],
        ['日程が決まらなかったときの文面', 'リードの詳細の切り返しカード'],
        ['対象顧客の規模', 'AX 診断の MQL 候補の判定。範囲外と答えた会社は MQL 候補から外します'],
      ],
    },
    { type: 'h2', id: 'how', text: '登録のしかた' },
    {
      type: 'steps',
      items: [
        '各欄に、1行に1項目ずつ入れます。表の欄は「行を追加」で足します。',
        [
          { type: 'ui', text: '保存' },
          { type: 'text', text: 'を押します。対象顧客の規模は「範囲を保存」で別に保存します。' },
        ],
      ],
    },
    {
      type: 'note',
      tone: 'caution',
      content:
        '手引きは社外秘です。この組織のデータベースにだけ保存されます。スクリーンショットなどで社外に共有しないでください。',
    },
    {
      type: 'roles',
      roles: ['member'],
      content: 'メンバーは見るだけで、変えられるのはオーナーと管理者です。',
    },
  ],
};
