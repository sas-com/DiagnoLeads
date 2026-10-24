# アーキテクチャ（層・依存の向き・機能の型）

このファイルが、ディレクトリ構成と依存の向きの正本。import の向きは `bun run arch:check`（CI の Lint & Type Check）で機械的に確かめる。

- 経緯と判断：`.factory/memory/decisions/`（このファイルの決定は `2026-10-24-architecture-guardrails`）
- 今後の見直しの段階：Epic #450
- テストの置き場所と名前：`docs/TESTING.md`
- tRPC の権限と組織の絞り込み：`.claude/rules/api-routers.md`
- スキーマの変更：`.claude/rules/db-schema.md`
- 次の文書は 2026-02 以前の評価・計画の記録で、今の構成を表していない：`openspec/`、`docs/ARCHITECTURE_EVALUATION*.md`、`docs/DIRECTORY_IMPROVEMENT_PLAN.md`

技術：Next.js 16（App Router、`proxy.ts`）・tRPC 11・Drizzle（PostgreSQL / Supabase）・Better Auth と CASL・Payload CMS 3・next-intl 4。Vercel のサーバーレス（関数は30秒まで）で動く。

## 1. 層と依存の向き

上の層から下の層へだけ import する。

| 層 | 置き場所 | 役割 |
|---|---|---|
| ① 入口 | `app/`、`proxy.ts`、`server/routers/_app.ts` | ルーティングと HTTP の受け口。業務ロジックは書かない |
| ② 画面 | `components/`、`hooks/`、`context/` | React の部品。`components/ui` は shadcn/ui |
| ③ 機能 | `lib/features/<feature>/` | 業務ロジック・DB の読み書き・tRPC のルーター |
| ④ 基盤 | `lib/` の features 以外（`db`・`trpc`・`auth`・`multi-tenant`・`email`・`ops`・`cron`・`i18n`・`middleware` など） | 機能をまたいで使う仕組み。機能を import しない |

- 画面（②）が機能（③）から値で読んでよいのは、`types/` と純粋なファイル（DB を使わないもの）だけ。`service.ts` は `import type` だけ、`api/` は読まない
- `components/ui` は `components/ui`・`lib/utils.ts`・`lib/csp/`（ブラウザで `<style>` を足す部品が、ページの CSP の nonce を読む。#317）だけを import する末端の部品
- Payload（`payload`・`@payloadcms/*`・`@payload-config`）を読むのは `cms/`・`app/(payload)/`・`lib/cms/`・`payload.config.ts` だけ。組織ごとのデータは Payload ではなくアプリの DB に置く
- 公開ページ（`app/[locale]/(ax)/`・`(public)/`）は Server Component を基本にし、必要な所だけ `'use client'` にする。採点のコードはクライアントに送らない（点数はサーバーだけで計算する）

## 2. 機械で守るルール（`bun run arch:check`）

`scripts/check-architecture.ts` が、TypeScript の構文木から app・lib・server・components・hooks・context・cms の import を読む（`import type` は区別する）。`test/` は、import と `vi.mock` などに渡すパスが実在するかだけを見る（ほかのルールの対象には入れない）。ルールは2種類ある。

- 例外なし：違反が1件でもあれば失敗する。許可リストには載せられない（`--update` でも書き出さない）
- 許可リスト：ルールが入る前からあった違反を `scripts/architecture/allowlist.txt` に1件ずつ載せてある。載っていない違反があると失敗する。載っているのに消えた違反があっても失敗する（`--update` で行を消す）

| ルール | 内容 | 種類と許可リストの件数（2026-10-24） |
|---|---|---|
| `lib-imports-ui` | lib は app・components・hooks・context を import しない | 例外なし |
| `lib-imports-server-values` | lib から server（`AppRouter`）は型だけ | 例外なし |
| `infra-imports-features` | 基盤は lib/features を import しない | 許可リスト 8（うち3件は `lib/db/schema.ts` が jsonb の型を機能から読む型だけの import。2件は `types/`、1件は `diagnosis-builder/definition.ts`） |
| `feature-imports-other-router` | 機能のルーター（`api/`・`router.ts`）を読むのは、同じ機能と `server/routers/` だけ | 例外なし |
| `client-imports-server-only` | ブラウザで動くコードから、サーバー専用のファイル（`lib/db`、`server/`、`lib/trpc/{init,context}`、`lib/auth/config`、機能の `api/`・`router.ts`・`service.ts`）とパッケージ（`postgres`・`drizzle-orm`・`payload`・`resend`・`@anthropic-ai/sdk`・`openai`・`next/headers`・`node:*` など）に届かない | 例外なし |
| `public-bundle-imports-scoring` | 公開ページのクライアントに、採点（`diagnostics/ax-migration/{evaluate,mql,config}`・`diagnosis-builder/evaluate`）を入れない | 例外なし |
| `ui-kit-imports-app-code` | `components/ui` は `components/ui`・`lib/utils.ts`・`lib/csp/` だけを読む | 例外なし |
| `payload-outside-cms` | Payload を読むのは CMS の置き場所だけ | 例外なし |
| `file-cycles` | ファイル単位の import の循環を作らない | 例外なし |
| `test-paths-resolve` | テストが import するパスと、`vi.mock`・`vi.doMock`・`vi.unmock`・`vi.doUnmock`・`vi.importActual`・`vi.importMock` に渡すパスが実在する（パッケージ名は見ない。テストの `@payload-config` は vitest の別名どおり `test/mocks/payload-config.ts`）。存在しないパスへの `vi.mock` はエラーにならず、黙って効かなくなる（本物のモジュールが動き、原因の分かりにくい失敗か、副作用を伴う素通りになる）ので、ファイルを消す・移したときに、古いパスを指したまま残ったテストをこの検査が見つける | 例外なし |
| `features-in-cycles` | 互いに依存し合う機能（間接も含む）を増やさない | 許可リスト 20 |
| `cross-feature-internal` | 他の機能から読むのは公開面（`types/**`・`types.ts`・`service.ts`。ほかに `email/index.ts`・`respondent-email/index.ts`）だけ。項目は読まれる側のファイル | 許可リスト 45 |
| `features-use-global-db` | 機能のコードはグローバルの `db` を使わず、`ctx.db` か引数の executor を使う（RLS で接続を差し替えるため） | 許可リスト 12 |
| `feature-index-files` | lib/features に `index.ts`（barrel）を作らない | 許可リスト 18 |
| `unregistered-routers` | 機能のルーターはすべて `server/routers/_app.ts` に登録する | 許可リスト 2 |

許可リストの数は減らす方向にだけ動かす。

検査の限界：
- `cross-feature-internal` の項目は読まれる側のファイルなので、許可リストにある内部のファイルを別の機能が新しく読んでも検出しない（許可リストの45ファイルは、事実上の公開面になっている）。新しく読むときは、相手の `service.ts` か `types/` に出すことを先に考える
- `features-in-cycles` は、循環に入っている機能の名前の一覧で比べる。今ある2つの循環（18機能と2機能）がつながっても検出しない
- 公開ページの採点のルールが見るのは、公開ページ（`(ax)`・`(public)`・`[...rest]`・トップと共通のレイアウト）から `'use client'` の境界を越えて値でたどれるファイル。ブラウザのコードの判定では、`'use server'` のファイル（サーバーアクション）とその先はたどらない
- `unregistered-routers` は、`api/` の下の `*-router.ts` をほかのルーターに組み込む形（_app.ts に直接登録しない）も未登録として数える。その形を使うときは、許可リストに足して PR に理由を書く
- `test-paths-resolve` が見るのは、パスの文字列がそのまま書かれているものだけ（`` vi.mock(`@/lib/${name}`) `` や `import('@/locales/' + locale)` のように組み立てたパスは見ない）。パスが実在しても、テストが読むモジュールと mock したモジュールが違う（再 export の元を mock していない）ことは検出しない

## 3. 機能1つの型

手本は Epic #162 の頃に作ったモジュール（`lead-prep`・`act-timing`・`appointment-reviews` など）。

```
lib/features/<feature>/
├── api/router.ts      tRPC の入口。organizationProcedure・ctx.ability の確認・入出力の zod・service の呼び出しだけ
├── service.ts         業務ロジック。第1引数に db か transaction（executor）を受け、すべてのクエリを organizationId で絞る
├── types/schemas.ts   zod の入力スキーマと上限の定数。画面と共有する（zod と他の types/ だけを import）
├── types/<name>.ts    列挙・定数・純粋な型（例：leads/types/pipeline.ts）
└── <name>.ts          その機能の中の補助（純粋な関数・SQL の組み立て・通知の文面など）。内部扱い

components/features/<feature>/
├── <feature>-*.tsx    画面の部品。リード詳細のカードは { organizationId, leadId } を受ける
└── use-<feature>-*.ts その機能だけで使う hook（hooks/ には複数の機能で使うものだけを置く）
```

- 外から import してよいもの
  - 他の機能から：公開面（`types/**`・`types.ts`・`service.ts`）だけ。それ以外のファイルを使いたいときは、`service.ts` か `types/` に出す
  - 画面から：`types/` と純粋なファイル。`service.ts` は型だけ
  - `api/router.ts`：`server/routers/_app.ts` だけ
- `index.ts` は作らない
- 機能単位の循環を増やさない（`features-in-cycles`）。新しい機能は既存の中心（leads・lead-hearings・webhooks・notifications・email）を読む向きにし、中心の側から新しい機能を読まない。両方を並べる画面は components・app でまとめる
- page.tsx は params を読んで `components/features/<feature>` の部品を置くだけにする（新しい `_components/` は作らない）
- 公開フォームの API（`app/api/.../route.ts`）は、検査 → zod → service → `after()` の順に書く

## 4. 機能を1つ足すときに触る場所

新しく作るファイル：
- `lib/features/<feature>/`（上の型）
- `components/features/<feature>/`
- `app/[locale]/(dashboard)/<feature>/page.tsx`
- テスト（`docs/TESTING.md`）：`test/unit/features/<feature>*.test.ts`（機能のテストが複数あるときは `test/unit/features/<feature>/` に置いてよい。決定 `2026-10-24-test-feature-subdirectories`）、`test/unit/integration/<feature>*.db.test.ts`（組織の分離を含む）、`test/unit/components/<feature>/`
- 決めたことがあれば `.factory/memory/decisions/<日付>-<名前>.md`

編集する共有のファイル（ハブ）：
| ファイル | 足すもの | 注意 |
|---|---|---|
| `server/routers/_app.ts` | import 1行とキー1行 | 登録しないと外から呼べない（`unregistered-routers` で落ちる） |
| `lib/db/schema.ts` と `drizzle/` | 表の定義と `bun run db:generate` の出力 | 新しい表は関連する表の近くに足す（末尾に足すと並行の PR とぶつかる。今までテキストの衝突が0件だったのは、追加の位置が散っていたから）。main を取り込んで番号がぶつかったら、自分の SQL・snapshot・ジャーナルの行を消して生成し直す。手順は `.claude/rules/db-schema.md`。番号の重複と `when` の逆転は `test/unit/lib/db/migrations-journal.test.ts`（#453 で追加）が検出する |
| `locales/{ja,en}/common.json` | 新しい名前空間 | 名前空間ごとのファイルに分ける仕組みは #450 で入れる予定 |
| `components/features/leads/detail/lead-detail-view.tsx` とそのテスト | リード詳細のカード | カードの列の切り出しは #450 で行う予定 |
| `components/layout/AppSidebar.tsx`・`lib/routes/admin-pages.ts` | メニューとページの接頭辞 | 足し忘れはテストで落ちる |

これから足す予定の機能の置き場所：
- ワークフローのランナー（#298〜）：`lib/workflow/`（`lib/cron`・`lib/ops` と同じ基盤の層）。機能を import せず、フローの定義は引数で受ける。定義の一覧は定期実行のルートの直下に置く（`docs/WORKFLOW_ENGINE_EVALUATION.md` 7.8）
- 営業代行の外部アカウント（#276）：役割は `lib/auth/permissions.ts`（CASL）の1か所で決め、各ルーターに `role` の比較を足さない。見せる範囲は各機能の `service.ts` の絞り込みで守る（RLS は #51 で入れる予定）
- AI の呼び出し（#48）：Anthropic のクライアントとモデル ID は `lib/features/ai/` の1か所に置き、他の機能はその関数を呼ぶ
- 2つ目の診断：方式の決定（`decisions/2026-10-18-second-diagnosis-timing`）を読んでから。汎用の部品（`diagnostics/` 直下・`diagnosis-builder/`）から `diagnostics/ax-migration/` を新しく読まない

## 5. `arch:check` が落ちたときの直し方

1. 表示された import が本当に要るかを見る。要らなければ消す
2. 他の機能の内部のファイルを読んでいるなら、相手の `service.ts` か `types/` から使う。なければ、相手の機能の中で `service.ts` か `types/` に出す
3. 基盤から機能を読んでいるなら、その部品を基盤（`lib/`）に置くべきか考える
4. ブラウザのコードからサーバー専用のファイルに届いているなら、値の import を `import type` にするか、サーバー側（Server Component・tRPC）で処理する
5. 許可リストのルールで、それでも例外にするなら、`bun run arch:check --update` で許可リストに足し、PR に理由を1行書く。公開の直前など急ぐときもこれで通る。直すのは後の PR でよい。例外なしのルール（ブラウザからサーバー専用のコード、公開ページの採点など）は許可リストに載せられないので、必ず直す

違反を減らしたときも `--update` を流し、許可リストから消えた行を同じ PR に入れる。マージの前に main を取り込み、もう一度流す（並行の PR が同じ行を消している・足していることがある）。

- `allowlist.txt` が衝突したら（隣り合う行を別々の PR が消すと起きる）、main の側を取り、`--update` を流し直す
- マージの順番しだいで main が落ちることがある。例：PR A が最後の importer を消して行を削り、その前の main から分かれた PR B が同じファイルを新しく読む。main で落ちたら、最初に気づいた人が `--update` と理由1行の PR を出す

## 6. ファイルを移す・分ける PR の条件

ハブの分割やディレクトリの移動は、次をすべて満たすときに、移動だけの1本の PR で行う。

- 移す範囲のファイルを触っている開いた PR が0（各 PR の変更ファイルの一覧で確かめる）。公開の前後（10/29）と RLS の作業中（11/4〜11/14）は行わない
- `git diff -M` で改名として出る（中身の変更を混ぜない）
- スキーマを分けたときは `bun run db:generate` の差分が0。文言を分けたときは、合成した結果のキーが移す前と一致する
- 古いパスには1行の再 export を残し、importer は触るついでに新しいパスへ替える。替えるときは、テストの `vi.mock('<パス>')` も同じパスに替える（古いパスのままだとモックが効かない）
- 決定ファイル（`.factory/memory/decisions/*.md`）の `paths` が古いパスを指していたら、同じ PR で直す（`test/unit/claude-hooks` が検出する）
- 1回の revert で戻せる

## 7. 診断の系統と名前の対応

同じ「診断」が層ごとに違う名前で置かれている。改名はしない（並行の作業と衝突するため）。

| 系統 | 状態 | 画面 | API | lib | 部品 | 文言 | 保存先 |
|---|---|---|---|---|---|---|---|
| AX 診断（コードで定義） | 現役 | `/[locale]/ax-migration`（LP）・`/ax-migration/access`・`/ax-diagnosis` | `/api/diagnostics/ax-migration`（ほかに consultation・details・offers・result-email） | `diagnostics/ax-migration/`（エンジンと防御の部品は `diagnostics/` 直下） | `ax-diagnosis`・`ax-site`・`diagnosis-runner` | `axDiagnosis`・`axSite`・`axAccess`・`axColumn` | `diagnostic_submissions`（key は `ax-migration`）、`leads.responses.axMigration` |
| 診断ビルダー | 公開側だけ動く。管理画面は #117〜#121 | `/[locale]/d/[slug]` | `/api/diagnoses/[slug]/submit`・`consultation`、tRPC `diagnoses` | `diagnosis-builder/` | `public-diagnosis`・`diagnosis-runner` | `publicDiagnosis` | `diagnoses`・`diagnosis_versions`、`diagnostic_submissions`（key は `d:<id>`） |
| 旧汎用フォーム | 本番で無効（`LEGACY_DIAGNOSTIC_FORM_ENABLED`） | `/[locale]/diagnostic` | `/api/diagnostic` | `diagnostics/legacy-form.ts` | `diagnostic` | `public.diagnostic` | `leads` に直接 |
| テンプレート・埋め込み・QR・A/B | 使っていない（API キー方式の埋め込みの公開 API とウィジェットは #505 で消した） | `settings/embed`・`settings/qr-campaigns` | tRPC `diagnosticTemplates`・`embed`・`distribution`・`abTests` | `diagnostic-templates/`・`embed/`・`distribution/`・`ab-tests/` | なし（ページに直書き） | `settings.embed`・`settings.qrCampaigns` | `diagnostic_templates`・`embed_configs`・`qr_campaigns` など |

新しい診断を足すときは、2つ目の診断の方式の決定（`decisions/2026-10-18-second-diagnosis-timing`）を先に読む。
