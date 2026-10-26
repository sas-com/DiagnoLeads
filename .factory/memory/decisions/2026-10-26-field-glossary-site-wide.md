---
id: 2026-10-26-field-glossary-site-wide
date: 2026-10-26
category: Architecture
title: "項目辞書（field glossary）はテナントに関わらずシステム全体共通で管理する（#780）"
status: active
superseded_by: []
issues: [780, 781]
paths: ["lib/db/schema.ts"]
---

### [Architecture] 項目辞書（field glossary）はテナントに関わらずシステム全体共通で管理する（#780）
- **日付**: 2026-10-26
- **決定**: オーナー判断。入力項目の説明と値の候補を持つ「項目辞書」は、テナント（組織）に関わらずシステム全体で共通の1つの辞書として管理する
  - テーブル `field_glossary` に `organization_id` を持たせない。全組織が同じ辞書を読む
  - 編集できるのは運営の編集者だけ（`content_editors` と同じ役割）。各テナントは編集しない
  - 読み取り API は辞書の行を `organizationId` で絞らない（CMS のサイト全体コンテンツと同じ扱い）
- **理由**: 「交渉中（negotiating）」などの項目・値の意味は全組織で共通で、組織ごとに変える要件は今ない。サイト全体の文章は app の共通データとして持つ（決定 `2026-10-21-cms-site-wide` の「組織の区別が要るデータだけ organizationId 付きの表に置く」の対）
- **ルール**:
  - `field_glossary` に `organization_id` を足さない。組織ごとに説明を変えたくなったら、この決定を見直してから、テーブル・読み書き・権限をまとめて設計し直す
  - 書き込み（編集）は運営の編集者だけに限り、公開・一般の組織メンバーからは編集できないことを、API のレビュー（security-specialist）で確かめる
  - 辞書の文言は DB の ja/en 列に持つ（`locales/` の静的文字列には置かない）
- **関連**: Epic #780、#781（スキーマ）、`2026-10-21-cms-site-wide`、`2026-10-23-cms-studio`
