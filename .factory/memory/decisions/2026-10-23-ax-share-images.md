---
id: 2026-10-23-ax-share-images
date: 2026-10-23
category: Marketing
title: "SNS 用の画像・コラム一覧・公開日の確認（#344, #347, #348）"
status: active
superseded_by: []
issues: [344, 347, 348]
paths: ["lib/features/ax-site/share-images.ts", "lib/features/ax-site/columns/**"]
---

### [Marketing] SNS 用の画像・コラム一覧・公開日の確認（#344, #347, #348）
- **日付**: 2026-10-23
- **決定（オーナー）**:
  - **画像の「Microsoft Access」**: 画像に入れたままにする。法務の確認はしない。指摘を受けたら、ラベルから「Microsoft」を外した画像に差し替える。SNS にすでに共有された画像は、差し替えてもしばらく古いまま残ることを承知している
  - **Access LP の画像の改行**: 「その Access、／直して使うか、Web に移すか。」。比べる2つの選択肢を1行にそろえる
  - **スマホのコラム一覧**: 小さい画像（96px）を日付・題名の横に並べ、説明文はその下に通す（公開前）
  - **公開日（10/29）の SNS の画像の確認**: Claude は、公開の直後に og:image と画像を取得できるかを確かめる。GA4 の担当（マーケティング）は、午前中に Facebook のシェアデバッガーと LinkedIn Post Inspector で確かめる
  - **公開後に回すもの**: 題名の文字サイズをそろえる、画像の版の番号、短いキャッチ、UTM のルールの4つ。1つの Issue（#348）にまとめ、11月前半に対応する。UTM のルールはマーケティングが決める
- **ルール**: SNS 用の画像の文言は、そのページの文言だけを使う。期間・費用・削減率は入れない（`lib/features/ax-site/share-images.ts`）
