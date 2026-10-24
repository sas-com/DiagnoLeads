---
id: 2026-10-23-admin-api-role-checks
date: 2026-10-23
category: Security
title: "管理画面 API の役割の確認と、埋め込み設定・QR キャンペーンの権限（#356）"
status: active
superseded_by: []
issues: [356]
paths: ["lib/features/embed/**", "lib/features/distribution/**"]
---

### [Security] 管理画面 API の役割の確認と、埋め込み設定・QR キャンペーンの権限（#356）
- **日付**: 2026-10-23
- **決定**: 役割の確認がなかった管理画面の手続きに、各ルーターで使っている判定を足す。埋め込み設定と QR キャンペーンの作成・変更・削除（API キーの再発行を含む）は、設定を更新できる人（`update Settings`。owner / admin / group_owner / group_admin）だけにする。閲覧はリードを読める人（parent_viewer を含む）。画面では、変更できない人にボタンを出さない（`embed.canManage` / `distribution.canManage`）（オーナー判断）
- **理由**: 10/23 の監査で、閲覧専用の役割でも API キーの再発行や削除ができることが分かった。閲覧で見えるのは、伏せ字の API キー、ハッシュにした IP、集計だけ。parent_viewer はリード本体を読めるので、見える範囲は広がらない
- **ルール**:
  - 閲覧の手続きはリードの閲覧（`read Lead`）。A/B テストと診断テンプレートのカウンターはリードの更新（`update Lead`、同じルーターのほかの変更と同じ）
  - 書き込みは、直前の読み込みで組織を絞っていても、`organizationId` の条件を付ける（同じトランザクションの中で組織を絞って `FOR UPDATE` で読んだ行を書く場合と、書く行の id をサーバーの中で決める場合は除く）。A/B テストの variant のテンプレートは、作成でも更新でも同じ組織のものか確かめる
  - 管理画面を社外の利用者に開くときは、parent_viewer に埋め込み設定と QR キャンペーンを見せるかを見直す
  - 組織の切り分けの DB テスト（約120）をすべて足し終えるまで、AX 診断を公開しない（2026-10-23 オーナー判断。#51 の公開の条件）
- **対象外**: feature-flags と audit-logs のルーターは `server/routers/_app.ts` に組み込まれておらず、外から呼べない（触っていない）
