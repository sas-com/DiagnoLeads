---
id: 2026-11-07-webhook-personal-data-scope
date: 2026-11-07
category: Security
title: "Webhook の個人情報の確認を diagnostic.submitted にも広げ、URL を変えたら再送待ちを取りやめる（#917・PR #927）"
status: active
superseded_by: []
issues: [917]
paths: ["lib/features/webhooks/types/personal-data.ts", "lib/features/webhooks/services/webhook-service.ts"]
---

### [Security] Webhook の個人情報の確認の範囲（2026-11-05-lead-webhook-personal-data への追記）

- **日付**: 2026-11-07（オーナーの判断。PR #927 のセキュリティレビューを受けて）
- **変えたところ**: 決定 `2026-11-05-lead-webhook-personal-data` の「2. 設定時の確認」の範囲。ほかの項目はそのまま
- **決定**:
  1. **確認の対象**: lead.* に限らず、リードの個人情報を送るイベントすべてを対象にする。今は lead.created・lead.updated・lead.status_changed・lead.scored と、diagnostic.submitted（回答者のメール・氏名・会社名・スコア・関心度の判定を送る）。lead.deleted は ID と日時だけなので対象外
  2. **URL を変えたとき**: その Webhook の再送待ちの配信は、新しい URL へ送らずに失敗にする（`cancelPendingDeliveries`）。再送待ちの送信内容は元の URL のために作られ、新しい URL への送信は誰も確認していないため。保存したヘッダーの値を新しい URL へ持ち越さない（#314）のと同じ考え方
- **理由**: diagnostic.submitted だけを選べば、確認なしで同じ個人情報を送れた。「顧客が確認したことを示せる」という元の決定の目的が成り立たない
- **却下案**:
  - diagnostic.submitted を別の Issue にする：それまで確認をすり抜ける経路が残る
  - 再送待ちの扱いを #918 でまとめて直す：#918 は配信後の消去で、送信先が変わる問題とは別
  - URL を変えるとき、再送待ちに個人情報があれば確認を求める：確認しても、元の URL のために作った送信内容を別の URL へ送ることになる
- **ルール**:
  - 個人情報を送るイベントを足すときは、`PERSONAL_DATA_EVENTS`（`lib/features/webhooks/types/personal-data.ts`）に入れ、設定画面とヘルプの説明も合わせる
