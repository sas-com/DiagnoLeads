---
id: 2026-10-25-comments-hidden-from-parent-viewer
date: 2026-10-25
category: Security
title: "リードの社内メモは親組織の閲覧者に見せない。ほかの人の返信があるメモはオーナーだけが消せる（#555）"
status: active
superseded_by: []
issues: [555, 430]
paths: ["lib/features/comments/**", "components/features/comments/**", "lib/features/lead-activity/api/router.ts"]
---

### [Security] リードの社内メモは親組織の閲覧者に見せない。ほかの人の返信があるメモはオーナーだけが消せる（#555）
- **日付**: 2026-10-25
- **決定**（オーナー判断。PR #649 で確認をお願いした2点に、2026-10-25 に「スペシャリストのレビューで問題なければマージ」と指示）:
  - リードの社内メモ（`lead_comments`）を読めるのは、リードを読める人から親組織の閲覧者（parent_viewer）を除いた人（`lib/features/comments/access.ts` の `canReadComments`）。書けるのは、リードを更新でき、メモを読める人（`canWriteComments`）
  - 活動の履歴（`leadActivity.list`）は、メモを読めない人にはメモの行を返さない（先頭200字も出さない）。決定 [2026-10-16-lead-activity-and-audit](./2026-10-16-lead-activity-and-audit.md) の「読めるのはリードを閲覧できる人（parent_viewer を含む）」の、メモの行だけの例外。ほかの行は今までどおり
  - メモを消すと、その返信も一緒に消す（`parent_id` に外部キーがなく、返信だけが活動の履歴に残っていた）。ほかの人の返信があるときは、オーナー（manage all）だけが消せる
- **理由**: 顧客探しからリードにしたときのメモには、相手の部署・役職・姓、困りごと、「聞いた話」が入る。同じ画面の顧客探しのカードはこれを親組織に見せていないのに、メモのタブと活動の履歴から読めてしまう。商談（`canReadDeals`）・営業の手引き（`canReadPlaybook`）と同じ扱いにそろえる。返信を本人がまとめて消せると、ほかの人の書いたものを消せることになる
- **ルール**:
  - 隠すのはサーバー側（一覧・件数は FORBIDDEN、活動の履歴はメモを読まない）。リード詳細でタブを出さないのは補助
  - 監査ログ（resource `lead_comment`）に本文を残さない。更新は `metadata.changedText`、削除は種類・ピン・作成者の id だけ。消した返信も1件ずつ残す
  - 営業代行のアカウント（#276）を作るときは、`COMMENTS_READ_EXCLUDED_ROLES` に足すかを決める
  - 親会社と子会社が別の法人の場合に、親組織の閲覧者が子会社のリードの個人情報を読むこと（第三者提供・共同利用）は、法務の確認が要る（parent_viewer の仕組み全体の前提）
- **却下案**: 親組織の閲覧者にも見せる（顧客探しで隠した内容がメモ経由で見える）。画面のタブだけ隠す（API と活動の履歴から読める）
