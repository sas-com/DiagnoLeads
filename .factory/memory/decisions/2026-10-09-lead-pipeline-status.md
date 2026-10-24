---
id: 2026-10-09-lead-pipeline-status
date: 2026-10-09
category: Domain
title: "リードのステータスを営業フローの5区分に変更"
status: active
superseded_by: []
issues: [54]
paths: ["lib/features/leads/types/pipeline.ts", "lib/features/leads/import-service.ts", "app/api/v2/leads/**"]
---

### [Domain] リードのステータスを営業フローの5区分に変更
- **日付**: 2026-10-09
- **決定**: ステータスを `new / nurturing / negotiating / won / lost`（新規／ナーチャリング／商談中／成約／失注）に変更。流入元・コンバージョンポイント・商談フェーズ・対象システム・紹介元・失注理由・商談済みフラグ・MQL/SQL 判定日を leads に追加（#54）
- **理由**: AX マイグレーションの営業・マーケティングフロー（2026-10-08 案）で使う「既存のリード管理ダッシュボード」を DiagnoLeads で置き換えるため
- **ルール**:
  - 値の定義は `lib/features/leads/types/pipeline.ts` に1か所で持つ（DB は text 列、検証は zod）
  - 商談済みフラグは一度 ON になったら戻さない（ステータス変更では true しか書かない）
  - MQL 判定（マーケ）と SQL 判定（営業がヒアリング後に「SQL / SQL外」を記録）は、ステータスとは別に明示的に記録する。ステータス変更で判定日を自動で入れない（2026-10-09 レビュー指摘: 資料 p.4 では商談中＝ヒアリング段階のため、SQL 数が水増しされる）
  - 旧値（contacted / qualified / converted）は CSV 取り込みと REST API v2 で新しい値に読み替える
  - 対象システムは AS/400／その他オフコン・汎用機／VB／Access（部署単位のツールを含む）／WebPerformer／その他。VB・Access・ローコードは明確に分け、ローコードはまず WebPerformer を対象にする（2026-10-09 オーナー判断）
  - `convertedLeads` などの集計名は互換のため残し、中身は `won` を数える
- **却下案**: Postgres の enum 型にする（値の追加にマイグレーションが要り、営業フローの見直しに追従しにくい）
