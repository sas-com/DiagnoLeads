---
id: 2026-10-21-cms-site-wide
date: 2026-10-21
category: CMS
title: "CMS はサイト全体の文章だけに使い、組織ごとには扱わない（#277）"
status: active
superseded_by: []
issues: [277]
paths: ["cms/**", "payload.config.ts", "lib/cms/**"]
---

### [CMS] CMS はサイト全体の文章だけに使い、組織ごとには扱わない（#277）
- **日付**: 2026-10-21
- **決定**: Payload の FAQ・ブログ・LP は、サイト全体で1つのコンテンツとして扱う。顧客の組織ごとに CMS のコンテンツを持たせる予定はない（オーナー判断）。組織ごとに扱う前提で残っていたコード（使われていない `lib/cms/collections/`、`lib/cms/helpers/tenant.ts`、`AssessmentRepository`、リポジトリと接続部分の `organizationId` の引数と絞り込み）は削除した
- **理由**: 実際の Payload の定義（`cms/collections/`）に組織の項目はなく、読み書きのどこも組織で区切っていない。名残のコードを見て FAQ を組織ごとのデータだと誤解し、存在しない値を組織 ID として渡す不具合を直す方向を誤りかけた（#264）
- **ルール**: 編集できるのは運営組織の編集者だけ（`lib/features/content/editors.ts`）。組織ごとのコンテンツが必要になったら、この決定を見直してから、Payload の定義・読み書き・権限をまとめて設計する。組織の区別が要るデータは、Payload ではなくアプリの DB（組織 ID 付きの表）に置く（診断ビルダーと同じ考え方）
