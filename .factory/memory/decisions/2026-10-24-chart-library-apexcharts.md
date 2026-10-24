---
id: 2026-10-24-chart-library-apexcharts
date: 2026-10-24
category: UI
title: "グラフは ApexCharts に寄せ、使っていない recharts を依存から外す（#486）"
status: active
superseded_by: []
issues: [486, 53]
paths: ["components/charts/**"]
---

### [UI] グラフは ApexCharts に寄せ、使っていない recharts を依存から外す（#486）
- **日付**: 2026-10-24
- **決定**: オーナー判断。グラフのライブラリは ApexCharts（`apexcharts`・`react-apexcharts`）に寄せる。使っていない `recharts` は依存から外す（作業は #53 の「使っていない依存を外す」）。shadcn/ui の Chart（`components/ui/chart.tsx`）は入れない
- **理由**:
  - 画面で使っているのは ApexCharts だけ。`components/charts/` の6ファイルが `react-apexcharts` を `next/dynamic`（ssr: false）で読み込み、ダッシュボード（`components/dashboard/studio-sections.tsx`）と分析ページ（`app/[locale]/(dashboard)/analytics/page.tsx`、`components/analytics/*-chart.tsx`）がそれを使う。`recharts` の import は0件
  - #410（PR #415）でも「グラフのライブラリは変えない（ApexCharts のまま）」と決めている。寄せる先を変えないので、作業は使っていない依存を外すだけで済む
- **却下案**: shadcn/ui の Chart（Recharts ベース）に移す。shadcn/ui の部品とトークンにはそろえやすく、#317 の ApexCharts の nonce の件もなくなるが、画面で使っている3種類（面・棒・ドーナツ）と `components/charts/` のテストを書き直す手間がかかり、#423・#411・#50 のグラフの作業がその移行を待つことになる
- **ルール**:
  - グラフは `components/charts/` の部品を使うか、そこに部品を足して描く。画面から `react-apexcharts` を直接 import しない（今もそうなっている）
  - `recharts` と shadcn/ui の Chart を入れ直すときは、Issue で理由を残し、この決定を置き換える
  - ApexCharts が描画時に足す `<style>` の CSP nonce は #317 で扱う（この決定で残る課題）
