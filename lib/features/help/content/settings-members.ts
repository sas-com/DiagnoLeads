import type { HelpArticle } from '../types';

export const settingsMembersArticle: HelpArticle = {
  id: 'settings-members',
  locale: 'ja',
  title: 'メンバー管理',
  summary:
    '組織にメンバーを招待し、役割を決めます。新しく使い始める人は、ここからの招待でだけ登録できます。',
  routes: ['/settings/members'],
  reviewedAt: '2026-10-28',
  blocks: [
    { type: 'h2', id: 'roles', text: '役割' },
    {
      type: 'table',
      header: ['役割', 'できること'],
      rows: [
        ['オーナー', 'すべて。組織名の変更や、ほかのメンバーをオーナーにすることもできます'],
        ['管理者', 'メンバーの招待と削除、組織の設定、目標・Webhook・QR キャンペーンなどの設定'],
        [
          'メンバー',
          'リード・ヒアリング・商談の記録と編集。リードと商談の削除や設定の変更はできません',
        ],
      ],
    },
    { type: 'h2', id: 'invite', text: 'メンバーを招待する' },
    {
      type: 'steps',
      items: [
        [
          { type: 'ui', text: 'メンバーを招待' },
          { type: 'text', text: 'を押します。' },
        ],
        'メールアドレスと役割を選び、招待を送ります。',
        '招待された人に届くメールのリンクから、登録とメールアドレスの確認をしてもらいます。',
      ],
    },
    {
      type: 'p',
      content:
        'まだ参加していない招待は「招待中」に並びます。リンクには有効期限があります。期限が切れたときや届かないときは「もう一度送る」で送り直します（前のリンクは使えなくなります）。',
    },
    { type: 'h2', id: 'change', text: '役割を変える・外す' },
    {
      type: 'ul',
      items: [
        'メンバーの行のボタンから、役割の変更と、組織から外す操作ができます。',
        'オーナーの役割の変更や削除はできません。自分自身を外すこともできません。',
      ],
    },
    {
      type: 'note',
      tone: 'caution',
      content:
        'メンバーを外すと元に戻せません。もう一度使うときは招待し直します。そのメンバーが作った記録は組織に残ります。',
    },
    {
      type: 'roles',
      roles: ['member'],
      content: 'メンバーはこの画面を見るだけです。招待と管理はオーナーと管理者ができます。',
    },
  ],
};
