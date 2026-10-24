---
id: 2026-10-18-vercel-web-analytics
date: 2026-10-18
category: Analytics
title: "Vercel Web Analytics を入れる（#222）"
status: active
superseded_by: []
issues: [222]
paths: ["app/[locale]/layout.tsx", "proxy.ts"]
---

### [Analytics] Vercel Web Analytics を入れる（#222）
- **日付**: 2026-10-18
- **決定**: `@vercel/analytics`（2.0.1 に固定）を入れ、`app/[locale]/layout.tsx` に `<Analytics />` を置く。公開ページ・AX サイト・管理画面のすべてが対象（クッキーを使わない計測）
- **ルール**:
  - CSP は変えない（スクリプトと送信先は同じオリジンの `/_vercel/insights`。nonce 付きのスクリプトが追加するので `strict-dynamic` で許可される）
  - middleware の対象から `/_vercel` を外す（外さないと言語のパスへのリダイレクトがかかる）
  - AX サイトの GA4（`lib/analytics/ga.ts`）はそのまま併用する
