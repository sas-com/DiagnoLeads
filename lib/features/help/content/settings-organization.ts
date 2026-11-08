import type { HelpArticle } from '../types';

export const settingsOrganizationArticle: HelpArticle = {
  id: 'settings-organization',
  locale: 'ja',
  title: '組織設定',
  summary:
    '組織の名前と、営業の進め方に関わる設定（相談申込の窓口・引き継ぎ書の送り先・資料と勉強会・ヒアリングの項目・動くべき時期）をまとめて決めます。',
  routes: ['/settings/organization'],
  reviewedAt: '2026-10-28',
  blocks: [
    { type: 'h2', id: 'first', text: '最初に決めること' },
    {
      type: 'steps',
      items: [
        [
          { type: 'strong', text: '相談申込の窓口' },
          {
            type: 'text',
            text: '：相談申込の通知（アプリ内とメール）を受け取るメンバーを選びます。窓口がリードの担当者を割り当てます。未設定のときは全員に届きます。',
          },
        ],
        [
          { type: 'strong', text: '引き継ぎ書の送り先' },
          {
            type: 'text',
            text: '：商談が初回ヒアリングから次の段階へ進んだとき、引き継ぎ書ができたことを知らせるメンバー（技術部門など）を選びます。',
          },
        ],
        [
          { type: 'strong', text: 'ヒアリングの項目' },
          {
            type: 'text',
            text: '：初回商談で聞く項目・必須にする項目・並び順を決めます。変えた内容はヒアリング票にすぐ反映されます。',
          },
        ],
      ],
    },
    { type: 'h2', id: 'others', text: 'そのほかの設定' },
    {
      type: 'table',
      header: ['設定', '決めること'],
      rows: [
        [
          '組織名・組織スラッグ',
          '組織の表示名と、URL に使う識別子。スラッグを変えると URL が変わります',
        ],
        [
          '資料・勉強会',
          'AX 診断の結果画面に、相談と並べて出す資料と勉強会。「結果画面に出す」をオンにするまで出ません',
        ],
        [
          '動くべき時期',
          '移行にかかる期間と、何か月前に知らせるか。保守期限・退職予定・決算月から再び動く時期を出し、担当者の次の行動に入れます',
        ],
      ],
    },
    {
      type: 'note',
      tone: 'tip',
      content:
        'ヒアリングで聞かない項目にしても、すでに記録した値は消えません。変更は監査ログに残ります。',
    },
    {
      type: 'roles',
      roles: ['owner'],
      content: '組織名と組織スラッグを変えられるのはオーナーだけです。',
    },
    {
      type: 'roles',
      roles: ['admin'],
      content:
        '管理者は、窓口・送り先・資料と勉強会・ヒアリングの項目・動くべき時期を変えられます。組織名とスラッグは見るだけです。',
    },
    {
      type: 'roles',
      roles: ['member'],
      content: 'メンバーはこの画面を見るだけで、変えられません。',
    },
  ],
};
