---
id: 2026-10-25-session-absolute-expiry
date: 2026-10-25
category: Security
title: "セッションはログインから7日で切り、使っていても延ばさない。設定画面で、ほかの端末をまとめてログアウトできるようにする（#647）"
status: active
superseded_by: []
issues: [647, 599, 578, 697]
paths: ["lib/auth/config.ts", "components/features/account/sign-out-other-devices-card.tsx", "app/[locale]/(dashboard)/settings/page.tsx"]
---

### [Security] セッションはログインから7日で切り、使っていても延ばさない。設定画面で、ほかの端末をまとめてログアウトできるようにする（#647）
- **日付**: 2026-10-25
- **決定**（オーナーの判断。#647 の案 A と B の両方）:
  - B：`lib/auth/config.ts` の `session.disableSessionRefresh` を `true` にする。セッションはログインした時から `expiresIn`（7日）で切れ、使っていても延びない
  - A：個人設定（`/settings`）に「ほかの端末からログアウト」を置く（`components/features/account/sign-out-other-devices-card.tsx`）。確認のダイアログのあとで `authClient.revokeOtherSessions()`（`POST /api/auth/revoke-other-sessions`）を呼ぶ。このブラウザのセッションは行もクッキーもそのまま残り、ログインしたまま
  - あわせて、パスワードの変更の完了メッセージで、ほかの端末ではログアウトしたことを伝える（#599。変更は #591 から常にほかのセッションを切る。決定 `2026-10-24-password-change-ends-sessions`）
- **理由**: better-auth 1.6.33 は、セッションを読んだときに前の更新から `updateAge`（1日）を過ぎていれば、期限を「いま＋7日」に延ばす（`api/routes/session.mjs` の `shouldBeUpdated`）。写された `session_token` のクッキーを1日に1回以上使い続けると期限切れでは止まらず、止めるきっかけは本人の操作（その端末でのログアウト・パスワードの再設定か変更・アカウントの削除）しかなかった。B で使える期間を最長7日に区切り、A で本人が気づいたときにパスワードを変えなくても止められるようにする
- **`disableSessionRefresh` がすること**（1.6.33 のコードと実 DB のテストで確かめた）:
  - セッションを読む処理（画面の `get-session`、tRPC の context と REST v2 の `auth.api.getSession`）が、期限の延長（`expires_at` と `updated_at` の書き換え）と、`session_token` のクッキーの付け直しをしなくなる。`updateAge` は使われなくなる（値は残している）
  - `expires_at` は、セッションを作った時刻（サインアップ・サインイン・パスワードの変更で作り直したとき）の7日後のまま。`session_token` のクッキーもそのときに `maxAge` 7日で付き、付け直されないので、DB の期限とそろう
  - 期限を過ぎたセッションは、次に読まれたときにログインしていない扱いになり、行も消える
  - `session.cookieCache` は #578 で切っているので、クッキーのキャッシュの延長（`cookieRefreshCache`）も働かない
- **費用**: 管理ユーザーは、使い続けていても7日ごとにログインし直す（オーナーが受け入れた）。7日たつと作業の途中でもログインし直しになる。DB の書き込みは減る（1日1回の UPDATE がなくなる）
- **却下案**:
  - C：いまのまま受け入れる（写されたクッキーが止まらない）
  - A だけ：本人が気づかないと止まらない
  - B だけ：気づいても、パスワードを変えるか、最長7日待つしかない
  - 期限を7日より短くする（1日など）：毎日ログインし直す手間が大きい。#647 では選ばなかった
- **ルール**:
  - `disableSessionRefresh` を外さない。外すときはこの決定を見直す。`test/unit/integration/session-absolute-expiry.db.test.ts` は、`updateAge` を過ぎたセッションを `get-session` と tRPC の context で読んでも `expires_at`・`updated_at` が変わらずクッキーも付け直されないこと、毎日使っても7日で切れることを確かめていて、外すと落ちる（外して3件落ちることを確かめた）
  - `expiresIn` を変えると、ログインが続く長さがそのまま変わる。画面の文言（`settings.profile.otherDevices.expiry`、ja・en）も合わせて直す
  - 「ほかの端末からログアウト」は `authClient.revokeOtherSessions()` で呼ぶ（`$fetch` にしない。クライアントがセッションを読み直さない）。確かめるテストは、実 DB の `test/unit/integration/sign-out-other-devices.db.test.ts` と、画面の `test/unit/components/settings/sign-out-other-devices.test.tsx`
  - 押すときにパスワードは聞かない。better-auth の `/revoke-other-sessions` は画面を足す前から開いていて、入口は増えていない。better-auth はセッションを DB から読み直してから切る（`sensitiveSessionMiddleware`）
- **既知の限界**:
  - 写されたクッキーは、セッションを作ってから7日以内なら使える。それより前に止めるのは、A・パスワードの変更（#591）・再設定（#529）
  - 写したクッキーを持つ人も「ほかの端末からログアウト」を押せ、本人のブラウザをログアウトさせられる。本人がパスワードでログインし直して押せば、その人のセッションは消え、消されたクッキーでは押し返せない（実 DB のテストで確かめた）。パスワードを変えれば確実に止まる
  - ログインしている端末の一覧（better-auth の `listSessions`）は出していない。要るようになったら別の Issue にする
  - 管理ユーザーの端末のマルウェア対策と、ブラウザの拡張機能の管理を誰が担うかは、まだ決まっていない（#697 で決める。#647 から切り出した）
