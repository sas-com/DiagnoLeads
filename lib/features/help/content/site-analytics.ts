import type { HelpArticle } from '../types';

export const siteAnalyticsArticle: HelpArticle = {
  id: 'site-analytics',
  locale: 'ja',
  title: 'サイトの訪問',
  summary:
    '公開ページ（AX の LP・コラム・診断など）の訪問者数とページビューを見ます。計測は自前で、クッキーは使いません。',
  routes: ['/analytics/site'],
  reviewedAt: '2026-10-28',
  blocks: [
    { type: 'h2', id: 'how', text: '見かた' },
    {
      type: 'steps',
      items: [
        '期間を選びます。前の同じ長さの期間と比べた増減が出ます。',
        '指標を訪問者数かページビューに切り替えます。',
        'ページごとの表で、どの公開ページがよく見られているかを確かめます。',
      ],
    },
    {
      type: 'note',
      tone: 'tip',
      content:
        '訪問者数は日ごとに数えます。同じ人が別の日に来ると、それぞれの日に1人として数えます。',
    },
    {
      type: 'p',
      content: [
        { type: 'text', text: '訪問から生まれたリードの数や流入元は' },
        { type: 'link', text: '分析ダッシュボード', href: '/analytics' },
        { type: 'text', text: 'で見ます。' },
      ],
    },
    {
      type: 'roles',
      roles: ['parent_viewer'],
      content: '親組織の閲覧者は、この画面を見られません。',
    },
  ],
};
