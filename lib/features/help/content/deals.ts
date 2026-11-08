import type { HelpArticle } from '../types';

export const dealsArticle: HelpArticle = {
  id: 'deals',
  locale: 'ja',
  title: '商談',
  summary:
    '商談をステージごとに並べ、金額と受注予定日で進み具合を見ます。1つのリードに、現行調査・移行など複数の商談を持てます。',
  routes: ['/deals'],
  reviewedAt: '2026-10-28',
  related: ['workflow-lifecycle', 'glossary'],
  blocks: [
    { type: 'h2', id: 'stages', text: 'ステージ' },
    {
      type: 'table',
      header: ['ステージ', '確度の既定値'],
      rows: [
        ['見極め', '10%'],
        ['課題の確認', '20%'],
        ['提案', '40%'],
        ['条件の調整', '70%'],
        ['受注', '100%'],
        ['失注', '0%'],
      ],
    },
    {
      type: 'p',
      content:
        'ステージに入ると、確度はそのステージの既定値になります。商談ごとに直すこともできます。金額に確度を掛けたものが加重金額です。',
    },
    { type: 'h2', id: 'create', text: '商談を作る' },
    {
      type: 'steps',
      items: [
        [
          { type: 'ui', text: '商談を作成' },
          { type: 'text', text: 'を押します。リードの詳細の商談のカードからも作れます。' },
        ],
        'リードを選び、商談名を入れます。金額・受注予定日・担当などはあとから入れられます。',
      ],
    },
    { type: 'h2', id: 'move', text: 'ステージを動かす' },
    {
      type: 'ul',
      items: [
        [
          { type: 'strong', text: 'ボード' },
          {
            type: 'text',
            text: '：カードをほかのステージの列へドラッグするか、カードのメニューから移す先を選びます。',
          },
        ],
        [
          { type: 'strong', text: '元に戻す' },
          {
            type: 'text',
            text: '：開いているステージどうしの移動は、すぐ出る「元に戻す」で取り消せます。',
          },
        ],
        [
          { type: 'strong', text: '見極めから先へ' },
          {
            type: 'text',
            text: '：リードの SQL判定がまだなら、先に判定を聞かれます。適格なら先へ進み、不適格なら理由を付けて失注にします。',
          },
        ],
        [
          { type: 'strong', text: '受注・失注' },
          {
            type: 'text',
            text: '：受注日、または失注理由を入れて閉じます。失注理由は勝ち負けの分析に使います。',
          },
        ],
      ],
    },
    {
      type: 'note',
      tone: 'tip',
      content:
        'リードの状態と商談フェーズは、商談のステージから自動で決まります。受注の商談があるリードは成約、開いている商談があるリードは商談中になります。',
    },
    { type: 'h2', id: 'marks', text: 'カードの印' },
    {
      type: 'p',
      content:
        'カードと一覧には、リードの次の行動のうち期日がいちばん近い1件（期日・持ち帰りの印・件名）が出ます。',
    },
    {
      type: 'ul',
      items: [
        '受注予定日を過ぎています：日付を見直すか、閉じます。',
        [
          {
            type: 'text',
            text: 'リードに次の行動（タスク）がありません：商談の詳細かリードの詳細の',
          },
          { type: 'ui', text: '次の行動・持ち帰り事項' },
          { type: 'text', text: 'で入れます。' },
        ],
        '受注予定日なし・金額未定：売上予測に入らないので、分かった時点で入れます。',
      ],
    },
    {
      type: 'p',
      content: [
        { type: 'text', text: 'ボードと一覧は' },
        { type: 'ui', text: '表示' },
        {
          type: 'text',
          text: 'で切り替えます。担当・種類・受注予定の時期で絞り込めます。受注・失注は直近の商談だけを出します。',
        },
      ],
    },
    {
      type: 'roles',
      roles: ['member'],
      content: 'メンバーは商談を作る・直す・動かすことができますが、削除はできません。',
    },
    {
      type: 'roles',
      roles: ['parent_viewer'],
      content: '親組織の閲覧者は、商談と金額・予測・目標を見られません。',
    },
    {
      type: 'faq',
      items: [
        {
          question: '売上の見込みはどこで見ますか',
          answer: [
            { type: 'link', text: '売上予測', href: '/forecast' },
            { type: 'text', text: 'で、目標に対する受注と見込みを期間・担当者ごとに見ます。' },
          ],
        },
      ],
    },
  ],
};
