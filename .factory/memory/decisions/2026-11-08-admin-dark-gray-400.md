---
id: 2026-11-08-admin-dark-gray-400
date: 2026-11-08
category: UI
title: "管理画面のダークモードでは gray-400 を Solid Gray 300 に置き換え、文字を 4.5:1 にする（#932、2026-11-07-ui-audit-owner-decisions の一部を変更）"
status: active
superseded_by: []
issues: [932, 930, 423]
paths: ["app/globals.css", "test/unit/components/admin-dark-text-css.test.ts", ".claude/skills/ui-audit/references/dads.md"]
---

### [UI] 管理画面のダークモードでは gray-400 を Solid Gray 300 に置き換え、文字を 4.5:1 にする（#932、2026-11-07-ui-audit-owner-decisions の一部を変更）
- **日付**: 2026-11-08
- **決定**（オーナー判断。2つの直し方と推奨を示して聞いた）:
  - `app/globals.css` の `html.dark:has(.dl-admin)` で、`--color-gray-400` を Solid Gray 300（#b3b3b3）に置き換える。ライトモードは今のまま Solid Gray 420
  - これで、ダークモードで `gray-400` の文字は、`gray-800` の面で 6.03、`gray-900` の面で 8.30 になる。`gray-400` の枠線とアイコンも少し明るくなり、どの面でも 3:1 以上
  - [2026-11-07-ui-audit-owner-decisions](./2026-11-07-ui-audit-owner-decisions.md) の「`gray-400` は面によらずダークモードの文字に使わない」を、この決定で置き換える。ほかの点（3段階の値・画像の節・問い合わせ）は、そのまま有効
  - `gray-100`（ダークの body の文字）は変えない。どの面でも 4.5:1 を満たす（`gray-900`・`gray-800`・`gray-700` に対して 13.94・10.12・6.77）。`gray-50` に寄せても読みやすさは変わらず、約70か所を書き換えることになるため
- **理由**: 管理画面で `dark:text-gray-400` を文字に使う所は、約45ファイル・約100か所あった（Issue の見込みは約30か所）。1か所ずつ直すと、共通部品・ヘッダー・リードの画面に広く触り、並行するセッションとぶつかりやすい。置き換えなら、`app/globals.css` の1か所で全部に効く
- **却下案**: 1か所ずつ `gray-200`（補足）か `gray-300`（控えめ）に書き換える（決めた3段階のとおりになり、枠線とアイコンは今のままだが、約45ファイルを触る）。今は着手しない
- **ルール**:
  - ダークモードで `gray-400` と `gray-300` は同じ色になる。新しく書くときは、役割どおり `gray-200`（補足）か `gray-300`（控えめ）を使う
  - `gray-700` の面の上の文字は、`gray-200` 以上にする（`gray-300` と、置き換えた `gray-400` は 4.03 で届かない）
  - `test/unit/components/admin-dark-text-css.test.ts` が、置き換えとコントラストを検査する
- **参照**: #932、`node_modules/@digital-go-jp/design-tokens/dist/tokens.css`
