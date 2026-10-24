---
id: 2026-10-24-mql-level-over-score
date: 2026-10-24
category: Sales
title: "見込みの指標は MQL段階に一本化し、点数は診断のカードで根拠として出すだけにする（#447）"
status: active
superseded_by: []
issues: [447, 430, 432]
paths: ["lib/features/leads/detail-fields.ts", "components/features/leads/lead-table.tsx", "components/features/leads/lead-card.tsx", "components/features/leads/list/lead-filter-controls.tsx", "components/features/leads/list/lead-sort-control.tsx"]
---

### [Sales] 見込みの指標は MQL段階に一本化し、点数は診断のカードで根拠として出すだけにする（#447）
- **日付**: 2026-10-24
- **決定**: リードの見込みを表すのは MQL段階（関心あり・適合・対象外）とする。点数（`leads.score`）は、診断のカードで「なぜその段階か」の根拠として出すだけにする。営業パイプラインの評価（Epic #430）の推奨案を、オーナーが承認
- **理由**: 点数と MQL段階の2系統が並び、営業がどちらを信じて動くか分からなかった。スコアのルールセットは作成時に自動で使われず、#432 で手続きごと外した
- **ルール**:
  - 一覧：点数の列・並び替え・範囲の絞り込み・カードの点数・平均点のカードを出さない。前に共有されたリンクの `scoreMin`・`scoreMax`・`sort=score` は解釈し、絞り込みはチップで外せる（リンクを壊さない）
  - 詳細：見出しは点数のかわりに MQL段階のバッジ。パイプラインのカードで点数を手で入れない。点数と理由は診断のカードに出る
  - 新規作成のフォームに点数の欄を置かない
  - API（tRPC の `leads.update`・REST API v2）と Webhook の `score` は残す（外部の連携が読む）。書き出し（CSV・JSON・PDF）の点数も残す
  - ダッシュボードの平均点と分析の点数の分布は、別の PR で扱う（#447 の2つ目）
- **却下案**: 点数を正式な指標にして MQL段階を点数から決める（MQL段階は回答の中身で決まり、点数の閾値に置き換えると判定の理由が説明できなくなる）
