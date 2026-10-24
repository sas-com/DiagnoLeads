---
paths:
  - "lib/features/**"
  - "components/features/**"
---

# 機能モジュールの置き方と依存の向き

正本は `docs/ARCHITECTURE.md`。ここはその要点。権限と組織の絞り込みは `.claude/rules/api-routers.md` に従う。

- 機能の型：`api/router.ts`（権限の確認・入出力の zod・service の呼び出しだけ）、`service.ts`（db か transaction を第1引数で受け、すべてのクエリを organizationId で絞る）、`types/`（zod のスキーマ・定数・型。画面と共有）、ほかのファイルは機能の中の補助。`index.ts` は作らない
- 他の機能から import してよいのは `types/**`・`types.ts`・`service.ts` だけ。内部のファイルが要るときは、相手の `service.ts` か `types/` に出す。他の機能の `api/` は import しない
- 機能単位の循環を増やさない。新しい機能は既存の中心（leads など）を読む向きにし、中心の側から新しい機能を読まない。両方を並べる画面は components・app でまとめる
- グローバルの `db` を import しない。`ctx.db` か引数の executor を使う（RLS で接続を差し替えるため）
- 画面の部品と、その機能だけで使う hook は `components/features/<feature>/` に置く。`hooks/` には複数の機能で使うものだけを置く
- 画面から lib/features を値で読むのは `types/` と純粋なファイルだけ。`service.ts`・`api/`・`lib/db` には届かないようにする
- 変えたら `bun run arch:check` を流す。落ちたら `docs/ARCHITECTURE.md` の「直し方」に従う。違反を減らしたら `bun run arch:check --update` で許可リストの行を消す
