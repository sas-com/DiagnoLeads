---
id: 2026-10-25-ai-no-personal-data
date: 2026-10-25
category: Security
title: "外部の AI（Claude・OpenAI）に、リードの個人を指す項目を送らない（#406）"
status: active
superseded_by: []
issues: [406, 47]
paths: ["lib/features/ai/prompt-input.ts", "lib/features/ai/embeddings/openai.ts", "lib/features/ai/scoring/claude.ts", "lib/features/ai/prediction/conversion.ts", "lib/features/ai/chat/assistant.ts"]
---

### [Security] 外部の AI（Claude・OpenAI）に、リードの個人を指す項目を送らない（#406）
- **日付**: 2026-10-25（オーナー判断）
- **決定**:
  - Claude（スコア・予測・要約）にも OpenAI（埋め込み）にも、氏名・メールアドレス・電話番号（あるかどうかも含む）・notes（自由記述）を送らない
  - Claude に渡すのは、`leadForClaude` が返す `LeadForClaude` の項目だけ（会社名・状況・流入元・スコア・作成日時・診断の回答）。型に個人を指す項目がないので、プロンプトにあとから足せない
  - 埋め込みの `prepareLeadText` は、会社名・業種・役職だけを使う
  - 予測の代わりの値（Claude が失敗したときの計算）は、アプリの中で氏名・電話番号があるかを使う。`contactCompleteness` の真偽値だけを別の引数で渡し、プロンプトには入れない
- **理由**:
  - スコア・予測・要約・意味検索に、個人を特定する情報は要らない
  - 外部の AI 事業者に個人情報を渡すと、委託やプライバシーポリシーの扱いが要る（#406）
  - 法務部門の確認より先に、アプリの側で送る量を減らせる
- **却下案**:
  - 氏名とメールアドレスだけを外し、notes を残す（担当者のメモに個人の事情が入りうる）
  - 法務の確認まで変えない
- **ルール**:
  - プロンプトや埋め込みに項目を足すときは、個人を指さないことを確かめる。足すなら `LeadForClaude`（`lib/features/ai/prompt-input.ts`）にも足し、`leadForClaude` で長さを切る
  - 決定 `2026-10-24-ai-call-rate-limits` は、`leadForClaude` が切る項目に `name`・`email` を挙げている。今は渡さないので、切る項目は `company`・`status`・`source` と診断の回答になる
  - 診断の回答（`responses`）は送る。回答に自由記述で個人情報が書かれることはありうる。法務の確認（#406）の結果で見直す
  - 意味検索は、氏名・メールアドレス・メモの言葉では当たらない。保存済みの埋め込みは、次に更新されるまで以前の項目で作られたまま
