---
id: 2026-10-24-chart-library-apexcharts
date: 2026-10-24
category: UI
title: "グラフは ApexCharts に寄せ、使っていない recharts を依存から外す（#486）"
status: active
superseded_by: []
issues: [486, 53, 317]
paths: ["components/charts/**"]
---

### [UI] グラフは ApexCharts に寄せ、使っていない recharts を依存から外す（#486）
- **日付**: 2026-10-24
- **決定**: オーナー判断。グラフのライブラリは ApexCharts（`apexcharts`・`react-apexcharts`）に寄せる
  - 使っていない `recharts` は依存から外す。作業は #53 の「使っていない依存を外す」で行う（`package.json` と `bun.lock` を変える PR #512 の後。#512 は 2026-10-24 にマージ済み）
  - shadcn/ui の Chart（`components/ui/chart.tsx`）は入れない。UI の部品は shadcn/ui に一本化する（決定 2026-10-09-ui-modern-components）が、グラフだけはその例外にする
- **理由**:
  - 画面で使っているのは ApexCharts だけ。`recharts` の import は0件
    - `components/charts/` の部品（6ファイル）が ApexCharts で描く。`react-apexcharts` を読み込むのは `components/charts/apex-chart.tsx` の `ApexChart` だけで、`next/dynamic`（ssr: false）で読み込み、CSP の nonce（`chart.nonce`）を付ける（PR #526。#317）
    - ダッシュボード：`components/dashboard/studio-sections.tsx` の AreaChart（`components/dashboard/` の `kpi-card.tsx`（SparkAreaChart）と `lead-chart.tsx` は、どこからも使われていない。#469 で消す予定）
    - 分析ページ：`app/[locale]/(dashboard)/analytics/page.tsx` の AreaChart・DonutChart と、そこから読み込む `components/analytics/response-time-chart.tsx`・`score-distribution-chart.tsx` の BarChart
  - #410（PR #415）でも「グラフのライブラリは変えない（ApexCharts のまま）」と決めている。寄せる先を変えないので、作業は使っていない依存を外すだけで済む
  - #486 の6つの観点で比べた結果（2026-10-24 の main）
    - #423 の DADS とガイドブックの決まり：ApexCharts の設定で書ける。データの更新日はグラフの外（カードの文言。`locales/`）に書くので、ライブラリによらない
      - グラデーションをやめる：`fill.type: 'solid'`。今の `area-chart.tsx` などの `type: 'gradient'` は、設定の差し替えで直せる（#494）
      - 影と 3D：`chart.dropShadow` は既定で無し。3D のグラフは無い
      - 色を1〜5色にする：`colors` に渡す
      - 原点を 0 にする：`yaxis.min: 0`。棒は `bar-chart.tsx` の `integerAxis` が 0 から
      - 色だけで区別しない：系列ごとの線の形（`stroke.dashArray`）・点の形（`markers.shape`）・棒の模様（`fill.type: 'pattern'`）・凡例の文字
    - CSP：ApexCharts は描画時に `<style>` を足すので、nonce を渡す必要がある。`ApexChart` が `chart.nonce` で渡している（PR #526）。shadcn/ui の Chart も色の CSS 変数を `<style>`（`ChartStyle`）で出すので、移しても nonce の手当ては要る
    - shadcn/ui の部品・#423 の DADS のトークン・ダークモードとのそろえやすさ：CSS 変数で色を受け取る shadcn/ui の Chart のほうがそろえやすい
      - ApexCharts は色を JS の値で受け取る。#492 の共通の定義の値を `colors` に渡す
      - ダークモードは、面・棒・ドーナツなどの部品の `useIsDarkMode` と、`app/globals.css` の `.apexcharts-*` の上書きで対応している
    - バンドルの大きさ（目安）
      - `react-apexcharts`＋`apexcharts`（5.3.6）：minify 後に約580KB、gzip で約157KB
      - `recharts`（3.5.1。面・棒・円）：約400KB、約118KB
      - 計り方：`bun build --minify` で React を除いて計った。Next.js のビルドの値ではない
      - ApexCharts は `next/dynamic` で分かれた chunk に入り、グラフのあるページでだけ読まれる
      - `recharts` は import されていないのでバンドルに入っていない。外してもバンドルは変わらない見込み。前後の比べは #53 で `build:analyze` を使って行う（#7）
    - 移す手間：ApexCharts に寄せるなら、移す画面は無い。shadcn/ui の Chart に移すなら、画面の3種類（面・棒・ドーナツ）と `test/unit/components/charts/` のテストを書き直す
    - #411 の段2〜6 と #50 のグラフ：どちらのライブラリでも描けない形は見当たらない
      - #411：段2 の日ごとの訪問者数・ページビューは面グラフ（今の AreaChart）、段3 のページごとの数と割合は棒か表、段4 はインサイトの文、段5 は GA4 とのつなぎ、段6 はダッシュボードのカード
      - #50 の custom-reports：グラフの種類はまだ決まっていない。ApexCharts は線・面・棒・円・ドーナツ・ヒートマップ・散布図・ツリーマップ・漏斗（`plotOptions.bar.isFunnel`）を描ける
- **却下案**: shadcn/ui の Chart（Recharts ベース）に移す。shadcn/ui の部品とトークンにはそろえやすく、バンドルも少し小さい。しかし、画面で使っている3種類（面・棒・ドーナツ）と `components/charts/` のテストを書き直す手間がかかり、#423・#411・#50 のグラフの作業がその移行を待つことになる。CSP の nonce の手当ても、移した先で要る
- **ルール**:
  - グラフは `components/charts/` の部品を使うか、そこに部品を足して描く。画面から `react-apexcharts` を直接 import しない（今もそうなっている。機械の検査は無いので、PR で確かめる）
  - `components/charts/` に足す部品も、`components/charts/apex-chart.tsx` の `ApexChart` を通して描く。通さないと CSP の nonce が付かず、本番でグラフのスタイルが止まる
  - CSP の nonce の扱いは、決定 2026-10-24-csp-runtime-styles-and-images（#317。PR #526）に従う。この決定は nonce について新しい決まりを足さない
  - `recharts` と shadcn/ui の Chart を入れ直すときは、Issue で理由を残し、この決定を置き換える
