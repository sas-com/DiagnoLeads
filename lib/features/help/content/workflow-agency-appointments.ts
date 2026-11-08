import type { HelpArticle } from '../types';

export const workflowAgencyAppointmentsArticle: HelpArticle = {
  id: 'workflow-agency-appointments',
  locale: 'ja',
  title: '営業代行のアポの扱い',
  summary:
    '営業代行会社から届くアポや診断の回答を、リードに取り込み、初回商談のあとに契約の条件を満たしたかを記録するまでの流れです。',
  routes: [],
  reviewedAt: '2026-10-28',
  related: ['settings-agency-links', 'workflow-lifecycle'],
  blocks: [
    { type: 'h2', id: 'entry', text: '代行会社からリードが届く道' },
    {
      type: 'table',
      header: ['道', 'やること'],
      rows: [
        [
          '営業代行リンク',
          '代行会社ごとに AX 診断のリンクを発行して渡します。回答されると、流入元と代行会社名の付いたリードができます',
        ],
        [
          'アポのレポート',
          'リード一覧の「インポート → 代行会社のアポレポートを取り込む」で、アポのレポートをリードと代行会社からの引き継ぎとして入れます',
        ],
        [
          '架電レポート',
          '顧客探し一覧の「架電レポートを取り込む」で、架電の結果を顧客探しの行として入れます',
        ],
      ],
    },
    { type: 'h2', id: 'meeting', text: '初回商談の前後' },
    {
      type: 'steps',
      items: [
        'リードの詳細の「代行会社からの引き継ぎ」で、代行会社が聞いた内容を確かめます。',
        '初回商談でヒアリングを記録します。代行会社が聞いた値は「代行聴取」として入っているので、本人に確かめて直します。',
        '初回商談のあと、リードの詳細の「アポの条件の確認」で、決裁者の同席などの条件を満たしたかを記録します。',
        '条件を満たさなかったときは、不備の理由と、代行会社への連絡（返品・取り直し）を記録します。',
      ],
    },
    {
      type: 'note',
      tone: 'caution',
      content:
        '返品・取り直しには、契約で決めた連絡期限があります。期限が近づくと担当者に知らせます。期限を過ぎても記録はできますが、「期限後に記録」の印が付きます。',
    },
    {
      type: 'p',
      content: [
        { type: 'text', text: '代行会社ごとの獲得単価と、条件を満たしたアポの割合は' },
        { type: 'link', text: '分析ダッシュボード', href: '/analytics' },
        { type: 'text', text: 'の流入元のタブで見ます。' },
      ],
    },
  ],
};
