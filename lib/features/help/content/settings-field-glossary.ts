import type { HelpArticle } from '../types';

export const settingsFieldGlossaryArticle: HelpArticle = {
  id: 'settings-field-glossary',
  locale: 'ja',
  title: '項目辞書',
  summary:
    '管理画面の入力項目に出す説明文（ヘルプ）を、サイト全体で登録・編集します。どの組織でも同じ内容が出ます。',
  routes: ['/settings/field-glossary'],
  reviewedAt: '2026-11-08',
  blocks: [
    { type: 'h2', id: 'about', text: '項目辞書とは' },
    {
      type: 'p',
      content:
        '管理画面の入力項目に添える説明文を登録しておく辞書です。内容はサイト全体で共通で、組織ごとには分かれません。登録した説明は、その項目の入力欄のそばに出ます。',
    },
    { type: 'h2', id: 'entry-types', text: '項目全体の説明と、値ごとの説明' },
    {
      type: 'ul',
      items: [
        [
          { type: 'strong', text: '項目全体' },
          {
            type: 'text',
            text: '：値を空にすると、その項目そのものの説明になります（例：leads.status という項目の説明）。',
          },
        ],
        [
          { type: 'strong', text: '値ごと' },
          {
            type: 'text',
            text: '：値を入れると、その項目の特定の値についての説明になります（例：leads.status の negotiating）。並び順で、値の表示される順を決めます。',
          },
        ],
      ],
    },
    {
      type: 'note',
      tone: 'tip',
      content:
        '選択肢の表示名（ラベル）は locales（日本語・英語）で管理しています。辞書に登録するのは説明と、自由入力の値候補です。表示名の欄は、自由入力の値候補にだけ使います。',
    },
    { type: 'h2', id: 'edit', text: '追加・編集・削除' },
    {
      type: 'steps',
      items: [
        [
          { type: 'ui', text: '追加' },
          {
            type: 'text',
            text: 'を押し、項目キー（「leads.status」の形式）を入れます。',
          },
        ],
        '特定の値の説明なら値を入れ、項目全体の説明なら値を空のままにします。',
        '説明（日本語・英語）と、必要なら表示名・並び順を入れて保存します。',
        '登録済みの項目は、鉛筆のボタンで編集し、ゴミ箱のボタンで削除します。',
      ],
    },
    {
      type: 'note',
      tone: 'caution',
      content: '削除は元に戻せません。説明だけを直すときは編集を使ってください。',
    },
    {
      type: 'roles',
      roles: ['owner', 'admin'],
      content:
        '編集できるのは運営組織（AX 診断を受け取る組織）のオーナーと管理者だけです。ほかの人がこの画面を開くと「権限がありません」と出ます。',
    },
  ],
};
