import type { HelpArticle } from '../types';

export const settingsQrCampaignsArticle: HelpArticle = {
  id: 'settings-qr-campaigns',
  locale: 'ja',
  title: 'QR コードキャンペーン',
  summary:
    'チラシやイベントで配る QR コードを作り、読み取り回数と、そこから生まれたリードを数えます。',
  routes: ['/settings/qr-campaigns'],
  reviewedAt: '2026-10-28',
  blocks: [
    { type: 'h2', id: 'create', text: 'キャンペーンを作る' },
    {
      type: 'steps',
      items: [
        [
          { type: 'ui', text: '新規キャンペーン' },
          { type: 'text', text: 'を押します。' },
        ],
        'キャンペーン名を入れます。イベントや配布物ごとに1つ作ります。',
        '必要なら、開く診断・UTM パラメータ・期限を選びます。期限は選んだ日の終わり（日本時間）までで、あとから変えられます。',
        [
          { type: 'ui', text: 'QRコードをダウンロード' },
          { type: 'text', text: 'で画像を保存し、配布物に載せます。' },
        ],
      ],
    },
    {
      type: 'note',
      tone: 'tip',
      content:
        '動作の確認は確認用のキャンペーンで行い、配るものは確認のあとに新しく作ります。確認の読み取りと回答も、使ったキャンペーンの数に入るためです。',
    },
    { type: 'h2', id: 'results', text: '結果の見かた' },
    {
      type: 'table',
      header: ['表示', '意味'],
      rows: [
        ['読み取り回数', 'QR コードか URL から開かれた回数'],
        ['新規リード', 'そのキャンペーンから新しくできたリードの数'],
        ['新規リード率', '新規リード ÷ 読み取り回数'],
        ['新規リードのうち', '関心あり（MQL）・相談申込の数'],
      ],
    },
    {
      type: 'p',
      content:
        'URL をコピーしてメールや Web で配ると、その開封も読み取り回数に入ります。媒体ごとに別のキャンペーンを作ると、効果を比べられます。',
    },
    { type: 'h2', id: 'stop', text: '止める' },
    {
      type: 'p',
      content:
        'スイッチをオフにするか期限が過ぎると、読み取っても診断は開きません。画面の「読み取ると」の欄に、今どこが開くか（開かない理由）が出ます。',
    },
    {
      type: 'roles',
      roles: ['member'],
      content:
        'メンバーは結果を見て QR コードをダウンロードできますが、作成・変更・削除はできません。',
    },
  ],
};
