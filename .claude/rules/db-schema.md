---
paths:
  - "lib/db/schema.ts"
  - "drizzle/**"
  - "scripts/db-*.ts"
---

# スキーマの変更（Drizzle）

- 変更は追加だけにする（列や表を足す）。列を消す・名前を変える・型を変えるときは、段階に分けて別の PR にする。マージの前後で、古いコードと新しいスキーマが同時に動く時間があるため
- 手順：`lib/db/schema.ts` を変える → `bun run db:generate` で `drizzle/` に SQL とメタを作る → 手元の DB に `bun run db:migrate` → テスト。`drizzle/meta/` は手で直さない
- 本番 DB への適用は、マージの前にオーナーの承認を得て行う。マージすると本番に自動でデプロイされ、新しいコードが新しいスキーマを読みに行くため。接続文字列を会話やログに出さない
- スキーマの変更と依存の変更は同じ PR に入れない（失敗したとき、新しいスキーマに古いコードが残る時間が延びる。`decisions/2026-10-21-frozen-lockfile-on-vercel`）
- DB のコマンドを流す前に、`DATABASE_URL` が手元の DB を指していることを確かめる（Claude Code では、DB を変えるスクリプトは毎回確認が出る）
- マイグレーションと SQL は、実 DB のテスト（`test/unit/integration/*.db.test.ts`）で確かめる。手順は `docs/TESTING.md`
