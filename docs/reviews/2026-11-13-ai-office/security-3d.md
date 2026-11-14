> **これは記録です。** `security-specialist`（AI）が 2026年11月13日に読み取り専用で行ったレビューの報告を、そのまま残しています。
> 対象：PR #1136 の 3D の検証（依存の追加・CSP・検証用のパネル）。見たコミット：`38a36b2a`。
> 行番号と指摘は、その時点のコードのものです。直したもの・残っているものは [README.md](./README.md) を見てください。
> 【推測】と書かれた項目は、実行して確かめたものではありません。

# セキュリティレビュー：コミット `38a36b2a`（PR #1136、3D オフィスの検証）

## 総評
- マージを止める指摘はありません。API・スキーマ・権限・CSP に変更は無く、3D に出るのは 2D と同じデータです。
- ただし、この lockfile に対する依存の監査（`bun audit`）は、CI でもこのレビューでも走っていません。main に入れる前に結果を確かめてください。
- 検証用のパネルは、セキュリティ上は誰に見せても問題ありません。本番の全テナントに出してよいかは、製品としての判断です。

## 1. マージを止めるべき指摘
ありません。

## 2. 直したほうがよい指摘

| 場所 | 何が起きるか | どう直すか |
|---|---|---|
| `.github/workflows/ci.yml:3-8`、`:317-319` | PR #1136 の base は `claude/zealous-carson-xunn0r` で、CI の対象（`main`・`develop`・`feat/**`）に当たりません。コミットの check-runs は 0 件でした。新しい依存を入れた lockfile が、監査（`bun audit --audit-level=critical`）もテストも通らないまま積まれています。このレビューでも `bun audit` はガードに止められ、実行できていません。 | main 向けの PR にする前に、手元で `bun audit` を流して結果を PR に書く。または base を CI の対象にして緑を見届ける。 |
| `components/features/ai-employees/office-immersive.tsx:716`（パネル）、`:821-824`（3D ボタン）、`:299-301`（3 キー） | main に入ると、「3D（検証）」のボタンとパネルが、出社の画面を開ける全員（`canManage` の無い人を含む全テナント）に出ます。データの漏れや書き込みはありません（下の 3）。ただし、見せかけの状態は役割ごとに state に残ります（`:151-152`、`:406-407`）。別の AI社員を選ぶとパネルが消えても、3D の灯りと表情は見せかけのままで、DOM の実際の状態（`:868`）と食い違います。「要確認」の AI社員を「作業中」に見せたまま、本人が忘れることがあり得ます。影響はその人のブラウザの中だけです。 | 検証のまま main に入れるなら、パネルを開発時だけ（`process.env.NODE_ENV !== 'production'` か公開フラグ）に絞る。本番にも出すなら、3D を切ったとき・選択を変えたときに `trialStatus`／`trialEvent` を空に戻す。`canManage` での絞り込みは、セキュリティ上は要りません。 |

## 3. 確認だけ（問題が無かった点と、何を確かめたか）

**依存（観点 1）**
- **ライフサイクルスクリプト**：追加・更新された 16 パッケージの `package.json` を調べ、`preinstall`・`install`・`postinstall` を持つものはありませんでした。`@tweenjs/tween.js` に `prepare` がありますが、レジストリからの導入では走りません。`package.json` に `trustedDependencies` も無いので、Bun は依存のスクリプトを実行しません。
- **本番に入る推移的な依存**：`its-fine`・`react-use-measure`・`suspend-react`・`use-sync-external-store`・`zustand`（入れ子の 5.1.0）・`scheduler`（入れ子の 0.28.0）・`@babel/runtime` です。`base64-js`・`buffer`・`ieee754` は R3F の React Native 用ビルドだけが import していて、Web のバンドルには入りません。
- **`@types/three` の広さ**：dev の型定義なのに、`@dimforge/rapier3d-compat`（WASM の物理エンジン）・`meshoptimizer`（WASM）・`@tweenjs/tween.js`・`fflate` を実行時の依存として持ち込みます。アプリからの import は grep で 0 件（`three` と `@react-three/fiber` を読むのは `office-3d/` の 2 ファイルだけ）なので、バンドルには入りません。今後これらを import すると CSP に当たります。
- **`fflate`**：巻き上げ先が 0.8.2 から 0.8.3 に変わりましたが、`jspdf` は入れ子で 0.8.2 のまま固定されています（`bun.lock` の `jspdf/fflate`）。PDF の出力には影響しません。
- **ライセンス**：MIT が中心で、`ieee754` が BSD-3-Clause、`rapier3d-compat` が Apache-2.0 です。
- **既知の脆弱性**：上のとおり `bun audit` を実行できていません。three 0.187.0 と R3F 9.8.2 について、既知の問題が無いとは私からは言えません。
- **React の上限**：R3F 9.8.2 の peer は `react >=19 <19.4` で、reconciler を自前で同梱しています。将来 React を 19.4 以上に上げるときは、R3F を先に上げる必要があります。

**CSP（観点 2）**
- **three と R3F の本体**：`three.module.js`・`three.core.js`・R3F の Web 用 2 ファイルを、`eval`・`new Function`・`WebAssembly`・`new Worker`・`createObjectURL`・`importScripts`・`XMLHttpRequest`・`WebSocket`・`sendBeacon`・`innerHTML` で検索しました。コメントを除くと、`fetch` が 2 か所あるだけです（`three.core.js:45625` の `FileLoader`、`:51026` の `ImageBitmapLoader`）。
- **今回の使い方**：ローダーも `useLoader` も使っていません。テクスチャは `document.createElement('canvas')` から作る `CanvasTexture` だけなので、通信・blob・Worker・WASM は発生しません。動的チャンクは同一オリジンのスクリプトで、`'self'` と `'strict-dynamic'` で読めます。本番の CSP（`lib/middleware/csp.ts:61-73`）のまま動く作りで、手元の「違反 0 件」と合います。
- **将来入れるもの**（three 同梱の `examples/jsm` で確かめた分）：

| 入れるもの | 要るもの |
|---|---|
| glTF（`GLTFLoader`） | 同一オリジンの `.glb` の取得は今のままで通ります。テクスチャを埋め込んだ `.glb` は、blob の URL を `ImageBitmapLoader` が `fetch` します（`GLTFLoader.js:2715`、`:3445`）。`connect-src` に `blob:` が要ります（今は `default-src 'self'` か `'self'` + GA）。 |
| Draco（`DRACOLoader`） | blob から Worker を作ります（`DRACOLoader.js:430`、`:444`）。`worker-src blob:` と、`script-src` の `'wasm-unsafe-eval'` が要ります。デコーダーのファイルは自前で配る必要があります。 |
| KTX2（`KTX2Loader`） | Draco と同じです（`KTX2Loader.js:342`、`:347`、Basis の WASM）。 |
| meshopt | `WebAssembly.instantiate` を使うので `'wasm-unsafe-eval'` が要ります。Worker を使うなら `worker-src blob:` も要ります。 |
| drei | 未導入のため一般的な知識で、導入時に実物で確かめてください。`useGLTF` は既定で外部 CDN の Draco デコーダーを取りに行きます。`Text`（troika）は blob の Worker と外部のフォント取得、`Environment` の preset は外部の HDRI 取得を使います。推移的な依存も広い（three-stdlib、hls.js、mediapipe など）です。 |

- 決定のルール「入れるなら `security-specialist` のレビュー」は妥当です。`'wasm-unsafe-eval'` と `worker-src blob:` は管理画面全体の CSP を緩めるので、入れるなら 3D の画面だけに絞れるかを先に検討してください。

**表示する文字（観点 3）**
- **名札**：`office-canvas-3d.tsx:125` の `fillText(name, 256, 50, 480)` は描画だけで、HTML・CSS・URL として解釈されません。`context.font` は定数です。
- **名前の検査**：`PLAIN_TEXT`（`lib/utils/plain-text.ts:10`）は、制御文字に加えて書式文字（双方向の上書き・ゼロ幅）とサロゲートも拒みます。名札での見た目の偽装も入口で止まっています。
- **頭上の印**：`robot-3d.tsx:54`・`:57` の文字と色は、定数 `ICON_TEXT`・`ICON_COLORS` から来ます。
- **`t()` のキー**：`trial3d.events.${event}` は `TRIAL_EVENTS`、`status.${status}` は `TRIAL_STATUSES` で、どちらも `as const` の定数です（`office-immersive.tsx:80-81`）。ja・en の両方にキーがあります。
- **`{name}` の差し込み**：`t('trial3d.note', { name })` は React のテキストノードになります。`t.rich` ではないので、タグとして解釈されません。

**検証用のパネル（観点 4）**
- `onClick` は `setTrialStatus`・`setTrialEvent` だけです（`office-immersive.tsx:734-737`、`:756-760`）。
- `trialStatus`・`trialEvent` を読むのは、`floor3d` の組み立て（`:406-407`）、3D への props（`:502`）、パネル自身だけです。`hire.mutate`・`update.mutate`（`:266-279`）には流れず、`localStorage` や URL にも書きません。
- 権限の無い人に余分に見えるのは、ボタンと自分の端末の fps だけです。

**情報の漏れ（観点 5）**
- 3D に渡すのは `role`・`name`・`status`・`look`・`tone` です（`office-immersive.tsx:408-414`）。すべて、この画面がすでに受け取っている `employees` の中身で、サーバーから新しく取るものはありません。
- `tone` は動きの大きさにだけ使われ、文字としては出ません。描かれるのは採用済みの AI社員だけで、2D の「空席以外」と同じ集合です。
- テスト・翻訳・決定のファイルに、シークレット・個人情報・取引先名はありませんでした。

**範囲外で気づいた点**
- `.claude/rules/help.md` は、管理画面を変えたら同じ PR でヘルプの記事も直すと定めています。検証のボタンを main に入れるなら、対象かどうかを確かめてください。

## 4. 判断が必要な点
- 検証用のパネルと「3D（検証）」のボタンを、本番の全テナントに出すか（オーナーの判断）。出すなら、上の 2 の直し方のどちらかを勧めます。
- 法務部門・情報システム部門への確認が要る点は、この差分にはありません（個人情報の送り先・保存・外部送信に変更が無いため）。

なお、ファイルの編集・コミット・GitHub へのコメントはしていません。ガードに止められたのは、`node` の実行と `bun audit` の 2 回です。
