---
id: 2026-10-25-lead-input-count-limits
date: 2026-10-25
category: Leads
title: "リードの一括操作と絞り込みの件数の上限、取り込みは1,000件ずつ送る（#604）"
status: active
superseded_by: []
issues: [604, 575, 669, 688, 689]
paths: ["lib/features/leads/types/schemas.ts", "lib/features/leads/import-service.ts", "components/features/leads/import-dialog.tsx", "lib/features/filters/types/schemas.ts", "lib/features/tags/types/schemas.ts"]
---

### [Leads] リードの一括操作と絞り込みの件数の上限、取り込みは1,000件ずつ送る（#604）
- **日付**: 2026-10-25
- **決定**: リードの tRPC の入力に件数の上限を置く（`lib/features/leads/types/schemas.ts`）
  - `leads.bulkCreate` は1回に1,000件まで（`LEAD_BULK_CREATE_MAX`）。CSV・Excel の取り込み（`import-dialog.tsx`）は、正しい行をファイルの順に1,000件ずつ、1回ずつ順に送る（`importBatches`）。途中の回が失敗したら、作れた回の件数を知らせて一覧を読み直し、失敗した回とその後の回の行（とエラーの行）だけをプレビューに残す（`withoutImportedRows`）。もう一度押しても、作れた回は送り直さない。ただし、失敗した回がサーバーでは作られ、応答だけが届かなかったとき（関数の時間切れ、応答の前の切断）は、押し直すとその回（最大1,000件）が重なる（`leads` に `(organization_id, email)` の一意制約はない。1回で送っていた変更の前も同じ。扱いは #689）
  - 送っている間（`importing`）はダイアログを閉じない（「キャンセル」は無効、Esc・外側のクリック・×は何もしない）。閉じてもまだ送っていない回は止まらず、閉じたあとに開き直した別のファイルのプレビューを、前のループの終わりが消すため（読み取り専用のレビューの指摘）
  - `leads.bulkUpdateStatus`・`leads.bulkDelete` の `ids` は、一覧の1ページの最大（`LEAD_LIST_PAGE_MAX`、100件）まで。画面は表示中のページの行だけを選び、ページや並びが変わると選択を消す（`lead-table.tsx`）
  - `listLeadsSchema.tagIds` は、ほかの複数の値の絞り込み（`oneOrMany`）と同じ50件（`LEAD_FILTER_MAX_VALUES`）
  - `advancedFilter`（`leads.list`・`leads.export` の入れ子の条件）は #699 で消した（オーナーの判断、2026-10-25）。#604 では `LEAD_FILTER_LIMITS`（入れ子は3段、グループは10個、条件は全体で50個など）を付けたが、どの画面からも送っておらず、演算子・列の型と値の形が合わない値は 500 になっていた（#688）。将来必要になったら作り直す
    - 消したあとに送られても、断らずに無視し、条件にも監査にも入れない。strict にして BAD_REQUEST で断ることはしない（古い呼び出し元を落とさないため）
    - 無視されるのは、zod が落とすからではない（読み取り専用のレビューの指摘）
      - `listLeadsSchema` 自体は知らない項目を落とす。ただ、`organizationProcedure` の `organizationInputSchema` が `.passthrough()` で、tRPC は複数の `.input()` の結果を重ねてつなぐので、手続きの `input`（エクスポートの `filterInput` も）には、送られた `advancedFilter` が検査されないまま残る
      - 条件（`listWhere`・`leadListConditions`）と監査（`exportAuditFilters`）が決まった項目だけを読むので効かない。保証は手続きを通したテスト（`test/unit/features/leads-bulk-limits.test.ts`。WHERE を SQL にして比べ、監査の `filters` も比べる）で、スキーマ単体のテストではない
      - `...input` や `...filterInput` を、監査の metadata や外への送信にそのまま広げない（送られた値がそのまま流れる）。passthrough の扱いは #743
    - HTTP では、入れ子がとても深い値は、zod の前に superjson の `deserialize` でスタックが溢れる（手元の Node 22 で1,000〜2,000段の間）。tRPC はこれを BAD_REQUEST で返す（`resolveResponse` の入力の読み込み）ので、500 にも当番への通知にもならない。テストの `createCaller` は superjson を通らないので、10,000段でも無視される
- **理由**: どれも件数に上限がなく、1回のリクエストで何件でも送れた。実質の上限は Vercel の関数の本文の上限（約4.5MB）だけだった。`bulkCreate` は1件あたり最大9個の bind パラメータを使い、PostgreSQL のドライバー（postgres-js）が1文に送れる数（65,534 未満）を、約7,000件を超える1回の取り込みで超えていた（#604 の作業で、drizzle の `toSQL` で数えた）。`advancedFilter` は `z.lazy` の再帰のスキーマで、入れ子を最後の段まで読み、約800段でスタックが溢れていた（`RangeError`。手元の vitest で測った。tRPC は入力のエラーとして BAD_REQUEST の「Maximum call stack size exceeded」で返すが、`safeParse` を直接呼ぶと例外が出る）
- **却下案**:
  - 取り込みの上限を超えたら、プレビューで知らせて取り込ませない：今は1回で通る1,001〜約7,000件のファイルが通らなくなる（受け入れ基準「今の使い方で通る」に合わない）
  - 取り込みの1回の上限を上げる（5,000件など）：本文の上限とパラメータの上限に近づき、1回の transaction と変更の通知も大きくなる
  - `advancedFilter` を消す：#604 では範囲外として残した。#699 で消した（オーナーの判断、2026-10-25）
  - 取り込み中の「キャンセル」で、まだ送っていない回を止める（中止の印を各回の前に確かめる）：途中まで作った状態で止まり、どこまで作れたかを知らせる文言が要る（locales はほかの PR が触っている）。送り終わるまで待たせるほうが、作れた件数がはっきりする
- **ルール**:
  - 一括の手続きの配列には、画面が送る最大に合わせた `.max()` を付ける。画面が上限を超えうるときは、画面の側で分けて送るか、送る前に知らせる
  - 分けて送るときは、1回を1つの transaction にし、順に送る。失敗したら、作れた分を知らせて、残りだけをやり直せるようにする（作れた回を送り直さない）。送っている間は画面を閉じさせない
  - 入れ子を受けるスキーマは `z.lazy` で再帰させず、段ごとに組み立てて、上限の段より下を読まない（上限を超えた入力を、スタックを使い切る前に zod の検査で断るため）
    - これは zod の層での話。HTTP 経由では、zod より前に superjson の `deserialize` が入力を再帰で写すので、それより深い入力（手元の Node 22 で約1,000〜2,000段から。入力の形とスタックの大きさで変わる）は superjson でスタックが溢れ、tRPC が BAD_REQUEST（Maximum call stack size exceeded）で断る。書き込みも当番への通知もない（#669 の読み取り専用のレビューで確かめた）
    - 上限は保存する内容を縛るもので、検査の量は縛らない。zod v3 は `.max()` を超えた配列でも要素をすべて検査するので、1回の検査の量の上限は本文の上限（約4.5MB）になる。zod より前で深さと大きさを確かめるかは #742 で決める
  - 取り込みの回数は middleware の回数制限（`leads.bulkCreate` は1分に10回、パスごと・IP ごと・インスタンスごと）にも数えられる。1分に約10,000件を超える取り込みは途中で 429 になりうる。そのときも残りの行がプレビューに残る（待てば続けられると知らせる文言は #689）
  - 保存したフィルター（`filters.create`・`filters.update`）とタグの付与（`tags.setLeadTags`・`tags.bulkSetLeadTags`）の上限は #669 で付けた
    - 保存したフィルターは、リードのスキーマを読まず、`lib/features/filters/types/schemas.ts` の `SAVED_FILTER_LIMITS`（`LEAD_FILTER_LIMITS` と同じ数）と、段ごとに組み立てたスキーマを持つ。#699 でリードの `advancedFilter`・`filterGroupSchema`・`LEAD_FILTER_LIMITS` を消しても、保存したフィルターは変わらない
    - タグの付与の `tagIds` は20個（`LEAD_TAGS_MAX`、`lib/features/tags/types/schemas.ts`）。タグは手で選ぶ印で、一覧はリードのタグを2つ（`TagBadgeList` の既定は3つ）と残りの数で見せる。1回の呼び出しの上限で、1つのリードが持てる数ではない（`addToLead` で1つずつ足すと20個を超えうる。リードごとの上限にするかは、タグを付ける画面（Epic #430）を作る前に決める）。`bulkSetLeadTags` の `leadIds` は1ページ分（`LEAD_LIST_PAGE_MAX`）で、1回の insert は最大 100 × 20 = 2,000 行。重なった id は数に入れ、書くのは1回（前と同じ）
