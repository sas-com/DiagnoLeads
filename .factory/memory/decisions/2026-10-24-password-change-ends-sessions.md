---
id: 2026-10-24-password-change-ends-sessions
date: 2026-10-24
category: Security
title: "パスワードを変えたら、ほかのブラウザのログインを切る。選ばせない（#591・#529）"
status: active
superseded_by: []
issues: [591, 529]
paths: ["app/[locale]/(dashboard)/settings/page.tsx", "lib/auth/config.ts"]
---

### [Security] パスワードを変えたら、ほかのブラウザのログインを切る。選ばせない（#591・#529）
- **日付**: 2026-10-24
- **決定**:
  - 設定画面でパスワードを変えたら、常にそのユーザーのほかのセッションを切る（`/change-password` に `revokeOtherSessions: true`）。変えたブラウザは、新しいセッションでログインしたまま。切るかどうかをチェックボックスで選ばせない（オーナーの判断、#591）
  - メールのリンクでの再設定は、再設定したブラウザも含めて全セッションを切る（`emailAndPassword.revokeSessionsOnPasswordReset: true`、#529）。#591 は同じ考え方を、ログイン中の変更にも当てたもの
- **理由**: パスワードが漏れたと気づいた人は、再設定ではなく、ログインしたまま設定画面で変えることが多い。そこで切らないと、すでにログインしている他人を追い出せない。選ばせる形にすると、切らない側を選んだ人には効かない
- **却下案**:
  - チェックボックスで選ばせる（切らない選択が残る）
  - 変更では切らない（#591 までの形。#591 の問題そのもの）
- **ルール**:
  - 変更は `authClient.changePassword` で送る。`authClient.$fetch('/change-password')` だと、better-auth のクライアントがセッションを読み直さず、画面が消えた古いセッションを持ったままになる（better-auth 1.6.33 の `client/config.mjs` の atomListeners）
  - 現在のパスワードが違うことは、エラーの `code`（`INVALID_PASSWORD`）で見分ける。`message` の部分一致（'invalid' など）にしない。better-auth はほかの失敗（信頼していない Origin の `INVALID_ORIGIN`「Invalid origin」など）でも 'invalid' を含む文を返すので、原因を取り違える（PR #601 のレビュー）
  - 切られたブラウザは、次の要求からログインしていない扱いになる。`session.cookieCache` は #578 で切った（決定 `2026-10-24-session-cookie-cache-off`）ので、session_data クッキーで残る時間はない
  - 確かめるテスト：実 DB の `test/unit/integration/password-change-sessions.db.test.ts`（変更）と `password-reset-sessions.db.test.ts`（再設定）、画面の `test/unit/components/settings/password-change.test.tsx`
