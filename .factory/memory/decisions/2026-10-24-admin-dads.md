---
id: 2026-10-24-admin-dads
date: 2026-10-24
category: UI
title: "管理者サイトのデザインシステムを DADS にする。中身と配置は STUDIO を参考（#423, #548）"
status: active
superseded_by: []
issues: [423, 548]
paths: ["components/layout/DashboardShell.tsx", "app/[locale]/(auth)/layout.tsx", "components/studio/**", "components/ui/**"]
---

### [UI] 管理者サイトのデザインシステムを DADS にする。中身と配置は STUDIO を参考（#423, #548）
- **日付**: 2026-10-24
- **決定**（オーナー判断）:
  - 管理者サイト（ログイン後の管理画面と、ログインなどの認証画面）のデザインシステムは、デジタル庁デザインシステム（DADS）にする。画面の中身と配置は STUDIO を参考にする（ダッシュボードの #410 の作りは残す）
  - 当て方は「見た目の決まりを当てる」：部品は今の shadcn/ui（`components/ui/`）と `components/studio` のまま、色・文字・余白・角丸・影・ボタンの使い分けを DADS の値とルールに合わせる。DADS の React 部品への置き換えはしない（[2026-10-09-ui-modern-components](./2026-10-09-ui-modern-components.md) の部品の方針はそのまま）
  - キーカラーは Green（AX サイトとそろえる）。主なボタンは Green-900 `#115A36`
  - 値は公式のパッケージ `@digital-go-jp/design-tokens`（MIT）から参照する
  - グラフは「ダッシュボードデザインの実践ガイドブック」の決まりに従う
- **理由**: 生成 AI らしい装飾（グラデーション・影・色の多用）を取り除き、行政のサービスと同じ基準のアクセシビリティ（コントラスト・フォーカス・文字の大きさ）にそろえるため
- **却下案**:
  - DADS の React のコードスニペットへ部品ごと置き換える：作業量と影響範囲が大きい
  - 値を globals.css に書き写す：DADS の更新を手で追うことになる
  - キーカラーを DADS 標準の Blue、または今の青緑に近い Cyan にする：オーナーが AX サイトとそろう Green を選んだ
- **ルール**:
  - 色は `html:has(.dl-admin)` の中で `brand-*` を DADS Green、`gray-*` を DADS Solid Gray に置き換えて当てる（`app/globals.css`）。AX の公開サイト（`.ax-site`）とビルダーの診断の色は変えない
  - フォーカスは DADS の決まり（黒の outline と Yellow-300 の二重）。DADS が「いかなる場合も変更してはいけない」としているので、部品ごとのフォーカスの色で上書きしない
  - テキストは背景と 4.5:1 以上、枠線・アイコンなど文字以外は 3:1 以上。補足の文字の色は `gray-500`（Solid Gray 536）より薄くしない
  - 影は重なって出る部品（ダイアログ・メニューなど）だけに使い、ほかは枠線で区切る。グラフにグラデーション・3D・影を使わない、色は 1〜5 色、棒グラフの原点は 0、データの更新日を書く
  - 塗りのボタンは 1 画面に原則 1 つ。色の違いだけで重要度を示さない。押せる範囲は 44px 以上
  - 本文は 16px 以上（14px は補足だけ、14px 未満は使わない）、本文の行間 1.5 以上、強調は太字 700
  - Payload の CMS 管理画面（`/admin`）に当てるかは未定（オーナーに確認中）
- **参照**: https://design.digital.go.jp/dads/ 、https://www.digital.go.jp/resources/dashboard-guidebook
