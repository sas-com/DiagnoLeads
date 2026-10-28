import type { HelpArticle } from '../types';

export const settingsProfileArticle: HelpArticle = {
  id: 'settings-profile',
  locale: 'ja',
  title: '個人設定',
  summary:
    '自分の名前・パスワード・通知と、ログインしている端末を設定します。ここでの設定は自分にだけ効きます。',
  routes: ['/settings'],
  reviewedAt: '2026-10-28',
  blocks: [
    { type: 'h2', id: 'profile', text: 'プロフィール' },
    {
      type: 'p',
      content: '氏名は、ほかのメンバーの画面にもこの名前で出ます。メールアドレスは変えられません。',
    },
    { type: 'h2', id: 'password', text: 'パスワードを変える' },
    {
      type: 'steps',
      items: [
        '現在のパスワードと、新しいパスワード（8文字以上）を2回入れます。',
        [
          { type: 'ui', text: 'パスワードを変更' },
          { type: 'text', text: 'を押します。' },
        ],
      ],
    },
    {
      type: 'p',
      content:
        'パスワードを変えると、ほかの端末やブラウザのログインはすべて切れます。このブラウザはログインしたままです。',
    },
    { type: 'h2', id: 'notifications', text: '通知' },
    {
      type: 'p',
      content:
        '画面右上のベルに届く通知を、種類ごとにオン・オフします。相談申込・新しいリード・担当の割り当て・次の行動の期限などを選べます。',
    },
    {
      type: 'note',
      tone: 'tip',
      content:
        '相談申込のメールは、組織設定の「相談申込の窓口」に届きます。個人ごとの設定はありません。',
    },
    { type: 'h2', id: 'sessions', text: 'ログインと端末' },
    {
      type: 'ul',
      items: [
        'ログインは、ログインした時から7日で切れます。使い続けても延びないので、7日ごとにログインし直します。',
        [
          { type: 'text', text: '端末をなくしたときや、身に覚えのないログインがあるときは' },
          { type: 'ui', text: 'ほかの端末からログアウト' },
          { type: 'text', text: 'を使います。このブラウザ以外のログインをまとめて終わらせます。' },
        ],
      ],
    },
    { type: 'h2', id: 'delete', text: 'アカウントの削除' },
    {
      type: 'p',
      content:
        '削除すると、ログイン情報・氏名とメールアドレス・組織への所属が消えます。作ったリードやヒアリングなどの記録は組織に残り、作成者は「削除されたユーザー」と表示されます。',
    },
    {
      type: 'note',
      tone: 'caution',
      content:
        'アカウントの削除は取り消せません。オーナーが自分だけの組織があるときは、先にメンバー管理で別のメンバーをオーナーにしてください。',
    },
  ],
};
