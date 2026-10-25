---
paths:
  - "lib/db/schema.ts"
  - "drizzle/**"
  - "scripts/db-*.ts"
---

# スキーマの変更（Drizzle）

- 変更は追加だけにする（列や表を足す）。列を消す・名前を変える・型を変えるときは、段階に分けて別の PR にする。マージの前後で、古いコードと新しいスキーマが同時に動く時間があるため
  - 既存の表に NOT NULL の列を足すときは DEFAULT を付ける（本番に先に流すので、マージまでの間も古いコードの INSERT が通るように）
- 手順：`lib/db/schema.ts` を変える → `bun run db:generate` で `drizzle/` に SQL とメタを作る → 手元の DB に `bun run db:migrate` → テスト。`drizzle/meta/` は、下のぶつかったときの手順のほかは手で直さない
- main を取り込んで、マイグレーションの番号か `when`（`drizzle/meta/_journal.json`）がほかの PR とぶつかったら、番号だけを付け替えない。自分の `drizzle/<番号>_*.sql`・`drizzle/meta/<番号>_snapshot.json`・ジャーナルの自分の行を消し、`bun run db:generate` で作り直す。drizzle の migrator は、本番に記録済みの最新より `when` が新しいものだけを流すので、古い `when` が残ると黙って飛ばされる
- 本番 DB への適用は、マージの前にオーナーの承認を得て行う。マージすると本番に自動でデプロイされ、新しいコードが新しいスキーマを読みに行くため。接続文字列を会話やログに出さない
  - 本番には、ジャーナルの順に流す。前の番号がまだ本番に無ければ、その適用を待つ
  - 流す前に、本番の接続先を前に付けて `bun run db:migrate --check` を流す（`DATABASE_URL="<本番>" SKIP_ENV_VALIDATION=1 bun run db:migrate --check`。台帳を読むだけで、何も適用しない。読み取り専用のユーザー `dl_readonly` が `drizzle.__drizzle_migrations` を読めるなら、それで流すと書き込めない。権限が足りなければエラーで止まる）。黙って飛ばされるマイグレーションがあれば名前を出して止まり、無ければ流れるものの一覧と警告（適用の後に SQL が変わった・適用済みの SQL を作り直した）を出す。`db:migrate` も最初に同じ検査をして止まる（#620）
  - drizzle は未適用のマイグレーションを1つのトランザクションで流すので、最初に取ったロックが最後まで続く。流す前に、長いトランザクション（`pg_stat_activity` の `xact_start` が古いもの）が無いことと、変える表の大きさを確かめ、利用の少ない時間に流す。表のロックが重いもの（大きい表への外部キー・索引）がいくつもあるときは、別の回に分ける
  - `db:migrate` は lock_timeout（ロックの待ち1回につき5秒、`scripts/db-migration-lock.ts`）を置く。ロックを待ちきれなければ、全部戻して台帳にも記録せずに止まり、見つけ方とやり直し方を出す（#723）。取ったロックを持ち続ける長さ（長い CREATE INDEX）は防げないので、上の確認と分け方で抑える。セッションの設定なので、直接の接続か Session pooler（5432）で流し、Transaction pooler（6543）では流さない（`docs/deployment-guide.md`）
- スキーマの変更と依存の変更は同じ PR に入れない（失敗したとき、新しいスキーマに古いコードが残る時間が延びる。`decisions/2026-10-21-frozen-lockfile-on-vercel`）
- 手元で DB のコマンドを流すときは、手元の DB の URL をコマンドの前に付けて流す（`docs/TESTING.md` の「実 DB テスト」と同じ）。`.env.local` の値は表示しない（Claude Code では、DB を変えるスクリプトは毎回確認が出る）
- マイグレーションと SQL は、実 DB のテスト（`test/unit/integration/*.db.test.ts`）で確かめる。手順は `docs/TESTING.md`
