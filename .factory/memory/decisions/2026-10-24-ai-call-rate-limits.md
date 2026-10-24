---
id: 2026-10-24-ai-call-rate-limits
date: 2026-10-24
category: Security
title: "AI の呼び出しの回数制限と、tRPC のバッチの件数の上限（#405）"
status: active
superseded_by: []
issues: [405, 443]
paths: ["lib/features/ai/limits.ts", "lib/features/ai/api/router.ts", "lib/trpc/batch-limit.ts"]
---

### [Security] AI の呼び出しの回数制限と、tRPC のバッチの件数の上限（#405）
- **日付**: 2026-10-24
- **決定**: Claude を呼ぶ tRPC の手続き（`ai.scoreLead`・`ai.predictConversion`・`ai.generateSummary`・`ai.batchScoreLeads`・`ai.batchPredictConversion`）は、Claude に渡すリード1件を1件と数え、ユーザーごと（1時間に60件）→組織ごと（1時間に120件）→組織ごと（1日に500件）の順に `public_rate_limits` で数える（`AI_CALL_LIMITS`、`lib/features/ai/limits.ts`）。一括は見つかったリードの件数だけ数える。tRPC の HTTP バッチは1回のリクエストに20件まで（`MAX_BATCH_CALLS`）とし、超えるものはハンドラーが全件断る。クライアントは同じ件数で分けて送る（`httpBatchLink` の `maxItems`）。上限の値は公開前の初期値で、画面で使い始めるとき（#406）に見直す
- **理由**: PR #443 で単発の手続きが実際に有料 API を呼ぶようになり、一括の手続きも直すと1回で最大50件を Claude に送れる。middleware の回数制限はパスごと・IP ごと・インスタンスごとなので、`/api/trpc/ai.scoreLead,ai.scoreLead,…?batch=1` のように束ねると1回と数えられ、束ねた件数だけ Claude の呼び出しが並列で走っていた。tRPC 11 のサーバーにはバッチの件数の設定がない（`allowBatching` だけ）
- **却下案**: バッチを止める（画面はすべて `httpBatchLink` で、リクエストが増える）。AI の手続きだけバッチを禁じる（クライアントが自動で束ねるので、画面から呼ぶと失敗する）。リクエストごとに1件と数える（一括の50件が1件になり、費用と合わない）。一括の手続きを消す（画面で使うかは #406 と一緒にオーナーが決める。それまでは正しく動いて数えられる形にする）
- **ルール**:
  - Claude を呼ぶ手続きを足すときは、権限の確認と組織での読み込みの後、Claude を呼ぶ直前に `consumeAiCalls` を呼ぶ（別の組織の id や権限のない呼び出しで枠を減らさない）
  - 回数は手続きの中で DB で数える。パスで数える middleware の制限には頼らない（バッチの1件ごと・インスタンスをまたいで数えるため。#321 の Webhook のテスト送信と同じ）
  - 断ったリクエストも数える（ほかの `public_rate_limits` の規則と同じ）。一括が枠に収まらないときは全件断り、その件数を数える。クライアントは `TOO_MANY_REQUESTS` を再試行しない（`lib/trpc/retry.ts`）
  - 埋め込み（OpenAI）の手続き（`ai.semanticSearch`・`ai.findSimilar`・`ai.updateEmbedding`）は、この回数制限に入れていない
