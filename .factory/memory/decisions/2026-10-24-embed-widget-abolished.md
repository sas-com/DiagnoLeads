---
id: 2026-10-24-embed-widget-abolished
date: 2026-10-24
category: Architecture
title: "API キー方式の埋め込みウィジェットを廃止する（#49・#505）"
status: active
superseded_by: []
issues: [49, 505, 564]
paths: ["lib/features/embed/**", "app/[locale]/(dashboard)/settings/embed/**", "lib/cms/enabled.ts"]
---

### [Architecture] API キー方式の埋め込みウィジェットを廃止する（#49・#505）
- **日付**: 2026-10-24
- **決定**: 外部サイトから API キーで呼ぶ埋め込み（ウィジェット `packages/embed-widget` と、公開 API `/api/embed/v1` の lead・diagnostic）を廃止し、コードを消す（オーナー判断）。外部サイトに診断を載せるのは、自社ページの iframe 埋め込み（#120）が受け持つ。設定画面（`settings/embed`）・`embedRouter`・表 `embed_configs` と `embed_access_logs` も外す（#564）
- **置き換える判断**: #122（2026-10-16、オーナー）の「API キー方式の JSON 埋め込みは凍結」と、PR #293（2026-10-21）の「コードは残し、使う時期が来たら Turnstile を付けて `EMBED_API_ENABLED=true` で開ける」。どちらも Issue と PR に書かれた判断で、決定のファイルにはなっていない（superseded にするファイルはない）
- **理由**:
  - 誰でもリードを作れて Turnstile の確認がない。使っている人もおらず、AX の公開でも使わない。本番では PR #293 から 404 を返していた
  - `/api/embed/v1/lead` は `leads` に直接 insert していて、新しい回答のモデル（`diagnostic_submissions`）を通らない。開けるには #46（新しい回答 API）と Turnstile の両方が要り、どちらも予定がない
  - ウィジェットは独立した bun.lock のままで CI でビルドしておらず、設定画面が示す CDN の URL も存在しない
  - 凍結のまま残すと、使わないコードが型チェック・リント・テストの対象に残り、公開 API の面（CORS・回数制限・CMS の振り分け）を守り続けることになる
- **却下案**: 凍結のまま残す（#122・PR #293）。Turnstile を付けて開ける（使う予定がない）
- **ルール**:
  - 外部サイトから API キーで呼ぶ公開 API を作り直さない。外部サイトへの埋め込みは #120（自社ページの iframe）で考える
  - リードの `source = 'embed'` と `leadSourceEnum` の `embed` は変えない（過去のリードの表示のため）
  - `/api/embed` はアプリの API ではない（`lib/cms/enabled.ts` の `APP_API_SEGMENTS` に入れない）。CMS が止まっている本番では proxy が 404 を返し、CMS が動いている環境では Payload の catch-all が答える
  - 設定画面を外すまで（#564）、`lib/middleware/rate-limit.ts` の `pathname.includes('embed')`（tRPC の `/api/trpc/embed.*` に当たる）は残す
  - 表 `embed_configs`・`embed_access_logs` の DROP はコードの削除と別の PR にし、本番の行数を読み取りで確かめてから行う
  - Vercel に `EMBED_API_ENABLED` が残っていれば外す（オーナー）
