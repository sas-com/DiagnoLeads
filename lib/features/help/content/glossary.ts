import type { HelpArticle } from '../types';

export const glossaryArticle: HelpArticle = {
  id: 'glossary',
  locale: 'ja',
  title: '用語集',
  summary: '画面に出てくる営業の用語の意味です。',
  routes: [],
  reviewedAt: '2026-10-28',
  related: ['workflow-lifecycle'],
  blocks: [
    { type: 'h2', id: 'leads', text: 'リードと見込み' },
    { type: 'h3', id: 'lead', text: 'リード' },
    {
      type: 'p',
      content:
        '見込み客1人の記録です。メールアドレスが必須で、診断の回答・連絡先・次の行動・活動の履歴を持ちます。',
    },
    { type: 'h3', id: 'mql', text: 'MQL（関心あり）' },
    {
      type: 'p',
      content:
        'Marketing Qualified Lead。営業が追う価値があると判断した見込み客です。診断の回答で、対象の業種・システム・企業規模にあてはまり、相談申込などの関心を示す行動か回答があると、自動で「関心あり（MQL）」になります。',
    },
    { type: 'h3', id: 'fit', text: '適合' },
    {
      type: 'p',
      content:
        '対象の業種・システム・企業規模にはあてはまるが、関心を示す行動や回答はまだないリードです。MQL の手前（MQL候補）で、MQL には数えません。',
    },
    { type: 'h3', id: 'out-of-scope', text: '対象外' },
    {
      type: 'p',
      content: '診断の必須条件（業種・システム・企業規模）のどれかにあてはまらないリードです。',
    },
    { type: 'h3', id: 'sql', text: 'SQL・SQL判定（適格・不適格）' },
    {
      type: 'p',
      content:
        'Sales Qualified Lead。初回ヒアリングのあとに、営業が商談として進める価値があると判断したリードです。商談（見極め）の出口で判定し、適格なら課題の確認へ進め、不適格なら失注にします。データベースの SQL とは別物です。',
    },
    { type: 'h3', id: 'nurturing', text: 'ナーチャリング（再育成）' },
    {
      type: 'p',
      content:
        '商談の前のリードが、時期・予算などで今は進まない状態です。次に連絡する日を次の行動に入れておきます。',
    },
    { type: 'h2', id: 'deals', text: '商談' },
    { type: 'h3', id: 'deal', text: '商談' },
    {
      type: 'p',
      content:
        '1つの案件（現行調査・移行・AX 化など）です。1つのリードに複数の商談がつくことがあります。売上予測とボードは商談で数えます。',
    },
    { type: 'h3', id: 'stage', text: 'ステージ' },
    {
      type: 'p',
      content:
        '商談の進み具合です。見極め → 課題の確認 → 提案 → 条件の調整 → 受注・失注と進みます。',
    },
    { type: 'h3', id: 'probability', text: '確度' },
    {
      type: 'p',
      content:
        '商談が受注になる見込み（%）です。ステージに入ると既定値になり、商談ごとに直せます。金額に確度を掛けたものが加重金額です。',
    },
    { type: 'h3', id: 'forecast-category', text: '予測の区分' },
    {
      type: 'p',
      content:
        '売上予測での商談の扱いです。確度が70%以上はコミット、40%以上はベストケース、それ未満はパイプラインに入ります。',
    },
    { type: 'h3', id: 'deal-phase', text: '商談フェーズ' },
    {
      type: 'p',
      content:
        'リードの側に出る進み具合（初回ヒアリング・簡易診断・提案・現行調査受注・移行受注・AX化）です。商談のあるリードは、商談のステージから自動で決まります。',
    },
    { type: 'h2', id: 'activities', text: '記録' },
    { type: 'h3', id: 'next-action', text: '次の行動・持ち帰り事項' },
    {
      type: 'p',
      content:
        'リードについて、次にやることと期限です。期限が来ると担当者の今日の画面に出ます。持ち帰り事項は、商談で先方と約束したことです。',
    },
    { type: 'h3', id: 'act-timing', text: '動くべき時期' },
    {
      type: 'p',
      content:
        'ヒアリングで聞いた保守期限・退職予定・決算月から計算した、再び動くべき時期です。その前に担当者へ知らせます。',
    },
    { type: 'h3', id: 'handoff', text: '引き継ぎ書' },
    {
      type: 'p',
      content:
        '商談が初回ヒアリングから次の段階へ進んだとき、技術部門に渡す内容を1枚にまとめたものです。',
    },
  ],
};
