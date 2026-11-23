---
id: 2026-11-13-storybook-design-system
date: 2026-11-13
category: UI
title: "デザインシステムの見本は Storybook に置く。ストーリーは stories/ に書き、アプリのビルドに入れない（#1116）"
status: active
superseded_by: []
issues: [1116, 423]
paths: ["stories/**", ".storybook/**", "components/ui/**"]
---

### [UI] デザインシステムの見本は Storybook に置く。ストーリーは stories/ に書き、アプリのビルドに入れない（#1116）
- **日付**: 2026-11-13
- **決定**（オーナー判断）:
  - デザインシステムとストーリーブックを用意する。コードの側は Storybook を正にし、Claude Design 用のデザインシステム（非公開の Artifact）を同じトークンと部品から作る
  - 範囲は、管理画面（DADS の決まりと共通部品）と AI社員オフィス。PR は AI社員オフィスの PR #1105 と分ける
- **決定**（実装）:
  - Storybook 10 を開発用の依存として入れる。枠組みは `@storybook/nextjs-vite`（Next.js 16・React 19 に対応していることを npm の peerDependencies で確かめた）。アドオンは docs・a11y・themes の3つ
  - 見た目はアプリの `app/globals.css` をそのまま読み込み、どのストーリーも管理画面と同じ `.dl-admin` の中で描く（`.storybook/preview.tsx`）。ライトとダークは、アプリと同じ `<html>` の `dark` クラスで切り替える
  - 基礎（色・文字・余白と角丸と影・フォーカス）と、共通部品（`components/ui/`）のストーリーを置く
- **理由**:
  - DADS の決まり（決定 `2026-10-24-admin-dads`）と共通部品を、動く見本として一覧できる場所が無く、画面を作るたびにコードから読み取っていた
  - 見本がアプリと同じスタイルシートと部品を読むので、見本と実物がずれない
- **却下案**:
  - `@storybook/nextjs`（webpack 版）：アプリは Vite（vitest）の設定を既に持っていて、Vite 版のほうがビルドが速い（82 ストーリーで約14秒）
  - ストーリーを部品の隣（`components/ui/*.stories.tsx`）に置く：`tsconfig.json` に入り、`next build` の型チェックにストーリーの分が混ざる
  - DADS の公式の Storybook をそのまま参照する：部品は shadcn/ui のままで、値とルールだけを DADS に合わせている（決定 `2026-10-24-admin-dads`）ので、実物と一致しない
- **ルール**:
  - ストーリーは `stories/` に置く（部品は `stories/ui/<部品の名前>.stories.tsx`、基礎は `stories/foundations/`）。題は `部品/<名前>`・`基礎/<名前>`。文言は日本語で、実在の会社や人の名前・社外秘を書かない（リポジトリは公開）
  - `components/ui/` の部品を足す・変える PR で、ストーリーも一緒に直す
  - `stories/` と `.storybook/` は `tsconfig.json` の exclude に入れ、`next build` の型チェックから外す。`bun run typecheck`（`tsconfig.test.json`）では検査する。`@/` の別名は `.storybook/main.ts` の `viteFinal` で指定している（tsconfig から外したファイルには、パスのプラグインが効かないため）
  - Storybook が `stories/` のクラスを確実に拾うよう、`.storybook/preview.css` で `@source` に指定する。`app/globals.css` に `stories/` を足さない
  - 注意：`app/globals.css` は `@import "tailwindcss"` を `source(none)` なしで読むので、Tailwind の自動の走査がリポジトリ全体に及ぶ。ストーリーだけで使うクラスも、アプリの CSS に入りうる（使われないクラスが増えるだけで、見た目は変わらない）。走査を絞るのは別の Issue で行う（2026-11-23 の `ci-devops-specialist` のレビューで分かった。それまでの記録は「`app/` と `components/` だけを走査する」と誤っていた）
  - Storybook・vite・next を上げるときは、手元で `bun run build-storybook` を流す（CI は Storybook をビルドしない）
  - 基礎の色の見本は、値をコードに書き写さず、画面に当たっている値をブラウザから読んで出す（`stories/foundations/swatch.tsx`）
  - フォーカスの色・キーカラーなどの決まりそのものは、決定 `2026-10-24-admin-dads` が正。Storybook はそれを見せる場所で、決まりを変える場所ではない
  - コマンド：`bun run storybook`（開発）・`bun run build-storybook`（`storybook-static/` に出力。コミットしない）
- **再開したとき**（2026-11-21。PR #1117 は 11月13日から止まっていた。オーナーの判断「今の main で生かす」）:
  - 依存は main の `bun.lock` から `bun add -d` で入れ直した。版は 10.6.7 に**固定**した（前は `^10.6.7`）。止まっている間に出た新しい版を、確かめずに入れないため。上げるときは、`bun add -d <名前>@<版>` で、出てから2週間ほど経った版にする
  - 再開の時点で、今の `components/ui/` の部品でストーリーの型が通り（`bun run typecheck`）、ビルドが通り、ビルドした Storybook で 54 のストーリーすべてがエラーなく描けた（説明のページと合わせて 82）
  - 土台が出社の画面に変わった（決定 `2026-11-13-office-is-the-base`）あとも、通常の表示と部屋のボードは `components/ui/` の部品を使うので、見本の役目は残る。管理画面に昼と夜の色を当てる PR #1124 は取り下げたので、色の正は今も `2026-10-24-admin-dads`
- **まだやっていないこと**:
  - AI社員オフィスの部品のストーリー（オフィスのコードが main に入ってから）
  - CI で Storybook をビルドするジョブと公開先（`ci-devops-specialist` のレビューを通して決める）。それまでは、ストーリーの型は `bun run typecheck` が守る
  - 見た目の差分の自動テスト
- **確かめられなかったこと**: Storybook の公式ドキュメント（storybook.js.org）は、作業したクラウドのセッションのネットワークから届かなかった。設定は、入れたパッケージの型と、実際のビルド・表示で確かめた
