---
paths:
  - "app/**/page.tsx"
  - "components/features/**"
  - "lib/features/help/**"
---

# 管理画面の利用ガイド（ヘルプの記事）

正本は決定 `2026-10-28-in-app-help`（Epic #877）。

- 管理画面の画面を変えたら、その画面のヘルプの記事（`lib/features/help/`）も同じ PR で直す。操作の手順・ボタンの名前・役割による違い・用語が今の画面と合っているかを確かめ、記事の `reviewedAt` をその日にする
- 管理画面（`app/[locale]/(dashboard)/`）にページを足す・名前を変える・消すときは、記事の `routes` か `HELP_EXCLUDED_ROUTES` を直す。`bunx vitest run test/unit/features/help` が検査する
- 記事は型付きのブロックで書く（`lib/features/help/types.ts`）。Markdown や HTML は使わない。リンクは管理画面のパス（ロケールなし）か `/help/<id>` だけ
- リポジトリは公開。社外秘（取引先名・単価・営業の手引きの本文）は書かない
