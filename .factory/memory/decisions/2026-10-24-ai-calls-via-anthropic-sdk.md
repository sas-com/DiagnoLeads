---
id: 2026-10-24-ai-calls-via-anthropic-sdk
date: 2026-10-24
category: Architecture
title: "アプリから Claude を呼ぶときは Anthropic SDK を直接使う（#442, #443）"
status: active
superseded_by: []
issues: [442, 443, 432, 449]
paths: ["lib/features/ai/client.ts", "lib/features/ai/scoring/*.ts", "lib/features/ai/prediction/*.ts", "lib/features/ai/chat/*.ts", "lib/features/ai/api/router.ts"]
---

### [Architecture] アプリから Claude を呼ぶときは Anthropic SDK を直接使う（#442, #443）
- **日付**: 2026-10-24
- **決定**: Claude の呼び出しは `@anthropic-ai/sdk`（1.x）を直接使う。JSON で受け取るものは構造化出力（`messages.parse` と `jsonSchemaOutputFormat`）にし、プロンプトで「JSON だけを返せ」と頼んで正規表現で取り出す書き方はしない。Vercel AI SDK（`ai`・`@ai-sdk/anthropic`）は、残っているチャット（`/api/chat`）を #432 で消すときに依存から外す。埋め込み（OpenAI）はこの決定の対象外
- **理由**: 提供の終わったモデル `claude-sonnet-4-20250514` を呼び続けて、AI の機能がすべて失敗していた（#442）。後継の Claude Sonnet 5.5 は、`temperature` などのサンプリングの値を受け付けず、思考のブロックを先に返す。`ai` 4.x は `temperature` を省くと 0 を送るので、そのままでは使えない。Anthropic SDK なら、新しいモデルの機能（構造化出力・`effort`・思考のブロック）を、間の層を待たずに使える
- **却下案**: `ai` と `@ai-sdk/anthropic` を上げて使い続ける（新しいモデルへの追従が一段遅れ、層が1つ増える）。zod を 3.25 以上に上げて `zodOutputFormat` を使う（zod はアプリ全体で使っていて影響が広い。別に判断する）
- **ルール**:
  - モデル ID は、提供終了の予定を Anthropic の公式（モデルの一覧・提供終了のページ）で確かめ、終わる前に替える
  - 呼び出しが失敗したときに代わりの値を返す場合も、`stop_reason` やエラーをログに残す（失敗に気づけるようにする）。エラーは SDK のエラーをそのまま出してよい（リクエスト本文は入らない）。代わりの値には印（スコアは `isFallback: true`）を付け、DB に書かない。単発の `ai.scoreLead` は `SERVICE_UNAVAILABLE` を返し、一括は代わりの値になったリードを更新しない（#449）
  - Vercel の関数は 30 秒で止まるので、client のタイムアウト・再試行・`max_tokens` はそれに合わせる。client・モデル ID・`max_tokens` は `lib/features/ai/client.ts` の1か所にまとめてある（タイムアウト 20 秒・再試行なし・`max_tokens` 4000。SDK はタイムアウトした要求も再試行するので、再試行を足すと 30 秒を超える）。新しい呼び出しはこれを使い、client を増やさない（#449）
