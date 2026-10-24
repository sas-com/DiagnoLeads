---
id: 2026-10-16-ax-company-size
date: 2026-10-16
category: Assessments
title: "AX 診断の企業規模と対象顧客の判定（#150, Epic #162）"
status: active
superseded_by: []
issues: [150, 162]
paths: ["lib/features/diagnostics/ax-migration/company-size.ts", "lib/features/diagnostics/ax-migration/mql.ts"]
---

### [Assessments] AX 診断の企業規模と対象顧客の判定（#150, Epic #162）
- **日付**: 2026-10-16
- **決定（オーナー判断）**: 営業の対象顧客の条件を診断の判定にそのまま使う。条件の範囲は組織の設定（営業の手引き `ax_sales_playbooks.content.targetCompany`）に置き、コードには選択肢の区切りだけを書く。3問（売上高・従業員数・拠点数）は任意
- **ルール**:
  - 診断の版は 3。設問は回答画面の「会社の規模（任意）」ステップ（連絡先の直前）。「わからない・答えたくない」を選べる
  - 企業規模は「適合」（#139）の必須条件の1つ。範囲外の回答が1つでもあれば `not_fit` で適合にならない（`unmet` に `company_size`）。後から相談申込があっても「関心あり」に上がらない。未回答・「わからない」では外さない（`unknown`）。範囲を何も選ばない項目は条件にしない
  - 回答者に見せる結果と次の行動（相談・情報収集）は企業規模で変えない（範囲が推測されないように）
  - 従業員数の区切りはヒアリング票と同じにし、ヒアリング票へ事前入力する
  - 範囲は組織のメンバー全員（手引きを読める人。親組織の閲覧者は除く）が設定できる（オーナー判断）。手引き本体の編集は従来どおり owner / admin。範囲は `axPlaybook.updateTargetCompany` で別に保存し、手引き本体の保存は保存済みの範囲を上書きしない
- **関連**: #139（適合と関心あり）の必須条件に加えた。判定は `lib/features/diagnostics/ax-migration/mql.ts`
