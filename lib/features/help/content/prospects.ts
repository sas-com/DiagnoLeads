import type { HelpArticle } from '../types';

export const prospectsArticle: HelpArticle = {
  id: 'prospects',
  locale: 'ja',
  title: '顧客探し一覧',
  summary:
    'メンバーがつてや交流会で話したお客様を1行ずつ記録し、営業が次の一手を進めます。連絡先を得たお客様は、ここからリードにします。',
  routes: ['/prospects'],
  reviewedAt: '2026-10-28',
  related: ['workflow-prospects-to-lead'],
  blocks: [
    { type: 'h2', id: 'write', text: '書くこと・書かないこと' },
    {
      type: 'ul',
      items: [
        '書く：日付・入口・会社名（ここまで必須）、部門・役職・苗字、聞いた話、反応、次の一手、次回アクション日。',
        '書かない：フルネーム・連絡先・契約の情報。',
      ],
    },
    { type: 'h2', id: 'add', text: '行を足す' },
    {
      type: 'steps',
      items: [
        [
          { type: 'ui', text: '行を追加' },
          { type: 'text', text: 'を押します。' },
        ],
        '日付・入口・会社名を入れ、分かる範囲で聞いた話と反応を書きます。',
        '次に動く日を次回アクション日に入れます。日付が決まっていなければ、目安（例：11月中旬）を書きます。',
      ],
    },
    {
      type: 'p',
      content: [
        { type: 'text', text: '自分の' },
        { type: 'strong', text: '紹介リンク' },
        {
          type: 'text',
          text: 'をお客様に渡すと、そのリンクから受けた AX 診断があなたの紹介として記録されます。',
        },
      ],
    },
    { type: 'h2', id: 'follow', text: '営業が進める' },
    {
      type: 'ul',
      items: [
        '「引き継ぎ待ち」「次回アクション日を過ぎた」「再アプローチ」の絞り込みで、動く行を探します。',
        '営業の欄（現在の段階・商談日・営業担当など）を埋めて進み具合を残します。',
        [
          { type: 'text', text: '連絡先を得たら' },
          { type: 'ui', text: 'リードにする' },
          {
            type: 'text',
            text: 'でリードを作ります。同じメールアドレスのリードがあれば、そのリードにつなぎます。',
          },
        ],
      ],
    },
    {
      type: 'p',
      content: [
        { type: 'ui', text: '集計' },
        {
          type: 'text',
          text: 'のタブでは、入口別・段階別の進み具合と、月ごとの商談の目標との差を見ます。',
        },
      ],
    },
    { type: 'h2', id: 'import', text: 'Excel やレポートから取り込む' },
    {
      type: 'ul',
      items: [
        [
          { type: 'ui', text: 'Excelから取り込む' },
          {
            type: 'text',
            text: '：顧客探し一覧の Excel をそのまま選びます。同じファイルを2回取り込むと行が重複します。',
          },
        ],
        [
          { type: 'ui', text: '架電レポートを取り込む' },
          {
            type: 'text',
            text: '：営業代行の架電レポート（CSV か Excel）から、同じ代行会社・同じ会社の行を更新し、無ければ足します。',
          },
        ],
      ],
    },
    {
      type: 'roles',
      roles: ['owner', 'admin', 'group_owner', 'group_admin'],
      content:
        'オーナー・管理者（グループのオーナー・管理者を含む）は、すべての行を直せて、取り込み・リードにする・商談の目標の設定ができます。',
    },
    {
      type: 'roles',
      roles: ['member'],
      content:
        'メンバーは行を足せます。直せるのは、自分が書いた行のうち、まだリードにしていないものです。',
    },
    {
      type: 'roles',
      roles: ['parent_viewer'],
      content: '親組織の閲覧者は、この一覧を見られません。',
    },
    {
      type: 'faq',
      items: [
        {
          question: '顧客探しの行とリードはどう違いますか',
          answer: [
            {
              type: 'text',
              text: '顧客探しは、まだ連絡先の無いお客様の記録です。連絡先を得てリードにしたあとは、',
            },
            { type: 'link', text: 'リード', href: '/leads' },
            { type: 'text', text: 'で連絡・ヒアリング・商談を記録します。' },
          ],
        },
      ],
    },
  ],
};
