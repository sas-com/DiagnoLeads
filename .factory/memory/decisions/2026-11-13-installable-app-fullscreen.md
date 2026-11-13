---
id: 2026-11-13-installable-app-fullscreen
date: 2026-11-13
category: UI
title: "DiagnoLeads を、インストールして全画面で使えるアプリにする。マニフェストは管理画面と認証の画面だけに付け、Service Worker は入れない（#1125）"
status: active
superseded_by: []
issues: [1100, 1125]
paths: ["public/manifest.json", "lib/routes/app-install.ts", "components/features/ai-employees/office-app.ts", "app/[locale]/(dashboard)/layout.tsx", "app/[locale]/(auth)/layout.tsx"]
---

### [UI] DiagnoLeads を、インストールして全画面で使えるアプリにする。マニフェストは管理画面と認証の画面だけに付け、Service Worker は入れない（#1125）
- **日付**: 2026-11-13
- **決定**（オーナーの指示。2026-11-13「アプリとして全画面表示して利用してほしいです」）: DiagnoLeads を、アプリとしてインストールして全画面で使えるようにする。アプリは AI社員オフィスの出社の画面から始まる（決定 `2026-11-13-office-is-the-base` の最初の段）
- **決定**（実装）:
  - Web アプリのマニフェストは静的なファイル（`public/manifest.json`）にし、管理画面（`(dashboard)`）と認証（`(auth)`）のレイアウトの metadata からだけ参照する（`lib/routes/app-install.ts`）。`app/manifest.ts` は使わない：全ページに付き、公開の AX サイトが「インストールできる管理アプリ」として出てしまう。`.webmanifest` の拡張子も使わない：言語のリダイレクト（`shouldSkipI18nMiddleware`）が飛ばさず、`/ja/...` に送られて 404 になる
  - 表示は `display: fullscreen`、`display_override` で `standalone` に落とす（パソコンの Chrome・Edge はアプリのウィンドウになり、「出社する」を押すと Fullscreen API で画面いっぱいになる）
  - 開始の URL は `/office?source=app`（言語を付けない。言語のリダイレクトが利用者の言語を選ぶ）。ログインしていなければ、ログインのあとに `callbackUrl` で同じ URL に戻る
  - オフィスの画面は、アプリとして開かれたとき（開始の URL の `source=app`、または `display-mode` が fullscreen・standalone・minimal-ui、iOS の `navigator.standalone`）に、出社の画面を自分で開く（`launchedAsApp`）。ブラウザのタブで開いたときは、今までどおりボタンで開く
  - 「アプリとしてインストール」のボタンは、ブラウザがインストールを申し出たとき（`beforeinstallprompt`。Chromium 系）だけ出す。Safari・Firefox はブラウザのメニューから入れるので、ヘルプの記事に書いた
  - Service Worker は入れない：オフラインは要らず、ログイン後のデータをキャッシュする危険を作らない。Chrome は Service Worker が無くてもインストールできる（手元の Chromium の `Page.getInstallabilityErrors` が空であることを確かめた）
  - アイコンは今のロゴの印（`app/icon.svg`）から作った（`public/images/app/`、iOS 用は `app/apple-icon.png`）。ロゴの色を変えるときは、作り直す
- **却下案**:
  - ログインのあとの行き先をオフィスに変える：認証の流れに触るので、セキュリティのレビューを通してから別に決める
  - `orientation: landscape` を付ける：アプリの中の通常の表示（管理画面）まで横向きに固定される
- **まだやっていないこと**: 1280px 未満の画面（スマホ）の出社の画面のレイアウト。スマホにインストールすると、今は窮屈に見える
- **確かめた公式の手引き**: Next.js 16 の `node_modules/next/dist/docs/01-app/02-guides/progressive-web-apps.md`、`03-api-reference/03-file-conventions/01-metadata/manifest.md`、`04-functions/generate-metadata.md`（`manifest`・`appleWebApp`）
- **狭い幅の扱い**（オーナーの判断 2026-11-13。`ui-ux-specialist` のレビューのあとの確認に「推奨どおり」。#1139）: 出社の画面は幅の広い画面向けなので、768px 未満（`OFFICE_MIN_WIDTH`）では、アプリとして開いても自動では出社の画面を開かず、タイトルで「通常の表示に戻る」を先に出す（「出社する」は残す）。狭い幅のための専用の画面は、計画の段 6 で作る
