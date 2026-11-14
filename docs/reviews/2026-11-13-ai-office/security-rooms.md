> **これは記録です。** `security-specialist`（AI）が 2026年11月13日に読み取り専用で行ったレビューの報告を、そのまま残しています。
> 対象：PR #1105 の顧客ファイル（#1128）・総務・受付（#1133）・カスタマイズ（#1134）。見たコミット：`d3bff3c5`・`b5fdbd26`・`09f3fab4`。
> 行番号と指摘は、その時点のコードのものです。直したもの・残っているものは [README.md](./README.md) を見てください。
> 【推測】と書かれた項目は、実行して確かめたものではありません。

# PR #1105（`d3bff3c5`・`b5fdbd26`・`09f3fab4`）読み取り専用レビューの結果

## 総評

- **マージを止める指摘（blocker）はありません。** 認可・組織の分離・入力の検査・出力の経路に、悪用できる穴は見つかりませんでした。
- 直したほうがよい点は1件で、今は悪用できず、#1114 に Issue として引き継げば足ります。
- 確認だけの点は4件です（RLS の行、0039 の番号の重なり、画面の保存のしかた、実行できなかった検証）。

対象は PR の head `09f3fab4`（作業ツリーは差分なし）です。ファイルの編集・コミット・コメントは行っていません。

## 1. マージを止めるべき指摘

ありません。

## 2. 直したほうがよい指摘（Issue に残せばマージ可）

| # | 場所 | 何が起きるか | どう直すか |
|---|------|------------|-----------|
| S1 | `lib/features/ai-employees/service.ts:207-241`、`lib/features/ai-employees/types/profile.ts:153-168` | 管理者（または管理者のセッションを得た人）が、今 `workStyle.autonomy = 'report'`（人に確かめずに進める側）を保存しても、画面は「今は効きません」と出ます。#1114 でこの値を読み始めた時点で、過去に保存された値がそのまま有効になります。変更は `audit_logs` に書かれず、残るのは `updated_at` だけなので、誰がいつ変えたかを後から追えません。 | この PR では直さなくて構いません。#1114 の受け入れ基準に次の2つを入れてください。(1) 効かせる時点で、既に保存されている `autonomy` と `stats` をどう扱うか（既定に戻すか、有効にするときに確かめ直すか）。(2) `workStyle` の変更を `audit_logs` に書くこと。 |

- 確かめたこと：今は `profile` を読むのが `getOffice`（`service.ts:149`）だけで、仕事の実行からは読まれていません。AI社員の採用・休止・解雇も、もともと監査に書いていません。
- 推測：#1114 がこの値をそのまま読む形になるかどうかは、設計がまだ無いので分かりません。

## 3. 確認だけ

| # | 場所 | 内容 |
|---|------|------|
| C1 | `drizzle/0039_ai_employees.sql` | `ai_employees` と `ai_employee_runs` に `ENABLE ROW LEVEL SECURITY` の行がありません。`0013`・`0027`・`0029`・`0031`〜`0033` の組織の表には手で足されています（`0036` の `field_glossary` にも無し）。攻撃が成り立つのは、Supabase の Data API が有効で、かつ `anon` / `authenticated` に表の権限が残っている場合だけです。`scripts/supabase/prepare.sql:14-19` が既定の権限を取り消しているので、手順どおりなら届きません。本番で `prepare.sql` が適用済みか、Data API が無効かは確かめられていません。0039 は未適用なので、そろえるなら2行足すだけで済みます。 |
| C2 | `drizzle/meta/_journal.json` | open な PR のうち #902・#858・#822・#795 も `0039_*` のマイグレーションを持っています。先にマージされたほうが 0039 を取り、残りは `.claude/rules/db-schema.md` のとおり作り直しになります。本番への適用は、マージの前にオーナーの承認が要ります。 |
| C3 | `components/features/ai-employees/office-studio.tsx:96` | 画面は毎回4つの部分すべて（`profile: draft`）を送ります。サーバーの「部分ごとに合わせる」利点は画面からは使われず、2人の管理者が同時に編集すると、後から保存した人の内容で全部が上書きされます。セキュリティの問題ではありません。 |
| C4 | 検証の限界 | 敵対的な入力の追加の確認（`__proto__` のキー、superjson の Map など）は、ガードが `bun -e` を止めたので実行していません。zod 3.24.0 のソース（`node_modules/zod/lib/types.js:1993-2026`）を読んだ結論です。実 DB のテストは手元では流していません。 |

## 4. 確かめて問題が無かった点

**1. 認可と組織の分離**
- `aiEmployees.update` は、最初に `update Settings` を確かめています（`lib/features/ai-employees/api/router.ts:72-73`）。この権限を持つのは owner・group_owner・admin・group_admin だけです（`lib/auth/permissions.ts:82-163`）。
- UPDATE の条件は `id` と `organizationId` の両方です（`service.ts:233-238`）。組織の ID は、所属を確かめた `ctx.organization.id` を使っています。
- `getOffice` は `organizationId` で絞って読み、`profile` は必ず `resolveAiEmployeeProfile` を通ります（`service.ts:100-104`、`149`）。
- `ai_employees` を読むのは `service.ts` だけです（`git grep` で確認）。
- 実 DB のテストが、メンバーは FORBIDDEN、別の組織の管理者は NOT_FOUND で相手の行が変わらないことを見ています。CI の「DB Integration Tests」は head で成功しています。

**2. 入力の検査**
- `look`・`stats`・`workStyle` と最上位のすべてが `.strict()` で、値は `z.enum` と 1〜6 の整数だけです（`profile.ts:81-90`、`129-131`、`166-168`、`190-197`）。
- 保存できる JSON は、列挙の値の組み合わせだけなので、大きさは数百バイトで頭打ちです。
- `organizationProcedure` の passthrough があっても、後の parser の結果が `profile` を上書きします（`node_modules/@trpc/server/dist/initTRPC-T5bbc89W.mjs:49`）。router は項目を名前で取り出しています。
- `profile || ${JSON.stringify(...)}::jsonb` は、drizzle の `sql` テンプレートの値なのでパラメータで渡ります（`service.ts:228`）。postgres-js の jsonb の二重エンコードも、drizzle が打ち消しています（`node_modules/drizzle-orm/postgres-js/driver.js:21-22`）。
- 関係するユニットテスト6ファイル・101件を流し、すべて通りました。

**3. 出力**
- 色は名前から定数の表（`ROBOT_SHELL_COLORS`・`ROBOT_ACCENT_COLORS`）で引くだけで、保存された文字列が SVG の属性や style に入る経路はありません（`components/features/ai-employees/office-robot.ts:52-85`、`164-171`）。
- `t(\`options.${part}.${option}\`)` の `part` と `option` は、定数の一覧を回した値で、DB の値ではありません（`office-studio.tsx:252-278`）。
- `talkLineKey` の `tone` は、サーバーで列挙に直した値です。キーは ja・en とも同数（67）ありました。
- 差分に `dangerouslySetInnerHTML` と `t.rich` はありません。リードの会社名・氏名・メモは React の文字列として出ています。
- `mailto:` と `tel:` は、既存のリードの詳細と同じ形です（`components/features/leads/detail/lead-fields-card.tsx:323`、`331`）。

**4. 顧客ファイルと期限の部屋**
- `recordContact`・`deleteContact`・`updateTask` は、API 側で `update Lead` を確かめています（`lib/features/lead-follow-up/api/router.ts:88`、`100`、`159`）。parent_viewer は拒まれます。
- `deleteContact` は `organizationId` と `id` で消し、無ければ NOT_FOUND です（`lib/features/lead-follow-up/service.ts:240-249`）。
- `updateTask` は、読むときも書くときも `taskScope(organizationId, id)` です（`service.ts:657`、`751`）。
- `recordContact` は、リードと商談を同じ組織・同じリードで確かめています（`service.ts:152-170`）。
- router の `...input` は規則の形から外れますが、スキーマが `.strict()` なので余分な項目は入りません（既存のコードで、この PR の範囲外）。

**5. 個人情報**
- 顧客ファイルの連絡先は `leads.list` の答えで、`read Lead` が要ります（`lib/features/leads/api/router.ts:272-279`）。
- 記録した人の名前は `leadFollowUp.contacts`（`read Lead`）の既存の答えです。
- `read Analytics` を持つ役割は、すべて `read Lead` も持っています。出社の画面で新しく見えるようになった人はいません。
- 外部サービスへの新しい送信、Service Worker によるキャッシュはありません。

**6. マイグレーション**
- 作り直しの前後の差は、`"profile" jsonb DEFAULT '{}'::jsonb NOT NULL` の1行だけです。
- スナップショットの `prevId` は 0038 の `id` と一致し、`when` は 0038 より新しくなっています。
- 追加だけで、既定値と NOT NULL が付いています。

**シークレットと社外秘**
- 差分のテスト・翻訳・ヘルプ・決定の記録に、キー・接続文字列・実在の連絡先・取引先名は見当たりませんでした。

## 5. 判断が必要な点

- **S1 の扱い**：#1114 の Issue に引き継ぐか、この PR で監査だけ先に足すか。引き継ぎで足りると考えます。
- **C1 の扱い**：0039 に RLS の2行を足してそろえるか、`prepare.sql` に任せるか。本番で `prepare.sql` が適用済みかどうかは、情報システム部門（本番 DB の管理者）への確認が要ります。
- **法務部門への確認**：この差分で新しく要るものはありません（個人情報を見られる人も、外部への送信も変わっていません）。
