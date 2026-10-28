import type { HelpArticle } from '../types';

export const workflowLifecycleArticle: HelpArticle = {
  id: 'workflow-lifecycle',
  locale: 'ja',
  title: 'リードから受注までの流れ',
  summary:
    '診断などで届いたリードが、MQL・商談（見極め）・SQL判定を経て受注か失注になるまでの流れと、それぞれの段で使う画面です。',
  routes: [],
  reviewedAt: '2026-10-28',
  related: ['glossary', 'workflow-prospects-to-lead', 'workflow-agency-appointments'],
  blocks: [
    { type: 'h2', id: 'overview', text: '全体の流れ' },
    {
      type: 'steps',
      items: [
        [
          { type: 'strong', text: 'リード' },
          {
            type: 'text',
            text: '：診断の回答・取り込み・手入力・顧客探しからの引き継ぎでできます。',
          },
        ],
        [
          { type: 'strong', text: 'MQL' },
          {
            type: 'text',
            text: '：診断が回答から自動で判定します。関心を示す回答や相談申込があると「関心あり（MQL）」になります。',
          },
        ],
        [
          { type: 'strong', text: '商談（見極め）' },
          {
            type: 'text',
            text: '：初回商談の日時が決まったら、商談を作ります。代行のアポや紹介など、診断のないリードは MQL を経ずにここから始めてよいです。',
          },
        ],
        [
          { type: 'strong', text: 'SQL判定' },
          {
            type: 'text',
            text: '：初回ヒアリングのあとに、営業が商談として進めるかを判定します。適格なら課題の確認へ進み、不適格なら理由を付けて失注にします。',
          },
        ],
        [
          { type: 'strong', text: '商談を進める' },
          { type: 'text', text: '：課題の確認 → 提案 → 条件の調整と進め、受注か失注で閉じます。' },
        ],
      ],
    },
    {
      type: 'note',
      tone: 'tip',
      content:
        'SQL は段ではなく、見極めの出口の判定です。初回ヒアリングの前には判定できないため、初回商談を商談（見極め）として作り、その出口で判定します。',
    },
    { type: 'h2', id: 'screens', text: '段ごとに使う画面' },
    {
      type: 'table',
      header: ['段', '使う画面', 'やること'],
      rows: [
        ['リード・MQL', 'ダッシュボード・リード一覧', '連絡待ちの相談申込に連絡し、担当を決める'],
        ['商談（見極め）', 'リードの詳細・商談', 'ヒアリングを記録し、SQL を判定する'],
        [
          '課題の確認〜条件の調整',
          '商談・売上予測',
          '金額・確度・受注予定日を入れ、ステージを進める',
        ],
        [
          '受注のあと',
          'リードの詳細（引き継ぎ書）',
          '技術部門に引き継ぐ。現行調査 → 移行 → AX 化と次の商談が続くことがある',
        ],
      ],
    },
    {
      type: 'p',
      content: [
        { type: 'text', text: '毎日の作業は' },
        { type: 'link', text: '今日', href: '/today' },
        {
          type: 'text',
          text: 'の画面から始めると、期限の来た次の行動と今週の商談予定をまとめて見られます。',
        },
      ],
    },
    { type: 'h2', id: 'pause', text: '今は進まないとき' },
    {
      type: 'ul',
      items: [
        '商談の前のリードは、状態をナーチャリング（再育成）にし、次に連絡する日を次の行動に入れます。',
        '商談のあるリードはナーチャリングにしません。止まった商談は、失注の理由「時期」で閉じます。時期が来たら新しい商談を作ります。',
        '保守期限・退職予定・決算月をヒアリングに記録しておくと、動くべき時期が来たときに担当者へ知らせます。',
      ],
    },
    {
      type: 'note',
      tone: 'tip',
      content:
        'リードの状態と商談フェーズは、商談のステージから自動で決まります。商談のあるリードは、商談の側で動かします。',
    },
  ],
};
