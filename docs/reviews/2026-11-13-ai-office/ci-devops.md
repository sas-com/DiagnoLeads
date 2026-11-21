> **これは記録です。** `ci-devops-specialist`（AI）が 2026年11月13日に読み取り専用で行ったレビューの報告を、そのまま残しています。
> 対象：PR #1105・#1136 の CI・ビルド・デプロイ・依存・マイグレーションの順番。見たコミット：`111c8695`（PR #1105）・`38a36b2a`（PR #1136）。
> 行番号と指摘は、その時点のコードのものです。直したもの・残っているものは [README.md](./README.md) を見てください。
> 【推測】と書かれた項目は、実行して確かめたものではありません。

# CI・ビルド・デプロイ・依存のレビュー（PR #1105 / #1136、読み取りのみ）

## 総評

- コードや設定の欠陥としてマージを止めるものは、両 PR とも見つかりませんでした。止めるべきものは手順の2点です（#1136 を今の base のままマージしない／0039 を本番に流す前の `--check` の読み方）。
- 依存の追加は確かです。`bun.lock` の差分は3パッケージと推移的な依存だけで、既存パッケージが実行時に解決する版は変わっていません。three のチャンクはどのルートの First Load にも入っていません（手元のビルド出力で確認）。
- 一番効く指摘は、R3F が実行時に組む相手が `react@19.2.0` ではなく Next.js が抱える React（canary）である点です。Next を上げたときに 3D だけが実行時に壊れ、今の CI では気づけません。

確かめた対象：作業ツリー `38a36b2a`（クリーン）、`111c8695`、リモートの main `29a4578f`（手元の `origin/main` は `175f3994` で古いままです。fetch はしていません）。

---

## 1. マージを止めるべき指摘

| # | 場所 | 何が起きるか | どうするか |
|---|------|------------|-----------|
| S1 | PR #1136（base `claude/zealous-carson-xunn0r`）／`.github/workflows/ci.yml:6-8` | 【確認】#1136 は `mergeable_state: clean`、check-runs は 0 件。ブランチ保護は main だけ（必須7検査）なので、今の base のままなら検査なしでマージできてしまう。マージすると依存の変更が #1105（スキーマ変更）に混ざり、決まり（`.claude/rules/db-schema.md:19`）に反する | #1105 が main に入るまで #1136 はドラフトのまま、マージしない。PR 本文にマージの順番を書く |
| S2 | `scripts/db-migration-ledger.ts:82-98, 179-207, 213-230` | 【確認】`--check` が止まる（exit 1）のは「飛ばされるマイグレーション」があるときだけ。ほかのブランチの 0039 が先に本番へ入っていた場合、#1105 の `when`（1794578049281）のほうが新しいので止まらず、警告「台帳にあるが、このジャーナルに無い」を出すだけで `db:migrate` は 0039 を流す | 本番の `--check` の出力が `Would apply: 0039_ai_employees` だけで、警告が1行も無いことを確かめてから流す。警告が出たら流さずにオーナーへ（下の 7 を参照） |

## 2. 直したほうがよい指摘

| # | 場所 | 何が起きるか | どうするか |
|---|------|------------|-----------|
| M1 | `node_modules/next/dist/compiled/react/cjs/react.production.js`（`19.3.0-canary-278794d7-20261002`）／`package.json:71, 92, 99` | 【確認】App Router のバンドルで動く React は Next が抱える canary（ビルド済みチャンクにも同じ版の文字列）。3D のチャンクの中の R3F のリコンサイラは `reconcilerVersion:"19.3.0"`。Bun の peer の検査は `react@19.2.0`（bun.lock）を見るので、`next`（`^16.4.2`）を上げて中の React が 19.4 系になっても警告は出ない。【推測】そのとき 3D の画面だけが実行時に落ちる。Canvas を載せるテストが無いので CI は緑のまま | 検証の段階では、決定 `2026-11-13-office-3d-react-three-fiber` と PR 本文に「Next を上げたら 3D を手で確かめる」と書く。本実装に進むなら、本番ビルドで 3D を開く E2E を1本（下の 5）。vitest では捕まえられない（vitest は `react@19.2.0` を使うため） |
| M2 | `.github/workflows/ci.yml:6-8` | 【確認】`branches` は base の名前への絞り込み。`types:` が無いので既定（opened・synchronize・reopened）だけで動く。base の付け替え（`edited`）では CI は始まらない。リポジトリは `delete_branch_on_merge: false` なので、#1105 のマージ後に base が自動で main に変わることもない | #1105 のマージ後、手で base を main に替え、main を取り込んだコミットを push する（synchronize で CI が動く）。push なしなら close → reopen |
| M3 | `vercel.json:5`／`ci.yml:22`／決定 `2026-10-21-frozen-lockfile-on-vercel` | 【確認】ロックファイルを書いた手元の Bun は 1.4.4、CI は 1.4.3、Vercel は決定の記録では 1.3.14。`lockfileVersion: 1`・`configVersion: 0` は変わっていない。Vercel は main しかビルドしないので、Vercel の Bun での `--frozen-lockfile` は本番デプロイが最初の検証になる。【推測】形式が同じなので通る見込み | #1136 のマージ前に、きれいな clone で `bunx bun@<直近の Vercel ビルドログの Bun の版> install --frozen-lockfile`（決定に書かれた手順）。失敗しても本番は前のデプロイのまま。スキーマ変更を含まないので安全側 |
| M4 | `ci.yml:317-319`（Security Scan） | 【未確認】`bun audit --audit-level=critical` は、ガードに止められて流せませんでした。GitHub の勧告 API も使えませんでした。Security Scan は必須の検査ではない（保護の一覧で確認）ので、落ちてもマージは止まらず、main が赤くなる | base の付け替え前に手元で `bun audit --audit-level=critical` を流す（読み取りだけ）。追加は three・R3F・buffer・base64-js・its-fine・react-use-measure・suspend-react・scheduler 0.28.0・zustand 5.1.0・fflate 0.8.3 と型のパッケージ |
| M5 | PR #1117（Storybook、ドラフト） | 【確認】#1117 は `bun.lock` を +370/−5、`package.json` を +7 変える。#1136 と後先になったほうで `bun.lock` が衝突する | 後から入るほうは、main の `bun.lock` を取ってから `bun add` をやり直す（手でマージしない。CLAUDE.md の5） |
| M6 | リポジトリの設定（squash・merge commit・rebase のどれも可） | 【推測】#1105 を squash で入れると、#1136 を main に付け替えたときに #1105 のコミットが重複して見え、衝突しやすい | #1105 は merge commit で入れる（main の履歴はこれまでも merge commit）。squash にするなら #1136 は `git rebase --onto` で載せ替える |

## 3. あとでよい指摘

| # | 場所 | 何が起きるか | どうするか |
|---|------|------------|-----------|
| L1 | `package.json:112, 142` | `three` は `0.187.0` で固定、`@types/three` は `^0.187.0`。0.x のキャレットなのでパッチしか動かないが、そろっていない | 本実装の PR で `@types/three` も固定にする |
| L2 | `bun.lock`（`@react-three/fiber/zustand` 5.1.0、`@react-three/fiber/scheduler` 0.28.0） | 【確認】アプリの zustand は 5.0.0、R3F は `^5.0.3` を求めるので、3D のチャンクに zustand が別に1つ入る。scheduler も R3F 用が別に入る | 別の依存の PR で zustand を 5.0.3 以上に上げれば1つにまとまる（数 KB） |
| L3 | `@types/three` の推移的な依存 | 【確認】`@dimforge/rapier3d-compat`（7.4 MB、Apache-2.0、WASM）と `meshoptimizer` が node_modules に入る。型のための依存で、ビルド済みのクライアントのチャンクに `rapier`・`MeshoptDecoder`・`.wasm` の文字列は無い | 対応不要。決定の「WASM を入れない」は守られている |
| L4 | `drizzle/0039_ai_employees.sql`（コミット `111c8695`） | 【確認】作り直しのあと、SQL に `ENABLE ROW LEVEL SECURITY` の2行を手で足している（過去の 20 本以上と同じやり方）。`when` は変わっていない。その間に 0039 を流した手元の DB では、`--check` が「SQL changed after it was applied」を出し、RLS が入らない | 本番と CI には影響なし。手元の DB は作り直す |
| L5 | `public/manifest.json:14-32` | 【推測・一般的な挙動】インストール済みのアプリは、マニフェストの中身が変わったときにだけ更新を取りに行く。iOS は入れ直すまでアイコンと名前を更新しない | アイコンの絵を変えるときはファイル名も変える（例：`icon-192.v2.png`） |
| L6 | `components/features/ai-employees/office-immersive.tsx:499-509` | 【推測】`OfficeCanvas3D` の外にエラー境界が無いので、WebGL のコンテキストが作れない端末では 2D に戻らず画面が落ちる | 本実装で、失敗したら `threeD` を false に戻す境界を置く（UI の範囲。E2E を足すなら安定性にも効く） |
| L7 | `ci.yml:10-13` | 【確認】`deployments: write`・`pull-requests: write` は、デプロイのジョブがコメントアウト（`ci.yml:321-369`）なので使われていない | 別 Issue で `contents: read` だけにする（この2つの PR には入れない） |

---

## 見てほしい点への答え

### 1. #1136 を CI で確かめる方法

| 案 | 手間 | 危うさ | 評価 |
|----|------|--------|------|
| (a) #1105 のマージ後に base を main に替える | 小。main を取り込んで push するだけ | 付け替えだけでは CI が動かない（M2）。#1105 が squash だと衝突（M6） | 推奨 |
| (b) ブランチ名を `feat/**` にする | 大 | 絞り込みは base の名前なので、変える必要があるのは #1105 のブランチ名。#1136 の名前を変えても効かない。クラウドのセッションのブランチの付け替えになる | 勧めません |
| (c) `branches` を広げる（`'claude/**'` を足す、または絞り込みを外す） | 中。別 Issue・別 PR で main に入れ、#1105 のブランチに main を取り込み、#1136 に push | フォークの PR は main 向けで今も動いており、シークレットも使っていないので、安全面の増分は無い。CI の実行回数は増える（公開リポジトリなので費用は無い） | 今回のためだけなら不要。判断が必要な点に挙げます |
| (d) 同じブランチから main 向けの確認用ドラフト PR をもう1つ作る | 小。ファイルの変更なし | スキーマと依存が1つの PR で緑になる。承認0でマージできる設定なので、ready にすると誤ってマージされうる。ほかのセッションが混乱する | 急ぐときだけ。ドラフトのまま、確認後すぐ閉じる |

検証用の PR に CI が足すものは、きれいなランナーでの `--frozen-lockfile`（Bun 1.4.3）、`bun audit`、スモークの E2E（3D は通らない）です。手元で test・typecheck・lint・arch:check・build が通っており、`bun run i18n:check` も今回こちらで流して通りました（ja・en のキーは一致）。(a) を待ち、それまでは M3 と M4 を手元で流せば足ります。

### 2. 依存の追加の確かさ

- 【確認】`git diff 111c8695..38a36b2a -- bun.lock package.json`：追加は直接の3つ（`@react-three/fiber` 9.8.2、`three` 0.187.0、`@types/three` 0.187.0）と推移的な依存（`its-fine`、`react-use-measure`、`suspend-react`、`buffer`、`base64-js`、`@types/webxr`、`@types/react-reconciler`、`@types/stats.js`、`@tweenjs/tween.js`、`meshoptimizer`、`@dimforge/rapier3d-compat`、R3F の下の `@babel/runtime` 7.29.10・`scheduler` 0.28.0・`zustand` 5.1.0）。
- 【確認】既存の行で変わったのは1つだけです。最上位の `fflate` が 0.8.2 → 0.8.3（`@types/three` が `~0.8.3` を求めるため）になり、`jspdf/fflate` 0.8.2 が入れ子で足されました。fflate を使うのは jspdf だけで（アプリのコードに直接の import は無い）、jspdf が解決する版は 0.8.2 のままです。
- 【確認】`package.json` の3行と `bun.lock` の workspaces の3行は一致。main の `bun.lock` は #1105 のものと同じ（main 側で依存は動いていない）。追加パッケージにインストール時のスクリプトは無い。
- 【確認】peer：`react >=19 <19.4`・`three >=0.156` は満たしている。`expo` 系・`react-native`・`react-dom` は `optionalPeers` で、既存の better-auth などと同じ形。Bun は peer の不一致で警告は出すが、`--frozen-lockfile` のインストールは失敗させない【一般的な挙動】。将来の種は M1（Next の中の React）のほうです。
- 【確認】ライセンス：three・R3F・追加でバンドルに入るものは MIT（`ieee754` は既存で BSD-3-Clause）。Apache-2.0 の rapier3d-compat は型のための依存で、配布物に入りません。

### 3. Security Scan

- 【確認】監査のゲートは `ci.yml:302-319` の1つだけ。条件は `bun audit --audit-level=critical`、`continue-on-error` なし、必須の検査ではない。#1105（`111c8695`）では成功（22 秒）。
- 【未確認】追加したパッケージに critical の勧告があるかは確かめられていません（M4）。

### 4. ビルド

- 【確認】チャンクの大きさを検査するジョブはありません。`lighthouse.yml` は本番の公開5ページを1日1回測るだけで、点数では落ちません（`lighthouse.yml:1-7`）。3D はサインインの奥なので測定の対象外。引っかかるものは無いです。
- 【確認】手元のビルド出力（`38a36b2a`）：`WebGLRenderer` を含むチャンクは `.next/static/chunks/18cg1z9l_zt75.js`（937,489 バイト）の1つ。`.next/diagnostics/route-bundle-stats.json` の 49 ルートのどの `firstLoadChunkPaths` にも入っていません。参照しているのは、遅延読み込みを登録する 217 バイトのチャンク（`/[locale]/office` の First Load に入る）と、office ページの `react-loadable-manifest.json` だけ。`.next/server` には three のコードが無く、サーバー側の関数の大きさには影響しません。
- 確かめる方法：ビルドのあとに `grep -l WebGLRenderer .next/static/chunks/*.js` で出たファイル名を `route-bundle-stats.json` で探し、0 件であること。本実装に進むなら Build ジョブに1ステップ（約1秒）で足せます。
- 時間：【確認】CI の `Build application` は #1105 で 64 秒、型チェックは 31 秒。手元の `38a36b2a` のビルドは 70.4 秒（Turbopack 33.1 秒・TypeScript 34.2 秒）ですが、機械が違うので比べられません。【推測】増分は数秒。#1136 の最初の CI で、この2つのステップを基準と見比べてください。`@types/three` は `tsconfig.json` に `types` の指定が無いので全体の型チェックに読み込まれ、lefthook の `bun tsc --noEmit` にも乗ります。

### 5. E2E で 3D を確かめるか

- 【確認】Playwright は 1.64.1（Chromium 156）。CI は `chromium` だけ、`@smoke` だけ、リトライ1回、ワーカー2（`playwright.config.ts:14-18`）。office を通る E2E は今ありません。
- 【推測】GPU の無いランナーでは SwiftShader でのソフトウェア描画になります。自動の切り替えは Chrome で廃止の方向なので、明示するなら `--enable-unsafe-swiftshader`、`--use-angle=swiftshader`、必要なら `--ignore-gpu-blocklist` を、そのスペックだけ `test.use({ launchOptions: { args: [...] } })` で渡します。CI のランナーでは未検証です（手元でソフトウェア描画が動いた記録は決定にあります）。
- やる価値：検証の PR には足さないでよいと考えます。本実装に進むなら1本だけ勧めます。理由は M1 で、Next の中の React と R3F の食い違いを捕まえられるのは、本番ビルドで Canvas を載せるテストだけだからです。見るのは「3D に切り替える → `canvas` が出る → `pageerror` と CSP 違反が無い（`test/e2e/csp.spec.ts:13-27` の `watchViolations` を使える）」まで。コマ数・歩く時間・スクリーンショットの比較は見ない（ソフトウェア描画で毎秒 7〜58 コマと揺れるため）。見込みは E2E ジョブに +5〜10 秒。

### 6. #1105 のマニフェストとアイコン

- 【確認】`/manifest.json` は `proxy.ts:144` の matcher に掛かります。i18n は飛ばし（`lib/i18n/middleware.ts:40`）、保護されたページではないのでサインインへのリダイレクトも無く、レート制限は page の枠（1分 300 回）。`getCacheHeaders` は `.json` を静的ファイルと見ないので（`lib/middleware/cache-headers.ts:1, 24-31`）、`Cache-Control: public, max-age=0, must-revalidate` が付きます。CSP は `default-src 'self'` が `manifest-src` の代わりに効きます。
- 【確認】`/images/app/*.png` は matcher の外。`vercel.json:40-58` のセキュリティのヘッダーだけが付きます。【推測】キャッシュは Vercel の静的ファイルの既定（`public, max-age=0, must-revalidate` と ETag）。
- 【確認】`app/apple-icon.png` は matcher に掛かりますが、`.png` なので `getCacheHeaders` は何も付けず、Next.js に任せます（`cache-headers.ts:21-26` のコメントどおり）。
- 【確認】サービスワーカーは無い（`lib/routes/app-install.ts:6-7`）。HTTP のキャッシュで古いマニフェストが残り続ける経路は見当たりません。残るのは OS 側（L5）。`id: "/office"` があるので、`start_url` を変えても別のアプリにはなりません。
- 【未確認】本番の実際のヘッダーは、このセッションのプロキシが 403 を返して読めませんでした。マージ後に `curl -sI https://diagnoleads-v2.vercel.app/manifest.json` と `/images/app/icon-192.png` で `cache-control` と 200 を確かめてください。

### 7. マイグレーション 0039

- 【確認】`when`：#1105 は 1794578049281（2026年11月13日）。ほかの PR の 0039 は #902 が 1793235468530、#858 が 1793201352513、#822 が 1794269655358、#795 が 1794110918840 で、すべて #1105 より古い。main のジャーナルは 0038（1793188121620）まで。
- 【確認】場面ごとの `--check` の動き（`db-migration-ledger.ts` を読んだ結果）：

| 本番の状態 | #1105 のブランチで `--check` | 対応 |
|-----------|------------------------------|------|
| 0038 まで | 止まらない。`Would apply: 0039_ai_employees` | 流してよい |
| ほかの PR の 0039 が先に入っている | 止まらない。警告「台帳にあるが、このジャーナルに無い」（S2） | 流さない。その PR のマージを待って main を取り込み、0040 として作り直す |
| #1105 の 0039 を流したあと、ほかの PR のブランチで `--check` | 停止（exit 1）。古い `when` は飛ばされるため | 仕組みどおり。その PR は main を取り込んで作り直す |

- 0015 についての注意書き（`WHEN_OUT_OF_ORDER`）は既存のもので、無視してよいです。
- 流す前：`.claude/rules/db-schema.md:16-18` のとおり、`dl_readonly` で `--check`、長いトランザクションが無いこと、Session pooler（5432）。0039 は新しい表2つと、`organizations`・`users` への外部キー4本・索引3本・RLS の有効化。【推測】既存の表に効くのは外部キーを足すときの短いロックだけで、`lock_timeout` 5 秒で待ちきれなければ全部戻ります。
- 【確認】CI では毎回まっさらな DB に全マイグレーションを流しており、`111c8695` で DB Integration Tests と E2E が緑です。

### 8. main へ入れる順番の案

1. **#1105 を仕上げる**：main との差は `ci.yml` のコメントと `package.json` の `verify` スクリプトだけ（drizzle と `bun.lock` は同じ）。必須7検査が緑、`security-specialist` のレビュー済みであること。
2. **本番で `--check`**：`Would apply: 0039_ai_employees` だけで警告なし（S2）。
3. **オーナーの承認 → 本番に 0039**：終わったらもう一度 `--check` で `Would apply: nothing`。
4. **#1105 を merge commit でマージ**：main の CI（push。カバレッジを含めて約8分）と、Vercel の Production デプロイの成功（直近は push から1分以内に `success`）。本番で `/manifest.json` とアイコンが 200、`/ja/office` が開くこと。
5. **ほかの 0039 の PR（#902・#858・#822・#795）に知らせる**：main を取り込むとジャーナルが衝突するので、作り直しになります。
6. **#1136**：main を取り込む → base を main に替える → push → CI（必須7検査、Security Scan、E2E）。Build と型チェックのステップの時間を基準（64 秒・31 秒）と見比べる。M3・M4 を済ませる。
7. **#1136 をマージ（入れると決めた場合）**：Vercel のデプロイ成功まで見届ける。本番で 3D に切り替え、three のチャンクが切り替えたときにだけ読まれること、CSP 違反が 0 件であること。失敗したら本番は前のデプロイのままなので、決定 `2026-10-21-frozen-lockfile-on-vercel` の手順で直す。

---

## 今のままでよい点

- 3D の読み込み方（`office-immersive.tsx:77` の `next/dynamic`・`ssr: false`、型だけの import）。three を値で読むのは `office-3d/` の2ファイルだけです。
- `test/unit/components/ai-employees/office-3d.test.ts` は純粋な関数だけを読み、three を import しません。シャードへの影響はありません。
- カバレッジ：main の直近は全体で行 81.56%。しきい値には遠く、3D の部品が未テストでも main の Test Coverage Report は落ちない見込みです。
- マニフェストの置き方と、単体テスト（`test/unit/app/app-manifest.test.ts`）での裏付け。
- 0039 の作り直しのやり方（番号を付け替えず `db:generate` で作り直し）と、RLS を SQL に手で足す書き方。
- 依存とスキーマを別の PR に分けたこと。

## 判断が必要な点

1. **検証の PR（#1136）を main に入れるか**：入れると、検証用のパネル（`office-immersive.tsx:715-775`）と 3D の切り替えボタンが本番の出社の画面に出ます。CI・デプロイの面では入れられます。入れないなら (a) の付け替えも要らず、本実装の PR で CI に掛ければ足ります。
2. **`ci.yml` の `branches` を広げるか**：コメント（`ci.yml:7`）の意図は「積んだ PR も検査する」ですが、クラウドのセッションのブランチ（`claude/**`）が base だと当たりません。直すなら別 Issue・別 PR で、`'claude/**'` を足すか絞り込みを外すか。実行回数は増えます。
3. **本実装で 3D の E2E を1本足すか**：E2E ジョブ（必須ではない）に +5〜10 秒の見込み。得られるのは、Next の更新で 3D が壊れたときに気づけることです。

## 確かめられなかったこと

- `bun audit`（ガードが停止）と GitHub の勧告 API（セッションの制限で 403）。
- 本番の応答ヘッダー（プロキシが 403）。
- three を足す前後のビルド時間・型チェック時間の差（ビルドは流していません）。
- Vercel の今の Bun の版（決定の記録 1.3.14 を前提にしています）。
- CI のランナーで WebGL のソフトウェア描画が安定して動くか。
- 本番の台帳の今の状態（DB には触れていません）。
