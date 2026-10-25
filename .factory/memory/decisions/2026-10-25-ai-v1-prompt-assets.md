---
id: 2026-10-25-ai-v1-prompt-assets
date: 2026-10-25
category: Architecture
title: "v1 の AI プロンプト資産の残り：リード分析のテンプレートは移さず、モデル ID は client.ts に置き、トークン使用量は応答ごとにログに1行出す（#47）"
status: active
superseded_by: []
issues: [47, 48, 712]
paths: ["lib/features/ai/usage.ts", "lib/features/ai/client.ts", "lib/features/ai/scoring/*.ts", "lib/features/ai/prediction/*.ts", "lib/features/ai/chat/*.ts", "lib/features/ai/embeddings/openai.ts", "lib/features/ai/api/router.ts", "lib/features/ai/search/semantic.ts"]
---

### [Architecture] v1 の AI プロンプト資産の残り：リード分析のテンプレートは移さず、モデル ID は client.ts に置き、トークン使用量は応答ごとにログに1行出す（#47）
- **日付**: 2026-10-25（1 と 3 はオーナーの判断。#47 のコメント「オーナーの判断（2026-10-25・3回目）」。2 は #449（PR #532）で決まった形の記録で、オーナーはこの判断ではモデル ID について「#449 で扱う」とだけ述べた）
- **前提**: #47 は v1 の AI プロンプト資産の移植。入力チェック（`prompt_sanitizer`）は PR #691・#703 で移し（決定 `2026-10-25-ai-prompt-injection`）、`retry_helper` は移さないと決め（同じ決定）、`json_extractor` は PR #443 の構造化出力で要らなくなった。この決定は残りの3つ（リード分析のテンプレート・モデル ID・トークン使用量）を決める。段階2（業種テンプレートと生成・言い換えのプロンプト）は #712 に分けた
- **決定**:
  1. **リード分析のテンプレートは移さない**
     - 対象：v1 の [lead_analysis_templates.py](https://github.com/yusuke-kurosawa/DiagnoLeads-v1-legacy/blob/32b4add6cb0c28a1983af7ceb6f63b5f761013fa/backend/app/services/ai/lead_analysis_templates.py)（5業種のシグナルと判定基準、点数の4つの帯 80〜100・60〜79・40〜59・0〜39 ごとの推奨アクション、トークポイントのテーマ）と、[prompt_templates.py](https://github.com/yusuke-kurosawa/DiagnoLeads-v1-legacy/blob/32b4add6cb0c28a1983af7ceb6f63b5f761013fa/backend/app/services/ai/prompt_templates.py) のうち分析のプロンプト（`build_lead_analysis_prompt`）
     - AX 向けの分析のプロンプトは、#48 で AI 分析を作るときに設計する。材料は、営業の手引き（ax-playbook）・MQL段階・診断の回答
  2. **モデル ID は `lib/features/ai/client.ts` の `CLAUDE_MODEL` に置く**（#449・PR #532 で決まった形の記録）。client・`max_tokens` と同じ1か所で、Claude を呼ぶコードはすべてこれを使う。提供終了の前に替えるルールは決定 `2026-10-24-ai-calls-via-anthropic-sdk`
  3. **トークン使用量は、AI の応答ごとに構造化ログを1行出す**（`lib/features/ai/usage.ts` の `logAiUsage`）
     - 中身：`event: "ai.usage"`、処理の名前（`operation`：`score-lead`・`predict-conversion`・`lead-summary`・`embed-search-query`・`embed-lead`）、組織（`organizationId`）、モデル（応答のモデル ID。なければ頼んだモデル）、入力と出力のトークン数（`inputTokens`・`outputTokens`）、SDK が返したときだけプロンプトキャッシュの読み出し・書き込みのトークン数（`cacheReadInputTokens`・`cacheCreationInputTokens`）、所要時間（`durationMs`）。`console.info` に JSON の1行で出す
     - 対象：Claude を呼ぶ3か所（スコア・成約の予測・要約。一括のスコアと予測はリードごとに1行）と、OpenAI の埋め込み（検索の文とリードの文）。埋め込みの出力のトークンは 0
     - 個人情報とリードの中身は入れない：リードの ID・氏名・メールアドレス・電話番号・メモ・会社名・プロンプトや答えの文を入れない（決定 `2026-10-25-ai-no-personal-data`）
     - 応答が届いたときだけ出す。応答が届かなかった呼び出し（タイムアウト・接続のエラー・API のエラー）は、これまでどおり `reportClaudeFailure`（`lib/features/ai/failures.ts`）とエラーのログに任せる
     - 届いたのに構造化出力が使えない応答（JSON の途中で `max_tokens` に達した・断った・思考の途中で止まった）も、課金されるので出す。そのため、スコアと成約の予測は `messages.parse` ではなく `messages.create` で受け取り、`logAiUsage` を呼んでから `readStructuredOutput`（`lib/features/ai/client.ts`）で最初の text ブロックを解析する。`messages.parse` は SDK の中で JSON を解析し、失敗すると reject するので、行を出す前に止まる（`@anthropic-ai/sdk` 1.3.0 の `lib/parser.js`。security-specialist のレビューで分かった）。解析の失敗は、これまでどおり catch に落ちて代わりの値になる
     - 表は作らない（マイグレーションも要らない）。月の合計は、Claude は Anthropic のコンソール、埋め込みは OpenAI のダッシュボードで見る
- **理由**:
  - 1：v1 の5業種（IT/SaaS・コンサルティング・製造業・EC/小売・マーケティング）は汎用の業種で、v2 の対象（Access などのレガシー基幹システムの AX 移行）に合わない。点数の帯ごとに推奨アクションを決める形は、決定 `2026-10-24-mql-level-over-score`（見込みは MQL段階で表し、点数は根拠として出すだけ）と食い違う。移しても、AX のリードでは当てはまる業種がなく、推奨アクションは MQL段階と別の基準になる
  - 3：v1 は [ai_service.py](https://github.com/yusuke-kurosawa/DiagnoLeads-v1-legacy/blob/32b4add6cb0c28a1983af7ceb6f63b5f761013fa/backend/app/services/ai_service.py) の `_log_token_usage` で、ログの1行に加えて表 `ai_usage_logs`（テナント・ユーザー・リードの ID・費用）に書いていた。v2 では、どの処理と組織がどれだけ使っているかがログで分かれば足り、月の合計はコンソールにある。表にすると、マイグレーションと保存期間の扱いが要り、リードの ID は個人を指しうる
- **却下案**:
  - `lead_analysis_templates` を移し、業種を AX 向けに書き換える：AX 向けの分析は、業種ではなく手引き・MQL段階・回答から組み立てる。#48 で設計するほうが二度手間にならない
  - 使用量を表に保存する（v1 の `ai_usage_logs`）：上の理由
  - モデル ID を環境変数にする（この決定を書いた側の理由で、オーナーが却下したものではない）：替えるときにコードの確認（提供終了・パラメータの互換）が要るので、コードの1か所にしておく
- **ルール**:
  - Claude と OpenAI を呼ぶ関数を足すときは、応答を受け取った直後に `logAiUsage` を呼ぶ（呼び出しの直前に取った `performance.now()` を `startedAt` に渡す）。`operation` を `AiOperation` に足し、組織は呼び出し元（ルーター）から `AiCallScope` で受け取る。#48 の AI 分析と #712 の生成・言い換えも同じ
  - 構造化出力を受け取る呼び出しは `messages.parse` を使わず、`messages.create` に同じ `output_config` を渡し、`logAiUsage` のあとで `readStructuredOutput` に通す（決定 `2026-10-24-ai-calls-via-anthropic-sdk` の構造化出力の受け取り方を、こう細かくした）。出力が長く切れやすい #48 の分析と #712 の生成も同じ
  - 使用量のログに項目を足すときは、数と名前だけにする。リードの ID・プロンプト・答えの文・個人を指す項目を入れない。`logAiUsage` は例外を投げず、呼び出しの結果を変えない形を保つ
  - 失敗の扱い（`reportClaudeFailure`・代わりの値）は使用量のログと分けたままにする
- **確かめた公式ドキュメント**（2026-10-25）:
  - https://platform.claude.com/docs/en/build-with-claude/prompt-caching （`input_tokens` はキャッシュの読み出しと書き込みを除いた分で、合計は `cache_read_input_tokens + cache_creation_input_tokens + input_tokens`）
  - https://platform.claude.com/docs/en/build-with-claude/extended-thinking （思考のトークンは課金される出力のトークンに入り、`usage.output_tokens_details.thinking_tokens` がその内訳）
  - https://developers.openai.com/api/reference/resources/embeddings/methods/create （埋め込みの応答の `model` と `usage.prompt_tokens`・`usage.total_tokens`）
  - https://platform.claude.com/docs/en/build-with-claude/structured-outputs （JSON は応答の text ブロックに入る。`stop_reason` が `refusal` と `max_tokens` の応答は課金され、スキーマに合わないことがある）
