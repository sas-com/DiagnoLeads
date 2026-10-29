import type { HelpArticle } from '../types';

export const settingsWebhooksArticle: HelpArticle = {
  id: 'settings-webhooks',
  locale: 'ja',
  title: 'Webhook 設定',
  summary:
    'リードの作成や更新などが起きたときに、ほかのシステムへ知らせる送信先（Webhook）を設定します。社内のシステムとつなぐ担当者向けの画面です。',
  routes: ['/settings/webhooks'],
  reviewedAt: '2026-10-29',
  blocks: [
    { type: 'h2', id: 'create', text: '送信先を作る' },
    {
      type: 'steps',
      items: [
        [
          { type: 'ui', text: 'Webhookを作成' },
          { type: 'text', text: 'を押します。' },
        ],
        '名前と、送信先の URL（インターネットに公開されている https の URL）を入れます。',
        '受け取りたいイベント（リードの作成・更新など）を選び、必要ならカスタムヘッダーを足して保存します。',
        [
          { type: 'ui', text: 'テスト送信' },
          { type: 'text', text: 'で、送信先に届くかを確かめます。' },
        ],
      ],
    },
    {
      type: 'note',
      tone: 'caution',
      content:
        '社内のアドレスや localhost、ポート番号やユーザー名・パスワード入りの URL には送れません。',
    },
    { type: 'h2', id: 'verify', text: '受け取る側で確かめること' },
    {
      type: 'p',
      content:
        '送信には署名が付きます（X-Webhook-Signature ヘッダー。t=送った時刻,v1=署名 の形）。受け取る側では、次の2つを確かめてください。',
    },
    {
      type: 'steps',
      items: [
        '署名：「時刻.受け取った本文そのまま」を、画面の署名シークレットで HMAC-SHA256 にかけた値が v1 と同じか。違えば偽の送信として捨てます。',
        '時刻：t が今から5分より古いか、5分より先なら捨てます。盗み見た送信をあとから送り直されても、受け付けないためです。',
      ],
    },
    {
      type: 'note',
      tone: 'tip',
      content:
        '再送のときも、署名と時刻は送るたびに付け直します。5分の幅で確かめても、正しい再送は捨てられません。',
    },
    { type: 'h2', id: 'operate', text: '止める・直す' },
    {
      type: 'ul',
      items: [
        [
          { type: 'ui', text: '一時停止' },
          { type: 'text', text: 'で送信を止め、' },
          { type: 'ui', text: '再開' },
          { type: 'text', text: 'で戻します。' },
        ],
        '失敗回数と最終実行の日時で、送信がうまくいっているかを確かめます。',
        'テスト送信には回数の上限があります。上限に達したら、しばらく待ってから試します。',
      ],
    },
    {
      type: 'roles',
      roles: ['member'],
      content: 'メンバーは送信先を見るだけで、作成・変更・削除はできません。',
    },
    {
      type: 'roles',
      roles: ['parent_viewer'],
      content: '親組織の閲覧者は、この画面を見られません。',
    },
  ],
};
