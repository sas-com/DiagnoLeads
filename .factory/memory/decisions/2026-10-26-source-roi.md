---
id: 2026-10-26-source-roi
date: 2026-10-26
category: Analytics
title: "獲得元・代行会社別に、商談の受注額と ROI を獲得費用の横に出す（#448）"
status: active
superseded_by: []
issues: [448, 430, 435]
paths: ["lib/features/analytics/lead-sources.ts", "lib/features/analytics/api/router.ts", "lib/auth/deal-access.ts", "lib/features/deals/access.ts", "app/[locale]/(dashboard)/analytics/_components/source-cost-cards.tsx"]
---

### [Analytics] 獲得元・代行会社別に、商談の受注額と ROI を獲得費用の横に出す（#448）
- **日付**: 2026-10-26
- **決定**: 分析の「流入元」タブの獲得費用のカードと代行会社のカードに、そのリードの商談の数・受注数・受注額・受注単価・ROI・受注までの日数の中央値を「受注と費用対効果」の表で足す。営業パイプラインの評価（Epic #430）の指摘。オーナーが着手を指示（2026-10-26）
- **理由**: 獲得元の評価が SQL で止まっていた。#435 で商談に金額と受注日が入ったので、獲得費用に対して何が返ってきたかまで出せる
- **ルール**:
  - 期間は、今の分析と同じくリードの作成日で区切る。その期間のリードの商談を、ステージを問わずすべて数える（商談の受注日では区切らない）
  - 受注額：受注の商談の金額の合計（金額のない受注は 0）。受注単価：獲得費用 ÷ 受注の商談の数。ROI：受注額 ÷ 獲得費用（2.5 なら 2.5 倍）。獲得費用が 0 の区分は ROI を出さない（画面は「—」）
  - 受注までの日数：リードの作成日（日本の日付）から商談を閉じた日まで。受注の商談の中央値
  - 獲得費用は今までどおりリードの `acquisition_cost`（#83）。商談ごとの費用は持たない
  - 金額を見せるのは、商談を読める人だけ（`canReadDeals`。親組織の閲覧者と、#276 の営業代行のアカウントは除く。決定 `2026-10-24-deals-beside-leads`）。読めない人には、手続きが `deals: null` を返し、画面に表を出さない
  - `canReadDeals`・`canWriteDeals` の本体は `lib/auth/deal-access.ts` に置く。analytics が `lib/features/deals` を読むと、機能の循環（analytics は leads と循環している）に deals が入るため。`lib/features/deals/access.ts` は再 export する
- **見直しの条件**: 1つのリードに複数の獲得元が絡む運用（代行のアポを紹介でも得たなど）が増えたら、費用と受注の配分の仕方を決める
- **却下案**: 受注の商談の受注日で期間を区切る（獲得費用はリードの作成日で区切っているので、同じ区分の費用と受注が別の期間のリードになり、ROI が意味を持たない）
