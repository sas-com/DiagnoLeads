---
id: 2026-10-15-sales-playbook-in-db
date: 2026-10-15
category: Security
title: "AX の営業向け手引き（トークスクリプト）の置き場所（#74）"
status: active
superseded_by: []
issues: [74]
paths: ["lib/features/ax-playbook/**", "components/features/ax-playbook/**"]
---

### [Security] AX の営業向け手引き（トークスクリプト）の置き場所（#74）
- **日付**: 2026-10-15
- **決定**: 手引きの本文（課題別の質問・切り返し・NG表現・持ち帰る事項）はリポジトリに置かず、組織ごとに DB（`ax_sales_playbooks`）に保存し、設定画面から登録する。コードには形（zod スキーマ）と画面だけを置く。原本は社内 SharePoint
- **理由**: このリポジトリは公開で、手引きは社内・協力会社向けの営業ノウハウ。コミットすると履歴に残り取り消せない（オーナー判断）
- **ルール**:
  - リポジトリ・Issue・PR・テストのデータに手引きの本文を書かない（テストは架空の文字列を使う）
  - 読めるのはリードを閲覧できる人（`read Lead`）、変更できるのは設定を更新できる人（`update Settings`）。読み書きとも `organizationId` で絞る。role でいうと、読める：owner / admin / member / group_owner / group_admin、変更できる：owner / admin / group_owner / group_admin。parent_viewer（親組織の閲覧者）はリードを読めても手引きは読めない（営業ノウハウは必要な人だけ。2026-10-15 オーナー判断）
  - 通知・Webhook には手引きの本文を載せない（#75）
  - パンフレットに載っている内容（4つの課題と効果など）は公開ページで使ってよい（#76）
- **既知の限界**: 2人が同時に編集すると、後から保存した内容で上書きされる（版の照合はしていない）
- **却下案**: `docs/` に Markdown で保存（公開される）。`organizations.settings` に入れる（型がなく、組織の設定の更新で上書きされうる）
