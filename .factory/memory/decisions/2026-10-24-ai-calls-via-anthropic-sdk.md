---
id: 2026-10-24-ai-calls-via-anthropic-sdk
date: 2026-10-24
category: Architecture
title: "アプリから Claude を呼ぶときは Anthropic SDK を直接使う（#442, #443）"
status: active
superseded_by: []
issues: [442, 443, 432, 449, 534, 552, 47]
paths: ["lib/features/ai/client.ts", "lib/features/ai/failures.ts", "lib/features/ai/scoring/*.ts", "lib/features/ai/prediction/*.ts", "lib/features/ai/chat/*.ts", "lib/features/ai/api/router.ts", "lib/features/ai/types/schemas.ts"]
---

### [Architecture] アプリから Claude を呼ぶときは Anthropic SDK を直接使う（#442, #443）
- **日付**: 2026-10-24
- **決定**: Claude の呼び出しは `@anthropic-ai/sdk`（1.x）を直接使う。JSON で受け取るものは構造化出力（`jsonSchemaOutputFormat` を `output_config.format` に渡す）にし（2026-10-25 から、受け取りは `messages.parse` ではなく `messages.create` と `readStructuredOutput`。使用量のログを解析の前に出すため。決定 `2026-10-25-ai-v1-prompt-assets`）、プロンプトで「JSON だけを返せ」と頼んで正規表現で取り出す書き方はしない。Vercel AI SDK（`ai`・`@ai-sdk/anthropic`）は、残っているチャット（`/api/chat`）を #432 で消すときに依存から外す。埋め込み（OpenAI）はこの決定の対象外
- **理由**: 提供の終わったモデル `claude-sonnet-4-20250514` を呼び続けて、AI の機能がすべて失敗していた（#442）。後継の Claude Sonnet 5.5 は、`temperature` などのサンプリングの値を受け付けず、思考のブロックを先に返す。`ai` 4.x は `temperature` を省くと 0 を送るので、そのままでは使えない。Anthropic SDK なら、新しいモデルの機能（構造化出力・`effort`・思考のブロック）を、間の層を待たずに使える
- **却下案**: `ai` と `@ai-sdk/anthropic` を上げて使い続ける（新しいモデルへの追従が一段遅れ、層が1つ増える）。zod を 3.25 以上に上げて `zodOutputFormat` を使う（zod はアプリ全体で使っていて影響が広い。別に判断する）
- **ルール**:
  - モデル ID は、提供終了の予定を Anthropic の公式（モデルの一覧・提供終了のページ）で確かめ、終わる前に替える
  - 呼び出しが失敗したときに代わりの値を返す場合も、`stop_reason` やエラーをログに残す（失敗に気づけるようにする）。エラーは SDK のエラーをそのまま出してよい（リクエスト本文は入らない）。DB に書く代わりの値（今はスコア）には印（`isFallback: true`）を付け、DB に書かない。単発の `ai.scoreLead` は `SERVICE_UNAVAILABLE` を返し、一括は代わりの値になったリードを更新せず、`failedLeadIds` で返し、全件が代わりの値なら `SERVICE_UNAVAILABLE` を返す（#449・#534）。予測と要約の代わりの値には印がない（DB に書かないため）。画面で使い始めるときに付けるかを決める
  - 直すまで続く失敗（Claude API の 400・401・402・403・404：キーの誤り・支払い・提供終了したモデル・利用額の上限など）は、`reportClaudeFailure`（`lib/features/ai/failures.ts`）で当番に知らせる。429・529・ほかの 5xx・タイムアウトのような一時的な失敗は知らせず、ログだけに残す（#552、オーナー判断）
  - Vercel の関数は 30 秒で止まるので、client のタイムアウト・再試行・`max_tokens` はそれに合わせる。client・モデル ID・`max_tokens` は `lib/features/ai/client.ts` の1か所にまとめてある（タイムアウト 20 秒・再試行なし・`max_tokens` 4000。SDK はタイムアウトした要求も再試行するので、再試行を足すと 30 秒を超える）。新しい呼び出しはこれを使い、client を増やさない（#449）。一括のスコア・予測は1回に `AI_BATCH_MAX`（5件、`lib/features/ai/types/schemas.ts`）までにし、全件を並列に呼んで1回分の時間で終える。5件の組を順に呼ぶと 30 秒を超えるので、上限を上げない（#534）
