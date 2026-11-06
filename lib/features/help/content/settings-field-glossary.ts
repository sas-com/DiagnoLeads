import type { HelpArticle } from '../types';

export const settingsFieldGlossaryArticle: HelpArticle = {
  id: 'settings-field-glossary',
  locale: 'ja',
  title: '項目の説明',
  summary:
    '入力欄の横の「i」で出す、項目と値の説明を書きます。説明はすべての組織に共通で、運営の組織のオーナーと管理者だけが編集できます。',
  routes: ['/settings/field-glossary'],
  reviewedAt: '2026-11-06',
  related: ['glossary'],
  blocks: [
    { type: 'h2', id: 'write', text: '説明を書く' },
    {
      type: 'steps',
      items: [
        '「項目」で、説明を書く項目を選びます。項目の名前の横に、入力済みの件数が出ます。',
        '一番上のカードに、項目そのものの説明を書きます。何を入れる欄か、いつ変えるかを書きます。',
        'その下のカードに、選べる値ごとの説明を書きます。値の名前は画面の表示と同じで、ここでは変えられません。',
        [
          { type: 'ui', text: '保存' },
          { type: 'text', text: 'を押します。保存した説明は、入力欄の横の「i」から読めます。' },
        ],
      ],
    },
    {
      type: 'note',
      tone: 'tip',
      content:
        '英語の説明は空のままでかまいません。空のときは、英語の画面でも日本語の説明を出します。',
    },
    { type: 'h2', id: 'delete', text: '説明を消す' },
    {
      type: 'p',
      content:
        '「削除」を押すと、すべての組織の画面からその説明が消え、「i」も出なくなります。消した説明は元に戻せないので、書き直すときは削除せずに上書きして保存します。',
    },
    {
      type: 'note',
      tone: 'caution',
      content:
        '説明はすべての組織に同じものが出ます。社外秘（取引先名・単価など）や、組織ごとの業務の手順は書かないでください。組織ごとの手順は、営業の手引き（AX）に書きます。',
    },
    {
      type: 'roles',
      roles: ['member', 'parent_viewer'],
      content:
        'この画面は、運営の組織のオーナーと管理者だけが使えます。ほかの方には、編集できない旨が出ます。',
    },
  ],
};
