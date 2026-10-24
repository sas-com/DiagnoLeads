---
id: 2026-10-24-ai-call-rate-limits
date: 2026-10-24
category: Security
title: "AI の呼び出しの回数制限と、tRPC のバッチの件数の上限（#405）"
status: active
superseded_by: []
issues: [405, 443, 576, 598]
paths: ["lib/features/ai/limits.ts", "lib/features/ai/prompt-input.ts", "lib/features/ai/embeddings/openai.ts", "lib/features/ai/api/router.ts", "lib/trpc/batch-limit.ts"]
---

### [Security] AI の呼び出しの回数制限と、tRPC のバッチの件数の上限（#405）
- **日付**: 2026-10-24
- **決定**: Claude を呼ぶ tRPC の手続き（`ai.scoreLead`・`ai.predictConversion`・`ai.generateSummary`・`ai.batchScoreLeads`・`ai.batchPredictConversion`）は、Claude に渡すリード1件を1件と数え、ユーザーごと（1時間に60件）→組織ごと（1時間に120件）→組織ごと（1日に500件）の順に `public_rate_limits` で数える（`AI_CALL_LIMITS`、`lib/features/ai/limits.ts`）。一括は見つかったリードの件数だけ数える。tRPC の HTTP バッチは1回のリクエストに20件まで（`MAX_BATCH_CALLS`）とし、超えるものはハンドラーが全件断る。クライアントは同じ件数で分けて送る（`httpBatchLink` の `maxItems`）。1件の大きさにも上限を置く：Claude に渡すリードは `leadForClaude`（`lib/features/ai/prompt-input.ts`）を通し、プロンプトに入る文字の項目（`name`・`company`・`email`・`status`・`source`）を1,000文字、診断の回答（`responses`）を JSON で約20,000文字に切る。上限の値は公開前の初期値で、画面で使い始めるとき（#406）に見直す
- **理由**: PR #443 で単発の手続きが実際に有料 API を呼ぶようになり、一括の手続きも直すと1回で最大50件を Claude に送れる。middleware の回数制限はパスごと・IP ごと・インスタンスごとなので、`/api/trpc/ai.scoreLead,ai.scoreLead,…?batch=1` のように束ねると1回と数えられ、束ねた件数だけ Claude の呼び出しが並列で走っていた。tRPC 11 のサーバーにはバッチの件数の設定がない（`allowBatching` だけ）。件数だけ数えても、リードの入力（tRPC・REST v2・公開の診断フォーム）には長さの上限がないので、1件に数 MB を入れると1回の費用が桁違いになる（読み取り専用のレビューの指摘）。組織は1人でいくつでも作れる（`organizations.create`）ので、実際の上限はユーザーごとの1時間に60件（1人で1日に最大1,440件）。アプリの上限は最後の止めにならないので、Anthropic のワークスペースの月の上限額は別に確かめる
- **却下案**: バッチを止める（画面はすべて `httpBatchLink` で、リクエストが増える）。AI の手続きだけバッチを禁じる（クライアントが自動で束ねるので、画面から呼ぶと失敗する）。リクエストごとに1件と数える（一括の50件が1件になり、費用と合わない）。一括の手続きを消す（画面で使うかは #406 と一緒にオーナーが決める。それまでは正しく動いて数えられる形にする）
- **ルール**:
  - Claude を呼ぶ手続きを足すときは、権限の確認と組織での読み込みの後、Claude を呼ぶ直前に `consumeAiCalls` を呼ぶ（別の組織の id や権限のない呼び出しで枠を減らさない）
  - Claude にはリードを `leadForClaude` で切ってから渡す。プロンプトにリードの項目を足すときは、`leadForClaude` でもその項目を切る。切るのは渡す写しだけで、書き戻すリードと変更の通知（`leadChangeEvents`）には元の行を使う
  - 回数は手続きの中で DB で数える。パスで数える middleware の制限には頼らない（バッチの1件ごと・インスタンスをまたいで数えるため。#321 の Webhook のテスト送信と同じ）
  - 断ったリクエストも数える（ほかの `public_rate_limits` の規則と同じ）。一括が枠に収まらないときは全件断り、その件数を数える。クライアントは `TOO_MANY_REQUESTS` を再試行しない（`lib/trpc/retry.ts`）
  - 埋め込み（OpenAI）を呼ぶ手続き（`ai.semanticSearch`・`ai.updateEmbedding`）は、埋め込み1回を1件と数え、Claude とは別の枠 `EMBEDDING_CALL_LIMITS`（ユーザーごと1時間に300件→組織ごと1時間に600件→組織ごと1日に3,000件）で同じように数える（`consumeEmbeddingCalls`。#576）。Claude と同じ枠にしないのは、埋め込み1回の費用が Claude の1回よりずっと小さく、検索で Claude の残りの枠（スコアリングなど）を使い切らないようにするため。数える場所と断り方は Claude と同じ（権限の確認と組織での読み込みの後、OpenAI を呼ぶ直前）
  - 埋め込みに渡す文にも上限を置く：検索の文（`semanticSearchSchema` の `query`）は500文字まで（超えると `BAD_REQUEST`）、リードの文（`prepareLeadText`）は項目ごとに1,000文字・全体で2,000文字に切る（1文字が数トークンになる文でもモデルの入力の上限を超えないように。超えると、数えた後に OpenAI に断られる）。埋め込みにリードの項目を足すときは、`prepareLeadText` の中で切る。OpenAI を呼ぶ関数（`generateEmbedding`）を新しく呼ぶときは、埋め込む文の件数を `consumeEmbeddingCalls` で数える。まとめて埋め込む関数（`generateEmbeddingsBatch`）は使っていなかったので消した（#598）。作り直すときは件数分を数え、1件ずつ `prepareLeadText` と同じ上限で切る
  - OpenAI の client（`embeddings/openai.ts`）は、Claude の client（`client.ts`）と同じくタイムアウト20秒・再試行なしにする。SDK の既定（再試行2回・タイムアウト10分）のままだと、数えた1件に対して OpenAI に最大3回送り、Vercel の関数の30秒も超える（読み取り専用のレビューの指摘、#576）
  - 断るときの文言は、Claude が「AI の利用の上限…」、埋め込みが「AI 検索・埋め込みの利用の上限…」（`ai.updateEmbedding` も同じ枠で断られるため）
  - `ai.findSimilar` は保存済みの埋め込みを pgvector で比べるだけで OpenAI を呼ばないので、数えない。OpenAI を呼ぶように変えるときは `consumeEmbeddingCalls` を足す
  - `/api/chat`（`app/api/chat/route.ts`）も対象外で、#432 で消すまでの扱い。ログインだけで組織を確かめず、回数も数えない。いまは `ai` 4.x が temperature 0 を送り、Claude Sonnet 5.5 に断られて動かない。`ai` を上げる前に消すか、同じ回数制限と `leadForClaude` 相当の上限を付ける
