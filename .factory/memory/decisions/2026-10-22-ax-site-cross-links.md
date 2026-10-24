---
id: 2026-10-22-ax-site-cross-links
date: 2026-10-22
category: Marketing
title: "AX サイトのページのつなぎ方・公開前の準備（#332, #51）"
status: active
superseded_by: []
issues: [332, 51]
paths: ["lib/features/ax-site/cross-links.ts", "components/features/ax-site/**", "app/[locale]/(ax)/**"]
---

### [Marketing] AX サイトのページのつなぎ方・公開前の準備（#332, #51）
- **日付**: 2026-10-22
- **決定（オーナー、決定会議）**:
  - **メイン LP の title・description**: Access を書かない。Access の検索は Access の LP で受ける。これまでの「11月の検索データを見て決める」（2026-10-21 の経路別 LP の決定）はこれで置き換える
  - **スマホのヘッダーメニュー**: 公開前に入れる（lg 未満で、ヘッダーのリンクと同じ項目に、トップ／Access の LP へのリンクを足す）
  - **公開ドメイン**: 10/28 の go/no-go で決める。独自ドメインが間に合わなければ vercel.app で公開し、あとで 301 リダイレクトで移す
  - **GA4・Search Console**: マーケティングが公開前に設定する。測定 ID と Search Console の HTML タグの値は 10/27 までに Claude に渡す
  - **LP のつなぎ方**: メイン LP に来た Access の人は、その場（Access の質問から）で診断してもらい、Access の LP は詳しく読みたい人向けの補助にする。ヒーローには LP をまたぐリンクを置かない。Access の LP には AS/400・ACOS など基幹システムの人向けの欄を置き、メイン LP の該当箇所へつなぐ。結果画面からコラムへの案内は #154 の後に足す
- **ルール**:
  - LP をまたぐリンクは `?from=<ページ>-<置き場所>` を付け、今の URL の utm_*・ref・agency を引き継ぐ（クリック時に付け、href は素のパスのまま）。from は許可した値だけを tracking に保存する（`lib/features/ax-site/cross-links.ts`）
  - 診断の直前には出口になるリンクを置かない（Access の LP の関連コラムは最後の CTA の後）
