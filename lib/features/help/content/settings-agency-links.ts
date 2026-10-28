import type { HelpArticle } from '../types';

export const settingsAgencyLinksArticle: HelpArticle = {
  id: 'settings-agency-links',
  locale: 'ja',
  title: '営業代行リンク',
  summary:
    '営業代行会社ごとに AX 診断のリンクを発行します。リンクから回答されたリードには、流入元と代行会社名が付きます。',
  routes: ['/settings/agency-links'],
  reviewedAt: '2026-10-28',
  blocks: [
    { type: 'h2', id: 'create', text: 'リンクを発行する' },
    {
      type: 'steps',
      items: [
        '代行会社名と種類を入れ、必要ならキャンペーン名を入れます。代行会社名は社内向けの表示で、回答者には見えません。',
        [
          { type: 'ui', text: '発行する' },
          { type: 'text', text: 'を押します。' },
        ],
        [
          { type: 'ui', text: '案内文をコピー' },
          {
            type: 'text',
            text: 'で、代行会社のトーク台本やメールに貼る文面をリンク付きでコピーし、代行会社に渡します。',
          },
        ],
      ],
    },
    {
      type: 'p',
      content: [
        {
          type: 'text',
          text: '発行済みのリンクごとに、そこから生まれたリード数が出ます。代行会社ごとの成果と費用は',
        },
        { type: 'link', text: '分析ダッシュボード', href: '/analytics' },
        { type: 'text', text: 'の流入元のタブで見ます。' },
      ],
    },
    { type: 'h2', id: 'disable', text: 'リンクを無効にする' },
    {
      type: 'p',
      content:
        '契約が終わった代行会社のリンクは「無効にする」で止めます。無効にしても診断には答えられますが、回答は代行会社に紐付かなくなります。あとで有効に戻せます。',
    },
    {
      type: 'note',
      tone: 'tip',
      content:
        'すでに登録済みのメールアドレスから回答されたときは、既存のリードを書き換えません（流入元・代行会社名は変わりません）。',
    },
    {
      type: 'roles',
      roles: ['member'],
      content: 'メンバーはリンクを見てコピーできますが、発行と無効化はオーナーと管理者ができます。',
    },
    {
      type: 'roles',
      roles: ['parent_viewer'],
      content: '親組織の閲覧者は、この画面を見られません。',
    },
  ],
};
