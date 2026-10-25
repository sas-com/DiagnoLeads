---
id: 2026-10-24-session-cookie-cache-off
date: 2026-10-24
category: Security
title: "セッションをクッキーにキャッシュしない（cookieCache を切る。#578）"
status: active
superseded_by: []
issues: [578, 529, 647]
paths: ["lib/auth/config.ts"]
---

### [Security] セッションをクッキーにキャッシュしない（cookieCache を切る。#578）
- **日付**: 2026-10-24
- **決定**: better-auth の `session.cookieCache` を `{ enabled: false }` にする（`lib/auth/config.ts`）。セッションを読むたび（画面の `get-session`、tRPC の `createContext`、REST v2）に DB を引く。オーナーが #578 の案 A を選んだ
- **理由**: キャッシュを有効にしていると、署名つきの `session_data` クッキーが期限内（5分）なら、better-auth は DB を見ずにセッションを返す。`session_token` と `session_data` を写されると、本人がサインアウトしても、パスワードの再設定（#529）やアカウントの削除で DB のセッションが消えても、最大5分は画面も tRPC も使えた。切れば、取り消しは次の要求から効く。security-specialist の見立てでは、案 B（60秒）・C（tRPC だけ DB を読む）と費用はほぼ同じで、A だけがどの入口でも何もしなくても安全な側になる（#578 のコメント）
- **費用**: ログイン中の要求1件ごとに SELECT が2本（`sessions` を `token` の UNIQUE 索引で、`users` を主キーで）。手元の PostgreSQL のログで確かめた。対象は管理ユーザーだけで、セッションのクッキーを持たない要求（診断の回答者など）は DB を読まない
- **却下案**: B：`maxAge` を60秒にする（費用は A とほぼ同じで、60秒残る）。C：取り消しが要る経路だけ `disableCookieCache: true` で読む（画面の `get-session` は5分残る。新しい入口でフラグを付け忘れると穴が戻る）。D：5分を受け入れる（止めたつもりのセッションが5分残る）
- **ルール**:
  - `cookieCache` を有効に戻さない。戻すときはこの決定を見直す。`test/unit/integration/session-revocation.db.test.ts` は、写したクッキー（応答が付けたすべて）でサインアウトとセッションの削除のあとに `get-session`・tRPC の context・保護された手続きがセッションなしになることを確かめていて、キャッシュを戻すと落ちる
  - `disableCookieCache: true` を付けた読み込み（招待の承認の画面、`/verify-email` の前の確認）は、キャッシュを戻したときの備えとして残す
  - 組織の権限（メンバーの除外・ロールの変更）は、もともと毎回 DB から読むので、この決定とは関係なくすぐ効く
- **見直す条件**: ログイン中の要求が増えて tRPC の応答が遅くなったとき。案 C か、better-auth の `secondaryStorage`（Redis などにセッションを置く）を検討する
  - 基準：tRPC の関数（Route `/api/trpc/[trpc]`）の実行時間の p95 が、`openspec/specs/architecture.md` の目標（API の応答の p95 200ms 未満）を超えたとき。Vercel の Observability の Query で、Function Invocations の Duration (ms) を P95 で集計して見る
  - Query には Pro の Observability Plus が要り、いまの Hobby（#547）では関数の実行時間を見られない。そのため、デプロイの前の値は取っていない。Hobby のあいだは、DB の負荷を Supabase の Query Performance（`pg_stat_statements`）で見る。`sessions` を `token` で引く SELECT と `users` を `id` で引く SELECT の呼び出し回数と合計時間を、デプロイの後に1回 #578 に書き、比べる元にする
- **既知の限界**: クッキーの窃取そのものはアプリでは防げない（HttpOnly・Secure・HSTS preload・nonce の CSP で XSS と盗聴は塞いでいる）。端末の侵害や拡張機能で写されたクッキーは、本人がその端末でサインアウトするか、パスワードを再設定する（#529）か、アカウントを消すまで使える。使われ続けると、セッションの期限（7日）は `updateAge`（1日）ごとに延びるので、期限切れでは止まらない。ほかの端末をまとめて切る手段や、延長しない期限を設けるかは #647 で決める。管理ユーザーの端末のマルウェア対策と拡張機能の管理が主な守り（誰が担うかも #647）
