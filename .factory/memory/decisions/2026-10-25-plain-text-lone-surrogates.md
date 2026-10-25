---
id: 2026-10-25-plain-text-lone-surrogates
date: 2026-10-25
category: Security
title: "1行の文字列（PLAIN_TEXT）は単独のサロゲートも拒む。行と段落の区切り文字は通す（#747）"
status: active
superseded_by: []
issues: [747, 546]
paths: ["lib/utils/plain-text.ts"]
---

### [Security] 1行の文字列（PLAIN_TEXT）は単独のサロゲートも拒む。行と段落の区切り文字は通す（#747）
- **日付**: 2026-10-25
- **経緯**: PR #681（#546）の読み取り専用のレビューで「U+2028・U+2029 と単独のサロゲートも拒むか」が判断の要る点として出た。オーナーが「このスレッドで片付ける」とし、確かめた結果から Claude が決めた
- **確かめたこと**:
  - Chromium では、U+2028・U+2029 は改行にならず、1行のまま空白ほどの幅で表示される（`white-space` が normal・nowrap・pre-wrap のどれでも同じ）。コピーした文字（innerText）でも空白になる
  - CSV の書き出し（`lib/features/leads/export.ts`）は、RFC 4180 の行の区切り（CR・LF）だけを見る。U+2028 では行が分かれない
  - メールは `lib/email/templates/render.ts` で空白に置き換え、AI に渡す文は `lib/features/ai/prompt-safety.ts` が行の終わりとして扱っている
  - 単独のサロゲートは、text の列には U+FFFD（置換文字）として入る。しかし jsonb の列では、PostgreSQL が `Unicode low surrogate must follow a high surrogate` で拒み、書き込みが失敗する（PostgreSQL 16 で確かめた）。PLAIN_TEXT の値が jsonb に入る経路として、Webhook の送信記録の payload（会社名・氏名）と、代理店の契約の `appointment_criteria` がある
- **決定**:
  - `PLAIN_TEXT` に `\p{Cs}` を足し、単独のサロゲートを拒む。対になったサロゲート（絵文字など）は1つの文字なので通る
  - U+2028・U+2029 は通す（表示が崩れず、拒む理由がない）
- **理由**: 公開フォームで単独のサロゲートを受け付けると、リードは保存できても、Webhook の送信記録が書けずに通知が失われる。入口で 400 にすれば、何も保存されず、理由も分かる
- **却下案**:
  - どちらも通すまま：上の書き込みの失敗が残る
  - U+2028・U+2029 も拒む：表示が崩れないので、正しい入力（ほかのアプリから貼り付けた文字）まで断ることになる
- **ルール**:
  - 守るのは PLAIN_TEXT を使う1行の項目だけ。同じ公開フォームでも、トラッキング（UTM・ref・agency。UTF-16 の単位で切り詰めるので、絵文字の上位サロゲートだけが残りうる）と、自由記述の回答（長さだけを確かめる）は jsonb に入るので、同じ失敗が残っている。そちらは #754 で扱う
  - 改行とタブを許すメモ用の規則（prospects の `NO_CONTROL`）は、この決定の範囲外。jsonb に入るなら同じことが起きるので、見直すときは別の Issue にする（meeting-requests の `NOTE_TEXT` はすでに `\p{Cs}` を拒んでいる）
