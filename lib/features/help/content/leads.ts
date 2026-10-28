import type { HelpArticle } from '../types';

export const leadsArticle: HelpArticle = {
  id: 'leads',
  locale: 'ja',
  title: 'リード一覧',
  summary:
    '診断や取り込みで集まったリードを探し、絞り込み、まとめて扱います。行を押すと要点が横に開き、詳しく見るときはリードの詳細ページへ進みます。',
  routes: ['/leads'],
  reviewedAt: '2026-10-28',
  related: ['workflow-lifecycle', 'glossary'],
  blocks: [
    { type: 'h2', id: 'find', text: 'リードを探す' },
    {
      type: 'ul',
      items: [
        [
          { type: 'strong', text: '検索' },
          { type: 'text', text: '：名前・メール・会社名の一部で探します。' },
        ],
        [
          { type: 'strong', text: 'よく使う絞り込み' },
          {
            type: 'text',
            text: '：「要対応」「相談申込あり」「自分の担当」「担当未定」「今週の商談」「次回日程の過ぎたリード」などを1回押すだけでかけられます。',
          },
        ],
        [
          { type: 'strong', text: '絞り込み' },
          {
            type: 'text',
            text: '：状態・商談フェーズ・流入元・対象システム・MQL段階・作成日・次回日程・動くべき時期などを組み合わせます。',
          },
        ],
        [
          { type: 'strong', text: '並び替え' },
          {
            type: 'text',
            text: '：列の見出しを押すと、その列で並び替えます。もう一度押すと逆になります。',
          },
        ],
      ],
    },
    {
      type: 'p',
      content:
        'かけている条件は一覧の上に並びます。×で1つずつ外すか、「すべて解除」でまとめて外します。条件は画面のアドレスに入るので、アドレスを共有すると同じ絞り込みを見てもらえます。',
    },
    { type: 'h2', id: 'add', text: 'リードを足す' },
    {
      type: 'table',
      header: ['方法', '使うとき'],
      rows: [
        ['新規リード追加', '名刺や電話の問い合わせなど、1件ずつ入れるとき'],
        [
          'インポート → リードを取り込む',
          'CSV・Excel のファイルからまとめて入れるとき。メールアドレスの列が必要です',
        ],
        [
          'インポート → 代行会社のアポレポートを取り込む',
          '営業代行会社のアポのレポートを、リードと代行会社からの引き継ぎとして入れるとき',
        ],
      ],
    },
    {
      type: 'note',
      tone: 'tip',
      content: '診断フォームから届いたリードは自動で一覧に入ります。手で入れ直す必要はありません。',
    },
    { type: 'h2', id: 'bulk', text: 'まとめて操作する' },
    {
      type: 'steps',
      items: [
        '行の左のチェックで、扱うリードを選びます。',
        [
          { type: 'ui', text: 'ステータス変更' },
          { type: 'text', text: '・' },
          { type: 'ui', text: '選択をエクスポート' },
          { type: 'text', text: '・' },
          { type: 'ui', text: '選択を削除' },
          { type: 'text', text: 'から選びます。' },
        ],
      ],
    },
    {
      type: 'p',
      content:
        '商談のあるリードの状態は商談のステージから決まるため、まとめてのステータス変更では変わりません。',
    },
    {
      type: 'note',
      tone: 'caution',
      content:
        '削除したリードは元に戻せません。そのリードの活動履歴・ヒアリング・商談などの記録も一緒に消えます。',
    },
    { type: 'h2', id: 'export', text: 'ファイルに書き出す' },
    {
      type: 'p',
      content: [
        { type: 'ui', text: 'エクスポート' },
        {
          type: 'text',
          text: 'を押すと、今の絞り込みと並び順のまま、条件に合う全件を書き出します（最大 5,000 件）。それより多いときは条件を絞ってから書き出してください。',
        },
      ],
    },
    {
      type: 'roles',
      roles: ['member'],
      content: 'メンバーはリードを足す・直すことができますが、削除はできません。',
    },
    {
      type: 'roles',
      roles: ['parent_viewer'],
      content: '親組織の閲覧者は見るだけで、追加・変更・削除・取り込みはできません。',
    },
    {
      type: 'faq',
      items: [
        {
          question: '「要対応」には何が出ますか',
          answer: '状態が「新規」で、まだ誰も着手していないリードです。',
        },
        {
          question: 'スコアと MQL段階のどちらを見ればよいですか',
          answer:
            '見込みの高さは MQL段階で判断します。スコアは診断の回答から計算した根拠の1つで、リードの詳細の診断カードで確かめられます。',
        },
      ],
    },
  ],
};
