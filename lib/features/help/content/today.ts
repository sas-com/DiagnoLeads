import type { HelpArticle } from '../types';

export const todayArticle: HelpArticle = {
  id: 'today',
  locale: 'ja',
  title: '今日',
  summary:
    '自分の今日の予定と、やることをまとめて見ます。朝に開いて、上から順に片付けていく使い方を想定しています。',
  routes: ['/today'],
  reviewedAt: '2026-10-28',
  related: ['workflow-lifecycle'],
  blocks: [
    { type: 'h2', id: 'sections', text: '並んでいるもの' },
    {
      type: 'table',
      header: ['欄', '出るもの'],
      rows: [
        ['今日までの次の行動', '期限が今日までの次の行動と、期限を過ぎた次の行動'],
        [
          '商談予定',
          '今日から日曜までの、自分が担当するリードの打ち合わせ。担当がいないリードは、日程を入れた人に出ます',
        ],
        [
          '今日の活動',
          '今日の日時で自分が記録した連絡（電話・メール・訪問・オンライン商談・不通）。ヒアリングは含みません',
        ],
        [
          '注意が必要な商談',
          '自分の商談のうち、受注予定日を過ぎたものと、リードに次の行動がないもの',
        ],
      ],
    },
    {
      type: 'p',
      content: '日付と時刻は日本時間です。月曜から日曜を1週間として数えます。',
    },
    { type: 'h2', id: 'how', text: '使い方' },
    {
      type: 'steps',
      items: [
        '今日までの次の行動を済ませたら、チェックを付けて完了にします。',
        '商談予定を見て、打ち合わせの前にリードの詳細で事前調査カードと前回のヒアリングを読み返します。',
        [
          { type: 'text', text: '電話・メール・打ち合わせをしたら、次の行動や商談予定の行の' },
          { type: 'ui', text: '記録' },
          { type: 'text', text: 'から、リードの画面に移らずに連絡を記録します。' },
        ],
        [
          {
            type: 'text',
            text: '注意が必要な商談は、受注予定日を直すか、リードに次の行動を入れます。一覧は',
          },
          { type: 'link', text: '商談', href: '/deals' },
          { type: 'text', text: 'で開けます。' },
        ],
      ],
    },
    {
      type: 'note',
      tone: 'tip',
      content: [
        { type: 'text', text: '組織全体の状況（連絡待ちの相談申込や数字）は' },
        { type: 'link', text: 'ダッシュボード', href: '/dashboard' },
        { type: 'text', text: 'で見ます。' },
      ],
    },
    {
      type: 'roles',
      roles: ['parent_viewer'],
      content: [
        { type: 'text', text: '親組織の閲覧者は見るだけで、行に' },
        { type: 'ui', text: '記録' },
        { type: 'text', text: 'は出ません。' },
      ],
    },
    {
      type: 'faq',
      items: [
        {
          question: '打ち合わせの予定が出てきません',
          answer:
            '商談予定は、ヒアリングに記録した「次回の日程」から作られます。リードのヒアリングで次回の日程を入れてください。担当者がほかの人になっているリードは、その人の画面に出ます。',
        },
        {
          question: '電話したのに今日の活動に出ません',
          answer: [
            { type: 'text', text: '連絡を記録したときだけ出ます。この画面の行の' },
            { type: 'ui', text: '記録' },
            {
              type: 'text',
              text: 'か、リードの画面で記録してください。連絡の日時を昨日以前にした記録も、今日の活動には出ません。',
            },
          ],
        },
      ],
    },
  ],
};
