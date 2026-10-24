---
id: 2026-10-25-invite-email-verification
date: 2026-10-25
category: Security
title: "招待の承認にだけメール確認を求め、確認リンクは登録したブラウザでだけ有効にする（#501・#128）"
status: active
superseded_by: []
issues: [501, 128]
paths: ["lib/features/members/invitations.ts", "lib/auth/verify-email-guard.ts", "components/features/members/invite-acceptance.tsx"]
---

### [Security] 招待の承認にだけメール確認を求め、確認リンクは登録したブラウザでだけ有効にする（#501・#128）
- **日付**: 2026-10-24 に実装（PR #518）、2026-10-25 に記録。確認リンクの方式は、2026-10-24 のオーナー判断（案 A）
- **決定**:
  - 確認済みのメールアドレスを求めるのは、**招待の承認のときだけ**。ログインには求めない（`requireEmailVerification` は false のまま）。
  - 設定 `INVITE_REQUIRE_VERIFIED_EMAIL`（`true` / `false`）でオン・オフする。初期値はオフで、自社ドメインの送信元（#128）ができてからオンにする。
  - 確認リンクは、**登録したブラウザで、そのアカウントでログインしたまま開いたときだけ**有効にする。
- **理由**:
  - 招待リンクを持っているだけで、招待先のアドレスで登録して組織に入れる。この穴をふさぐため（[2026-10-16-invite-only-signup](./2026-10-16-invite-only-signup.md) の「既知の限界」）。
  - ログインにまで求めると、既存のユーザー（`users.email_verified` の既定は false）と E2E のシードが締め出される。
  - better-auth の確認リンクは、開いた人が誰かを見ずにアカウントを確認済みにする。漏れた招待リンクで登録した人が、本物の持ち主に確認メールを開かせれば、確認済みにできてしまう（PR #518 のセキュリティレビュー）。
- **ルール**:
  - **承認の判定**
    - 承認の判定はサーバーで、DB の `users.email_verified` を読む。セッションのクッキーは最大5分古いので使わない。
    - 確認が済んでいなければ `email_not_verified`（tRPC の `PRECONDITION_FAILED`）を返す。招待は `pending` のまま残す。
  - **確認リンクを開いたとき**
    - 確認リンクの判定は better-auth の `hooks.before`（`/verify-email`）で行う。トークンのアドレスと、ログイン中のアカウントのアドレスが同じでなければ断る。
    - 断ったときの戻り先は、招待のページ `/(ja|en)/invite/<token>` に**全体が一致するときだけ**。それ以外は 403。hook は better-auth の戻り先の確認より先に動くので、ゆるい判定だと `/\t/evil.example` のような外部への抜け道になる。
    - アドレスで比べてよいのは、アドレスが一意で変えられない間だけ。`user.changeEmail` を有効にするときは、比べ方を見直す。
  - **送信**
    - 確認メールの送信（`/api/auth/send-verification-email`）は1分3回まで。
    - テストモードでは、`sendEmail` が社外のアドレスを除く。
- **前の決定から変えたところ**: [2026-10-16-invite-only-signup](./2026-10-16-invite-only-signup.md) の「既知の限界」（招待リンクを持っていれば参加できる）は、この設定をオンにすると解消する。新規登録を招待制にすることなど、その他のルールは変えない。
- **オンにする手順**（#128）:
  1. DNS の反映
  2. Resend の確認
  3. `EMAIL_FROM` の切り替え
  4. 社内宛ての試験送信
  5. Vercel Production に `INVITE_REQUIRE_VERIFIED_EMAIL=true` を入れて再デプロイ
- **却下案**:
  - ログインにも確認を求める（`requireEmailVerification: true`）：既存のユーザーとシードが締め出され、移行の手当てが要る。
  - 招待からの登録はパスワードを決めずに始め、メールのリンクを開いてからパスワードを決める（案 B）：より強いが、登録の流れの作り直しになる。
  - better-auth の `autoSignInAfterVerification`：リンクを開いた人を、トークンのアカウントでログインさせる。確認リンクが漏れると、そのアカウントに他人が入れてしまう。また、開いた人を確かめない点はそのまま残る。
- **見直す条件**: 社外提供を決めたとき（新規登録そのものにメール確認を求めるか決める）。`user.changeEmail` を有効にするとき。
