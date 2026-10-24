---
id: 2026-10-24-csp-runtime-styles-and-images
date: 2026-10-24
category: Security
title: "CSP の残り：画像の出どころ・実行時の <style> の nonce・proxy の対象（#68, #317）"
status: active
superseded_by: []
issues: [68, 317, 525]
paths: ["lib/middleware/csp.ts", "lib/middleware/security-headers.ts", "lib/middleware/cache-headers.ts", "lib/csp/document-nonce.ts", "components/charts/**", "components/ui/select.tsx", "components/layout/DashboardShell.tsx", "proxy.ts"]
---

### [Security] CSP の残り：画像の出どころ・実行時の <style> の nonce・proxy の対象（#68, #317）
- **日付**: 2026-10-24
- **決定**:
  - `X-XSS-Protection` は `0`（OWASP の推奨）。proxy のヘッダーは `lib/middleware/security-headers.ts` にまとめ、vercel.json の値と同じであることをテストで確かめる
  - 本番の `img-src` は `'self' blob: data:`。GA4 が有効なときだけ、Google の CSP ガイドの画像のホスト（`GA_IMG_SOURCES`）を足す。`https:` は戻さない
  - 実行時に `<style>` を足すライブラリには、ページの nonce を渡す。nonce はページのスクリプトから読む（`lib/csp/document-nonce.ts`）
    - ApexCharts：`components/charts/apex-chart.tsx` の `ApexChart` を使う（`chart.nonce`）
    - Radix の Select：`components/ui/select.tsx` の Viewport に `nonce`
    - Radix のスクロール固定（Dialog・Sheet・Select・DropdownMenu。react-remove-scroll → get-nonce）：`DashboardShell` で `__webpack_nonce__` を設定する
  - proxy の matcher は、public/ のフォルダー（`images/`・`fonts/`）を名前で外す。拡張子では外さない。`/admin` はその区切りだけを外す
  - proxy は、ファイルに見えるパス（言語のページと API を除く）の Cache-Control を上書きしない。Next.js に任せる
  - CSP 違反の報告先と `/admin` のヘッダーは #525 に切り出した
- **理由**:
  - アプリは外部のホストの画像を出していない。外部の画像は、訪問者の追跡やページからのデータの持ち出しに使える
  - サーバーの `x-nonce` を props で渡すと、`router.refresh()` などの RSC のリクエストで新しい nonce に変わる。開いているページのポリシーは最初の nonce しか許さない
  - get-nonce の `setNonce` には、get-nonce を直接の依存に足す必要がある。グローバルの `__webpack_nonce__` は get-nonce のどのコピーにも届く。Turbopack はこの名前を置き換えない（ビルドの出力で確かめた）
  - matcher を拡張子で外すと、`/icon.svg` のようなアプリのパスと、見つからないパスにヘッダーが付かない
  - matcher を変えると、見つからない画像のパス（404）にも proxy が1年の `immutable` を付ける（`.js`・`.css` の 404 には前から付いていた）
- **却下案**:
  - get-nonce を依存に足して `setNonce` を使う：並行する PR が package.json と bun.lock を変えている。この方法でもコピーが2つになると届かない
  - ApexCharts を `injectStyleSheet: false` にして CSS を取り込む：app/globals.css を並行する PR が変えている。ApexCharts を上げるたびに CSS を追う必要がある
  - `window.Apex` で全体に nonce を設定する：設定がグローバルに隠れ、グラフの部品を読んでも分からない
  - 自前の `/api/csp-report` をこの PR で作る：無認証の公開 POST で、回数制限とログの設計が要る（#525）
- **ルール**:
  - 外部のホストの画像を出すときは、そのホストを `lib/middleware/csp.ts` に足し、`test/unit/lib/middleware/csp.test.ts` を変える
  - グラフは `ApexChart` を通して描く。`react-apexcharts` を直接 import しない
  - 実行時に `<style>` を足すライブラリを入れたら、`documentCspNonce()` を渡す。`test/e2e/csp.spec.ts` にその画面の操作を足す
  - Turbopack をやめて webpack でビルドするなら、`__webpack_nonce__` の設定を見直す。E2E のダイアログとセレクトの検査で分かる
  - public/ に新しいフォルダーを足したら、proxy の matcher にも名前を足す。足さなくても動くが、proxy が余分に動く
