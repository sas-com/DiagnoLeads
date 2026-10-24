---
id: 2026-10-16-agency-links
date: 2026-10-16
category: Leads
title: "営業代行会社ごとの診断リンク（#147, Epic #162）"
status: active
superseded_by: []
issues: [147, 162]
paths: ["lib/features/agency-links/**", "components/features/agency-links/**", "lib/features/diagnostics/tracking.ts"]
---

### [Leads] 営業代行会社ごとの診断リンク（#147, Epic #162）
- **日付**: 2026-10-16
- **決定**: 代行会社（とキャンペーン）ごとに `agency_links` へリンクを発行し、`/ja/ax-diagnosis?agency=<コード>` から回答されて新しく作られたリードに、流入元（リンクの種類）・代行会社名・`agency_link_id` を入れる。リンクの判定は UTM より優先する
- **ルール**:
  - コードは推測できないランダムな12文字。無効・不明・別組織・形式違いのコードは何も紐付けない（回答は受け付け、コードは送信の tracking に残す）
  - 公開フォームなので、登録済みのメールアドレスからの回答では既存のリードを書き換えない（代行会社も付けない）
  - 代行会社名・単価・ターゲット条件はコードに書かず DB に置く（リポジトリは公開）
  - 一覧はリードを読める人（親組織の閲覧者を除く）、発行・無効化は設定を更新できる人（owner / admin）
  - utm_medium の `telemarketing` / `teleapo` / `outbound_call` は「テレアポ代行」、`referral_agency` は「紹介代行」。このとき `ref` は紹介元ではなく代行会社名として扱う
- **理由**: 一般的な代行会社のリストでは対象機種の会社か見分けられないため、お客様自身の診断で機種を確かめ、代行会社別の成果（#148）を正しく数えるため
