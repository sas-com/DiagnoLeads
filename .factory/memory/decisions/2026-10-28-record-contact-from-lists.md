---
id: 2026-10-28-record-contact-from-lists
date: 2026-10-28
category: UI
title: "一覧の行から連絡を記録する入口は「連絡を記録」のボタン1つとメニューにし、リードの画面は1タップのボタンのままにする（#863）"
status: active
superseded_by: []
issues: [863, 556, 554, 776, 895]
paths: ["components/features/lead-follow-up/contact-record-menu.tsx", "components/features/lead-follow-up/contact-quick-actions.tsx", "components/features/lead-follow-up/use-record-contact.tsx", "components/features/lead-follow-up/due-tasks-list.tsx", "components/features/today/today-meetings.tsx", "components/dashboard/ax-dashboard-sections.tsx"]
---

### [UI] 一覧の行から連絡を記録する入口は「連絡を記録」のボタン1つとメニューにし、リードの画面は1タップのボタンのままにする（#863）
- **日付**: 2026-10-28
- **決定**: PR #891 の読み取り専用の UI/UX レビュー（2026-10-28）の推奨に沿って、Claude が決めた
  - 一覧の行から連絡を記録する入口は、`ContactRecordMenu`（「連絡を記録」のボタン1つ）にする
    - 押すとメニューが開く。並びは、電話した・メールした・つながらなかった・（区切り）・活動を記録
    - 対象は「今日」の画面の次の行動と商談予定の行。ダッシュボードの相談申込の行は #895 で合わせる
  - リードの画面のバーは、今までどおり1タップのボタン（`ContactQuickActions`）にする
  - メニューの中身・順番・言葉と、記録のトースト（リード名つき・元に戻す）は、どの画面でも同じにする
  - ボタンはリンクの中に入れず、行の右端に置く。押せる範囲は 44px、文字は 14px（決定 `2026-10-24-admin-dads`）
  - タッチでは pointerdown で開かず、タップ（click）で開く。スクロールの始まりで開かないようにするため
- **理由**
  - 行ごとに4つのボタンを並べると、スマホで行が折り返して重くなる。compact（32px・12px）は DADS に合わない
  - 一覧では2タップになる。ただ、スクロール中の誤記録を防ぐ軽い確認になり、リードの画面へ移るより手数が少ない
- **ルール**
  - 一覧の行に記録の入口を足すときは `ContactRecordMenu` を使う。`ContactQuickActions` の compact は新しく使わない
  - 入口は、リードを編集できる人（`useLeadAccess` の `canEdit`）にだけ出す
  - 1タップの記録では、次の行動を完了にしない。連絡と完了は1対1ではないため（「つながらなかった」は完了ではない、など）。記録の続きで完了にする流れは #776 で決める
  - 商談予定の行から何を記録させるか（ヒアリング・活動）は、#776 の二重計上の扱いと一緒に決める。それまでヘルプは「打ち合わせで聞いたことはヒアリングとして記録する」とする
- **却下案**
  - 行ごとに4つのボタンを並べる：スマホで行が折り返す
  - 分割ボタン（「電話した」＋▼）：よく使う種類が人によって違い、幅も取る
