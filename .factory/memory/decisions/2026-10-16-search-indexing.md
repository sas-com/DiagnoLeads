---
id: 2026-10-16-search-indexing
date: 2026-10-16
category: SEO
title: "検索エンジンに載せるページ（#51）"
status: active
superseded_by: []
issues: [51]
paths: ["lib/seo/**", "app/robots.ts", "app/sitemap.ts"]
---

### [SEO] 検索エンジンに載せるページ（#51）
- **日付**: 2026-10-16
- **決定**: テストモード中（`APP_TEST_MODE=true`）はどのページも検索に載せない（noindex、サイトマップは空）。一般公開後に載せるのは AX の紹介ページ（`/ja/ax-migration`）と診断（`/ja/ax-diagnosis`）だけ。管理画面・ログイン・新規登録・招待・汎用 SaaS のページ（トップ・landing など）は常に載せない。判定は `lib/seo/indexing.ts` にまとめる
- **理由**: テスト中のページが検索結果に出ると、社外の人が診断しようとして断られる。集客したいのは AX 移行診断で、汎用 SaaS のページは新規登録が招待制のため使い始められない（オーナー判断）
- **ルール**: 新しいページは既定で noindex（`[locale]/layout` と `(public)/layout` が NOINDEX）。載せるページを増やすときは `INDEXABLE_PATHS` に足し、この記録を更新する。テストモードを外すこと＝一般公開なので、その前に広報の掲載承認を取る
