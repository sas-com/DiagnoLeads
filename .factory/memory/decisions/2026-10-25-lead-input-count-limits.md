---
id: 2026-10-25-lead-input-count-limits
date: 2026-10-25
category: Leads
title: "リードの一括操作と詳細な絞り込みの件数・入れ子の上限、取り込みは1,000件ずつ送る（#604）"
status: active
superseded_by: []
issues: [604, 575, 669]
paths: ["lib/features/leads/types/schemas.ts", "lib/features/leads/import-service.ts", "components/features/leads/import-dialog.tsx"]
---

### [Leads] リードの一括操作と詳細な絞り込みの件数・入れ子の上限、取り込みは1,000件ずつ送る（#604）
- **日付**: 2026-10-25
- **決定**: リードの tRPC の入力に件数・入れ子の上限を置く（`lib/features/leads/types/schemas.ts`）
  - `leads.bulkCreate` は1回に1,000件まで（`LEAD_BULK_CREATE_MAX`）。CSV・Excel の取り込み（`import-dialog.tsx`）は、正しい行をファイルの順に1,000件ずつ、1回ずつ順に送る（`importBatches`）。途中の回が失敗したら、作れた回の件数を知らせて一覧を読み直し、まだ作っていない行（とエラーの行）だけをプレビューに残す（`withoutImportedRows`）。もう一度押しても、作れた行は重ねて作らない
  - `leads.bulkUpdateStatus`・`leads.bulkDelete` の `ids` は、一覧の1ページの最大（`LEAD_LIST_PAGE_MAX`、100件）まで。画面は表示中のページの行だけを選び、ページや並びが変わると選択を消す（`lead-table.tsx`）
  - `listLeadsSchema.tagIds` は、ほかの複数の値の絞り込み（`oneOrMany`）と同じ50件（`LEAD_FILTER_MAX_VALUES`）
  - `advancedFilter` は `LEAD_FILTER_LIMITS`：グループの入れ子は一番上を含めて3段、1つのグループの中のグループは10個、条件は全体で50個、項目名は50文字、文字の値は200文字（一覧の検索と同じ）、`in`・`not_in` の値は50個。値は文字・数・真偽・日付・null と、それらの一覧だけを受ける。画面からはまだ使っていない（消すかは決めていない）
- **理由**: どれも件数に上限がなく、1回のリクエストで何件でも送れた。実質の上限は Vercel の関数の本文の上限（約4.5MB）だけだった。`bulkCreate` は1件あたり最大9個の bind パラメータを使い、PostgreSQL のドライバー（postgres-js）が1文に送れる数（65,534 未満）を、約7,000件を超える1回の取り込みで超えていた（#604 の作業で、drizzle の `toSQL` で数えた）。`advancedFilter` は `z.lazy` の再帰のスキーマで、入れ子を最後の段まで読み、約800段でスタックが溢れていた（`RangeError`。手元の vitest で測った。tRPC は入力のエラーとして BAD_REQUEST の「Maximum call stack size exceeded」で返すが、`safeParse` を直接呼ぶと例外が出る）
- **却下案**:
  - 取り込みの上限を超えたら、プレビューで知らせて取り込ませない：今は1回で通る1,001〜約7,000件のファイルが通らなくなる（受け入れ基準「今の使い方で通る」に合わない）
  - 取り込みの1回の上限を上げる（5,000件など）：本文の上限とパラメータの上限に近づき、1回の transaction と変更の通知も大きくなる
  - `advancedFilter` を消す：使っていないが、消すかは別に決める（#604 の範囲外）
- **ルール**:
  - 一括の手続きの配列には、画面が送る最大に合わせた `.max()` を付ける。画面が上限を超えうるときは、画面の側で分けて送るか、送る前に知らせる
  - 分けて送るときは、1回を1つの transaction にし、順に送る。失敗したら、作れた分を知らせて、残りだけをやり直せるようにする（重ねて作らない）
  - 入れ子を受けるスキーマは `z.lazy` で再帰させず、段ごとに組み立てて、上限の段より下を読まない（上限を超えた入力を、スタックを使い切る前に zod の検査で断るため）
  - 取り込みの回数は middleware の回数制限（`leads.bulkCreate` は1分に10回、パスごと・IP ごと・インスタンスごと）にも数えられる。1分に約10,000件を超える取り込みは途中で 429 になりうる。そのときも残りの行がプレビューに残る
  - 保存したフィルター（`filters` ルーター）とタグの一括付与（`tags` ルーター）の同じ種類の上限は #669 で付ける
