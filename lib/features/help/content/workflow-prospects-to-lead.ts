import type { HelpArticle } from '../types';

export const workflowProspectsToLeadArticle: HelpArticle = {
  id: 'workflow-prospects-to-lead',
  locale: 'ja',
  title: '顧客探しからリードへの引き継ぎ',
  summary:
    'メンバーがつてや交流会で話した相手を顧客探し一覧に書き、営業がリードにして商談へ進めるまでの流れです。',
  routes: [],
  reviewedAt: '2026-10-28',
  related: ['prospects', 'workflow-lifecycle'],
  blocks: [
    { type: 'h2', id: 'roles', text: '顧客探しとリードの違い' },
    {
      type: 'table',
      header: ['', '顧客探し', 'リード'],
      rows: [
        [
          '書くもの',
          '会社名・部門・役職・苗字まで。連絡先は書かない',
          '氏名・メールアドレス（必須）・連絡先',
        ],
        ['書く人', 'メンバー全員', 'リードを編集できるメンバー'],
        ['その後', 'リードにしたら、進み具合はリードと商談で見る', '受注か失注まで追う'],
      ],
    },
    { type: 'h2', id: 'flow', text: '流れ' },
    {
      type: 'steps',
      items: [
        [
          { type: 'text', text: 'メンバーが' },
          { type: 'link', text: '顧客探し一覧', href: '/prospects' },
          { type: 'text', text: 'に行を足し、聞いた話・反応・次の一手を書きます。' },
        ],
        '次の一手が「営業へ引き継ぎ」の行を、営業が「引き継ぎ待ち」の絞り込みで拾い、営業担当を決めます。',
        '営業がお客様の連絡先を得たら、行の「リードにする」でリードを作ります。会社名と営業担当はリードに引き継がれます。',
        '初回の打ち合わせの日時が決まったら、リードに商談（見極め）を作り、リードから受注までの流れに乗せます。',
      ],
    },
    {
      type: 'note',
      tone: 'caution',
      content:
        'リードにした行の段階は、顧客探し一覧では変えられません。リードにしたあとの進み具合は、リードと商談で記録します。',
    },
    {
      type: 'p',
      content:
        '自分の紹介リンクをお客様に渡すと、そのリンクから受けた AX 診断があなたの紹介としてリードに記録されます。',
    },
  ],
};
