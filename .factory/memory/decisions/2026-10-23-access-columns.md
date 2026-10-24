---
id: 2026-10-23-access-columns
date: 2026-10-23
category: Marketing
title: "Access の入口のコラムと、.accde・.mde の扱い（#363, #367, #372）"
status: active
superseded_by: []
issues: [363, 367, 372]
paths: ["lib/features/ax-site/columns/**", "lib/features/ax-site/result-column.ts"]
---

### [Marketing] Access の入口のコラムと、.accde・.mde の扱い（#363, #367, #372）
- **日付**: 2026-10-23
- **決定（オーナー）**:
  - Access の診断結果に、回答に合うコラムを1本だけ案内する。相談の CTA の下に置き、新しいタブで開く（結果は画面の中にしかなく、同じタブで戻ると消えることがあるため）。公開前に入れる
  - コラム「Access のファイルの見分け方と、拡張子の一覧」を作り、一覧の先頭に置く。Access かどうか分からない人の入口にする。Access LP の「対象になる Access」から `from=ax-access-lp-targets` でつなぎ、末尾の関連コラムとは分けて数える
  - .accde・.mde しか残っていないツールも受ける。Access LP の「対象になる Access」にそう書いた。営業とエンジニア部門には、オーナーが伝えた
- **ルール**: 診断の設問の中には、コラムへのリンクを置かない（10/22 の決定のとおり、診断の途中で出ていくリンクになるため）
