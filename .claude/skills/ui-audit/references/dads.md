# DADS の値（管理画面）

管理画面（`.dl-admin` の中）で、直し方の値はここに従う（決定 `2026-10-24-admin-dads`）。色の置き換えは `app/globals.css` の `html:has(.dl-admin)` にある。公開サイトとビルダーの診断には当てない（SKILL.md の「対象と優先順位」）。ただし「グラフ」の節は、どの画面のグラフにも当てる。

## 色

- キーカラーは Green（`brand-*`）、灰は Solid Gray（`gray-*`）
- 文字の色は3つの役割にする
  - 主：`gray-900`
  - 補足：`gray-600`〜`gray-700`
  - 控えめ：`gray-500`（Solid Gray 536、白に 4.5:1）
- `gray-500` より薄い色を文字に使わない。`gray-400`（Solid Gray 420、3:1）は枠線とアイコンだけに使う
- ダークモードの値は決めていない。`text-foreground`・`text-muted-foreground`（`globals.css` でダークの値に切り替わる）を使い、`text-muted-foreground` より薄い文字にしない
- コントラスト：文字は背景と 4.5:1 以上、枠線・アイコン・グラフの線など文字以外は 3:1 以上

## 文字

- 太さは 400 と 700 の2つ（DADS のトークンにあるのはこの2つ）。見出しと強調は 700。500・600・800・900 は 400 か 700 に寄せる
- 本文 16px 以上。14px は補足だけ、14px 未満は使わない。本文の行間 1.5 以上
- リンクの下線は、DADS のガイドラインによる（決定の本文には無い）

## ボタンとフォーカス

- 塗りのボタンは1画面に原則1つ。押せる範囲は 44px 以上。色の違いだけで重要度を示さない
- フォーカスは黒の outline と Yellow-300 の二重（`app/globals.css`）。DADS が「変えてはいけない」としているので、部品ごとの `focus-visible:ring-*` で上書きしない

## 影と角丸

- 影は、ダイアログ・メニューなど重なって出る部品だけに使う。ほかは枠線で区切る
- 角丸は DADS の段階から選ぶ。Tailwind v4 の既定のクラスとの対応は次のとおり。任意値（`rounded-[10px]`）は使わない

  | DADS | 4 | 6 | 8 | 12 | 16 | 24 | 32 | full |
  |---|---|---|---|---|---|---|---|---|
  | Tailwind | `rounded-sm` | `rounded-md` | `rounded-lg` | `rounded-xl` | `rounded-2xl` | `rounded-3xl` | `rounded-4xl` | `rounded-full` |

## グラフ

決定 `2026-10-24-chart-library-apexcharts` と、DADS の「ダッシュボードデザインの実践ガイドブック」による。管理画面に限らず、どの画面のグラフにも当てる。ただし、灰色の値（`gray-400`・`--color-gray-400`）は管理画面の値。

- ApexCharts だけを使う。設定は `components/charts/` の部品を通して変え、画面で `react-apexcharts` を直接使わない
- グラデーション・3D・影を使わない
- 色は1〜5色で、強調は1つ。ほかの系列は `gray-400` 以上の濃さの灰色（背景と 3:1 以上）にする。ApexCharts の色は JS で渡すので、`components/charts/` の部品で CSS 変数（`--color-gray-400` など）の値を渡す
- 色だけで区別しない。系列は、線の形（`stroke.dashArray`）・点の形（`markers.shape`）・凡例の文字でも区別する
- 棒の原点は 0。データの更新日を書く
