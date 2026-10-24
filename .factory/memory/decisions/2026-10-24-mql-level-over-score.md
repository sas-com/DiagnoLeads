---
id: 2026-10-24-mql-level-over-score
date: 2026-10-24
category: Sales
title: "見込みの指標は MQL段階に一本化し、点数は診断のカードで根拠として出すだけにする（#447）"
status: active
superseded_by: []
issues: [447, 430, 432]
paths: ["lib/features/leads/detail-fields.ts", "lib/features/leads/list-query.ts", "lib/features/leads/api/list-sql.ts", "components/features/leads/lead-table.tsx", "components/features/leads/lead-card.tsx", "components/features/leads/lead-summary-sheet.tsx", "components/features/leads/lead-form.tsx", "components/features/leads/list/lead-filter-controls.tsx", "components/features/leads/list/lead-sort-control.tsx", "components/features/leads/detail/lead-detail-view.tsx", "components/features/leads/detail/lead-fields-card.tsx", "components/features/leads/detail/lead-diagnosis-card.tsx"]
---

### [Sales] 見込みの指標は MQL段階に一本化し、点数は診断のカードで根拠として出すだけにする（#447）
- **日付**: 2026-10-24
- **決定**: リードの見込みを表すのは MQL段階（関心あり・適合・対象外、診断なし）とする。点数（`leads.score`）は、診断のカードで「なぜその段階か」の根拠として出すだけにする。営業パイプラインの評価（Epic #430）の推奨案を、オーナーが承認
- **理由**: 点数と MQL段階の2系統が並び、営業がどちらを信じて動くか分からなかった。スコアのルールセットは作成時に自動で使われず、#432 で手続きごと外した
- **ルール**:
  - 一覧：MQL段階の列を 640px 以上で初期表示にし、見出しで MQL段階の順（関心あり → 適合 → 対象外 → 診断なし）に並べられる。絞り込みに「MQL段階」（複数選択、URL は `level`）を置く。点数の列・並び替え・範囲の絞り込み・カードの点数・平均点のカードは出さない
  - 一覧の並び替えと絞り込みでは、MQL判定日のあるリード（診断なしで手で MQL にしたものも）を関心ありとして扱う。緑のバッジ（LeadMqlBadges）と同じ見え方にそろえるため（2026-10-24 のレビューで追加）
  - 前に共有されたリンク：`scoreMin`・`scoreMax` は解釈し、チップで外せる。`sort=score` は既定の並び（作成日の新しい順）に読み替える
  - 詳細とサイドパネル：見出しに点数のかわりに MQL段階のバッジを出す。パイプラインのカードで点数を手で入れない
  - 点数を出す場所：AX 移行診断は診断のカードの「MQL判定」の下に `leads.score`（資料請求・勉強会の加点を含む）を出す。ビルダー診断は診断の要約の点数と理由を出す。診断のないリードの点数は画面に出ない（書き出しには出る）
  - 点数は MQL の判定のシグナルの1つ（`min_score`、`lib/features/diagnostics/ax-migration/mql.ts`）として使い続ける。表示を下げただけで、判定から外したのではない
  - 新規作成のフォームに点数の欄を置かない。API（tRPC の `leads.update`・REST API v2）・CSV の取り込み・Webhook・書き出し（CSV・JSON・PDF）の `score` は外部の連携のために残す
  - 診断のない手入力のリード（紹介・代行など）は「診断なし」。見込みは MQL のチェック（パイプラインのカード）で関心ありとみなし、ヒアリングの後は商談評価 A/B/C で優先を付ける
  - 同じ段階の中の順番は、相談の申込・動くべき時期・次の商談日・最終活動日の絞り込みと並び替えで付ける
  - ダッシュボードの平均点と分析の点数の分布は、別の PR で扱う（#447 の2つ目）
- **見直しの条件**: 適合のリードの架電の取りこぼしが出たら、段階の中の優先順位の付け方（よく使う絞り込みの用意、段階を手で選べるようにするか）を見直す
- **却下案**: 点数を正式な指標にして MQL段階を点数から決める（MQL段階は回答の中身で決まり、点数の閾値に置き換えると判定の理由が説明できなくなる）
