---
id: 2026-11-10-leave-signed-out-as-new-page
date: 2026-11-10
category: Security
title: "ログアウトとセッション切れのあとは、ページごと読み直して次の画面を開き、ログイン・登録が通ったら移る前にクエリのキャッシュを捨てる（#1057）"
status: active
superseded_by: []
issues: [1057, 1046, 1015, 1034]
paths: ["lib/auth/leave-signed-out.ts", "lib/context/organization-context.tsx", "components/auth/AdminSessionGuard.tsx", "components/auth/LoginForm.tsx", "components/auth/SignupForm.tsx", "components/header/UserDropdown.tsx", "components/features/account/delete-account-card.tsx", "components/features/members/invite-acceptance.tsx"]
---

### [Security] ログアウトとセッション切れのあとは、ページごと読み直して次の画面を開き、ログイン・登録が通ったら移る前にクエリのキャッシュを捨てる（#1057）
- **日付**: 2026-11-10
- **決定**（#1057、PR #1060。読み取り専用のセキュリティレビューを2回通した）:
  - サインアウトする所（ヘッダーのメニューのログアウト・退会・招待の画面の「ログアウトする」）は、`signOut()` のあと `leaveSignedOut(to, { replace })`（`lib/auth/leave-signed-out.ts`）で移る。localStorage の組織の選択を消し、次の画面をページごと読み直して開く（`window.location`）
  - ログアウトせずにセッションが切れたタブは、`AdminSessionGuard` が `leaveWithoutSession(signInPath(…), { replace: true })` でログインの画面をページごと開く。組織の選択は残す
  - 離れるページは、離れるとき（`pagehide`）に隠し、ブラウザの戻る・進むのキャッシュ（bfcache）から見せ直されたら（`pageshow` の `persisted`）読み直す。行き先は同じサイトのページだけで、フラグメントは外して移る
  - ログイン・登録が通ったら、次の画面へ移る前に `queryClient.clear()` する。移るのは画面の中のまま（トーストはそのまま出る）
  - サインアウトでは文脈の状態（`clearOrganization`）を消さない。`forgetStoredOrganization()`（`lib/context/organization-context.tsx`）で localStorage の選択だけを消し、そのページは選択を保存し直さない
  - 退会したことは、そのタブの sessionStorage の1回きりの印（`noteAccountDeleted` / `takeAccountDeleted`）で、ログインの画面に「アカウントを削除しました」と出す
- **理由**:
  - ブラウザの QueryClient はページの寿命の間1つで、キャッシュのキーに利用者は入らない（`staleTime` 5分・`gcTime` 10分）。組織の選択も localStorage に残る。共用の PC で、同じタブで次にログインした人に、前の人の組織の一覧やリードのキャッシュが、サーバーに聞かずに出ていた
  - 画面の中の移動（`router.push` / `replace`）では、戻るボタンで、前のページがキャッシュのまま描かれる。ページごと読み直せばメモリは捨てられ、戻ってもプロキシがログインの画面へ送る
  - ダッシュボードの上で文脈の状態を消すと、ヘッダーの組織の切り替えの部品が、キャッシュの一覧から先頭の組織を選び直して保存し直す
  - HTML は `no-store` ではないので、離れたページが bfcache に残りうる。先に隠すと、保存していない変更の確認（`beforeunload`）で留まったときに白い画面のまま残るので、離れるときに隠す
  - 同じ URL へフラグメント付きで移ると、ページを読み直さずにフラグメントだけが動く
- **却下案**:
  - ログアウトでも画面の中で移り、`queryClient.clear()` する：表示中の部品が読み直して 401 の表示が一瞬出る。戻るボタンで前のページが描かれる。切り替えの部品が選択を保存し直す
  - ログインのときも組織の選択を消す：セッションが切れて同じ人がログインし直すたびに選択が消える。別の人なら、部品がその人の一覧で選び直し、データはサーバーが所属で守る
  - 退会の知らせを `?accountDeleted=1` で渡す：誰でもそのリンクを送れ、本物のページに出る（詐欺の口実になりうる）
- **ルール**:
  - サインアウトの入口を足すときは、`leaveSignedOut` で移る。サインアウトやセッション切れのあとに、画面の中で移る経路を足さない
  - ログインの入口（別の方式・2段階認証など）を足すときは、通ったあと、移る前に `queryClient.clear()` する
  - `leaveSignedOut` / `leaveWithoutSession` に渡す行き先は、アプリの決まったパスか、今の URL だけにする（ほかのサイトは投げて何もしない）
  - 確かめるテスト：`test/unit/lib/auth/leave-signed-out.test.ts`、`test/unit/lib/context/forget-stored-organization.test.tsx`、各画面のテスト（`user-dropdown`・`personal-settings`・`invite-acceptance`・`AdminSessionGuard`・`LoginForm`・`SignupForm`）
- **既知の限界**:
  - ログアウトせずにセッションが切れ、別の人が同じタブでログインしたとき、組織の一覧を読むまでの間、前の人が選んでいた組織の名前が出ることがある（組織の行のデータだけ。リードなどのキャッシュは捨てる）
  - bfcache から戻ったときの読み直しは、ブラウザの実機では確かめていない（jsdom のテストで確かめた）
  - サインインしたまま外のリンクで離れ、そのあとセッションが切れてから戻ると、ガードがセッションを確かめるまで前の内容が見える
