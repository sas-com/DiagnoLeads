import type { HelpArticle } from '../types';

export const dashboardArticle: HelpArticle = {
  id: 'dashboard',
  locale: 'ja',
  title: 'ダッシュボード',
  summary:
    '診断から届いたリードと、対応が必要な相談申込を1画面で確かめます。ログインしたら、まずここで連絡待ちの相談申込がないかを見ます。',
  routes: ['/dashboard'],
  reviewedAt: '2026-10-28',
  related: ['workflow-lifecycle'],
  blocks: [
    { type: 'h2', id: 'first', text: '最初に見るところ' },
    {
      type: 'steps',
      items: [
        [
          { type: 'ui', text: '連絡待ちの相談申込' },
          { type: 'text', text: 'を見て、期限の近いものから連絡します。' },
        ],
        [
          { type: 'ui', text: '今日やること' },
          { type: 'text', text: 'で、期限が今日までの次の行動と期限切れの次の行動を片付けます。' },
        ],
        [
          { type: 'ui', text: '今週の商談予定' },
          { type: 'text', text: 'で、今週の打ち合わせの準備が要るリードを確かめます。' },
        ],
      ],
    },
    {
      type: 'p',
      content: [
        { type: 'text', text: '自分の予定とやることだけを見たいときは、' },
        { type: 'link', text: '今日', href: '/today' },
        { type: 'text', text: 'の画面が向いています。' },
      ],
    },
    { type: 'h2', id: 'checklist', text: 'はじめにやること' },
    {
      type: 'p',
      content:
        '使い始めの間は、画面の上に役割に合ったチェックリストが出ます。オーナー・管理者には組織の設定（窓口・メンバーの招待・営業の手引きなど）、メンバーには使い方の最初の一歩が並びます。',
    },
    {
      type: 'ul',
      items: [
        '窓口・招待・営業の手引き・営業代行リンクは、設定が済むと自動で「済み」になります。ほかの項目は「済みにする」を押します。',
        '×で閉じると、そのブラウザでは次から出ません。',
      ],
    },
    { type: 'h2', id: 'pending', text: '連絡待ちの相談申込' },
    {
      type: 'p',
      content:
        '相談申込のあったリードを、連絡の期限の近い順に並べます。期限は申込から数えた営業日で、過ぎたものは「営業日超過」と出ます。',
    },
    {
      type: 'ul',
      items: [
        [
          { type: 'ui', text: '電話した' },
          { type: 'text', text: '・' },
          { type: 'ui', text: 'メールした' },
          { type: 'text', text: 'を記録すると一覧から外れます。' },
        ],
        [
          { type: 'ui', text: 'つながらなかった' },
          { type: 'text', text: 'を記録しても一覧に残ります。不通の回数が増えていきます。' },
        ],
      ],
    },
    { type: 'h2', id: 'figures', text: '数字とグラフ' },
    {
      type: 'table',
      header: ['表示', '意味'],
      rows: [
        ['集計期間', '7日・30日・90日から選びます。前の同じ日数との差も出ます'],
        ['新規リード', '期間中に作られたリードの数'],
        ['相談申込', '期間中に相談の申込があったリードの数'],
        [
          'MQL（関心あり）',
          '対象の業種・システムで、相談申込など関心を示す行動・回答があったリードの数',
        ],
        ['次回日程の決定率', '初回商談で次回の日程が決まった割合'],
        ['パイプライン', '全リードの状態ごとの件数'],
      ],
    },
    { type: 'h2', id: 'customize', text: '表示する項目を変える' },
    {
      type: 'steps',
      items: [
        [
          { type: 'ui', text: 'カスタマイズ' },
          { type: 'text', text: 'を押します。' },
        ],
        '項目ごとに表示・非表示を切り替え、上下の矢印で並び順を変えます。',
        [
          { type: 'text', text: '元に戻すときは' },
          { type: 'ui', text: 'デフォルトに戻す' },
          { type: 'text', text: 'を押します。' },
        ],
      ],
    },
    {
      type: 'note',
      tone: 'tip',
      content:
        '表示の設定は、使っているブラウザに保存されます。ほかのパソコンやスマートフォンでは、それぞれ設定し直してください。',
    },
    {
      type: 'roles',
      roles: ['parent_viewer'],
      content: '親組織の閲覧者は数字を見るだけで、連絡の記録はできません。',
    },
  ],
};
