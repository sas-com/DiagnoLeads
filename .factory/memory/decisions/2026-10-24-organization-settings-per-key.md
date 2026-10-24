---
id: 2026-10-24-organization-settings-per-key
date: 2026-10-24
category: Architecture
title: "organizations.settings はキーごとに書き、organizations.update は settings を受けない（#483）"
status: active
superseded_by: []
issues: [483]
paths: ["lib/features/organizations/**"]
---

### [Architecture] organizations.settings はキーごとに書き、organizations.update は settings を受けない（#483）
- **日付**: 2026-10-24
- **決定**: `organizations.settings`（jsonb）は、キーを持つ機能が自分のキーだけを SQL でマージして書く（`coalesce(settings, '{}') || jsonb_build_object('<key>', ...)`）。`organizations.update` は名前とスラッグだけを変え、入力のスキーマから `settings` を外す。送られた `settings` は zod が捨てる（エラーにはしない）（Issue のオーナーの提案どおり）
- **理由**: 窓口（`leadIntakeUserIds`）・引き継ぎ先（`leadHandoffUserIds`）・動くべき時期（`actTiming`）・ヒアリング項目（`hearingCatalog`）・資料と勉強会（`axInfoOffers`）が同じ列に置かれている。丸ごと置き換える経路が1つあると、どれも一度に消え、気づく手段がない。設定画面は名前とスラッグしか送っていなかった
- **却下案**: `organizations.update` で受けた settings を浅くマージする（どのキーをだれが変えてよいかの確認が要り、今は呼び出し元がない）。未知のキーをエラーにする（`.strict()`。古いクライアントの呼び出しが失敗する）
- **ルール**:
  - settings に新しいキーを足す機能は、自分の get / set（またはsave）を `lib/features/<feature>/` に置き、そのキーだけをマージで書く
  - `organizations.update` などで settings を受ける必要が出たら、キーを1つずつ受け、そのキーだけをマージする。権限はそのキーを持つ機能の手続きに合わせる
  - 実 DB テスト：`test/unit/integration/organizations-settings.db.test.ts`（各機能が書いたキーが update の後も残ること）
