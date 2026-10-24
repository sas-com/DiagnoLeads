---
id: 2026-10-24-send-email-in-lib
date: 2026-10-24
category: Email
title: "メールの送信の実装を lib/email/send.ts に置き、機能からの入口 @/lib/features/email は残す（#477）"
status: active
superseded_by: []
issues: [450, 477]
paths: ["lib/email/**", "lib/features/email/index.ts", "lib/features/email/email-service.ts", "lib/auth/email-helpers.ts", "lib/ops/alert.ts"]
---

### [Email] メールの送信の実装を lib/email/send.ts に置き、機能からの入口 @/lib/features/email は残す（#477）
- **日付**: 2026-10-24
- **経緯**: #450 の質問に、オーナーが「推奨どおりで進めてください」と答えた。#477 の「やること」（本案）を採り、「代案」を採らない
- **決定**: `lib/features/email/email-service.ts` の中身（`sendEmail`・`isEmailConfigured`・`EmailProviderError`・`EMAIL_SEND_TIMEOUT_MS`・`SendEmailOptions`）を `lib/email/send.ts` に移す。`@/lib/features/email`（index.ts）は今と同じ名前で再 export し、機能から送るときの入口は変えない。`email-service.ts` は `lib/email/send` の再 export として残すか、それを直接読んでいる3本（app の結果メールのルート2本・`lib/features/respondent-email/send.ts`）とテストの import・`vi.mock` を同じ PR で替える
  - 決定 2026-10-22-email-templates を補う。送信の関数が1つであることと、宛先の制限（`filterAllowedRecipients`、テストモード）が送信の関数の中にあることは変えない。「`@/lib/features/email` の `sendEmail` で送る」は機能からの送信に限り、基盤（`lib/` の features 以外）は `@/lib/email/send` を読む
- **理由**: 基盤から `lib/features/email` への逆向きの import が2本ある（`lib/auth/email-helpers.ts`・`lib/ops/alert.ts`。基盤 → 機能は全体で8本あり、`alert.ts` → `diagnostics/rate-limit` は #471 で直す）。ワークフローのランナー（#298〜#301）は `lib/workflow/` に置いて機能のモジュールを import せず、失敗や滞留は `lib/ops/alert` の `reportServerError` で知らせる（#300・#301）。`alert.ts` が `lib/features/email` を読んだままだと、ランナーが間接に機能へ依存する（arch:check は直接の import しか見ないので、検出されない）
- **却下案**: 今のまま残し、#514 の許可リスト（`scripts/architecture/allowlist.txt`）の2行を恒久的な例外にする（基盤が機能に依存する形が残る）
- **ルール**:
  - 基盤からメールを送るとき、送れるかを確かめるときは `@/lib/email/send` を読む。機能からは今までどおり `@/lib/features/email`
  - 移す PR で替える `vi.mock('@/lib/features/email')`：`test/unit/lib/auth/email-helpers.test.ts`・`test/unit/lib/auth/auth-email-background.test.ts`・`test/unit/lib/ops/alert.test.ts`。lib/auth を触るので、読み取り専用のレビューを通す
  - 移す PR で、決定 2026-10-16-test-mode の送信処理の置き場所の記述と `paths` も直し、この決定の `paths` の `email-service.ts` を `lib/email/send.ts` の側に寄せる
  - `lib/features/email/index.ts` は、#514 の許可リストの `feature-index-files` に負債として残る（入口として使い続けるため）
  - 時期：#514 と #471 の後。RLS の作業中（11/4〜11/14）は行わない（`email-helpers.ts` が RLS の範囲）。#300 の着手より前
