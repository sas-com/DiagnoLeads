---
id: 2026-10-23-cms-studio
date: 2026-10-23
category: CMS
title: "CMS を Payload の管理画面の中の Studio 型にする。P1 で古いコンテンツ機能を閉じる（#339, #413）"
status: active
superseded_by: []
issues: [339, 413]
paths: ["cms/**", "payload.config.ts"]
---

### [CMS] CMS を Payload の管理画面の中の Studio 型にする。P1 で古いコンテンツ機能を閉じる（#339, #413）
- **日付**: 2026-10-23
- **決定**: Epic #339 を書き直した（オーナー判断）
  - CMS は Payload の管理画面（/admin）の中に、Studio のような管理の画面を作る。ダッシュボードには作らない。マーケが画面からモデル（記事・投稿者・タグなど）と項目を足せるようにする
  - ハイブリッドの設計：AX コラムはコードで定義するシステムのモデル `ax-columns`、マーケが作るモデルは `cms-models`・`cms-entries`（残りの項目は jsonb）で持つ
  - 画像は Supabase Storage に置く（今の契約の範囲で、追加の費用がかからない）
  - 誇張表現（claims）のチェックは公開だけを止める。下書きでは警告にとどめる
  - 使っていない Payload のコレクション（BlogPosts・LandingPages・DiagnosticForms・FAQs）は外した。公開ブログ（/ja/blog・/en/blog）と、ダッシュボードの「コンテンツ管理 → ブログ・FAQ」も閉じた（P1、#413）
  - ダッシュボードの「コンテンツ編集者」の画面は P1 で外した。表 `content_editors` は、本番の行数を読み取り専用で数えてから P2 のマイグレーションで落とす
- **ルール**:
  - CMS の最後の admin は、自分の役割を下げることも、削除することもできない（`cms/hooks/last-admin.ts`）。2人の admin が同時にお互いを下げる競合は許容する
  - P2 の SQL（cms スキーマの作成）は、準備ができたらすぐ実行する。10/28〜29 でもよい。オーナーは実行した時刻を Claude に伝える。公開の作業の直後には実行しない。戻すときは `DROP SCHEMA cms CASCADE`
  - P12（CMS を有効にする）の前に：/admin の転送を外す前に最初の admin を作る。例の秘密鍵（`.env.example` 類）は空にしておく（P1 で空にした。`PAYLOAD_SECRET` は CMS がオンなら32文字以上・例の値は拒否）
