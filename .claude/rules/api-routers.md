---
paths:
  - "lib/features/*/api/**"
  - "server/routers/**"
  - "lib/trpc/**"
  - "lib/multi-tenant/**"
---

# tRPC のルーターと組織の分離

組織（テナント）の分離がこのプロダクトの土台。RLS はまだ効いていない（`lib/multi-tenant/middleware/organization.ts` の NOTE）ので、分離は各クエリの条件だけで守られている。

- 組織のデータを扱う手続きは `organizationProcedure` で受ける。入力の `organizationId` でメンバーシップを確かめ、`ctx.ability` を作る。`protectedProcedure` で組織のデータを読み書きしない
- 最初に権限を確かめる：`if (!ctx.ability.can('<action>', '<Subject>')) throw new TRPCError({ code: 'FORBIDDEN', message: '…する権限がありません' })`。閲覧は `read Lead`、設定の変更は `update Settings` のように、同じルーターのほかの手続きに合わせる
- 読み込みも書き込みも `eq(<table>.organizationId, input.organizationId)` を条件に入れる。直前に組織で絞って読んだ行を書くときも入れる（`decisions/2026-10-23-admin-api-role-checks`）。id だけで更新・削除しない
- 入力で受け取ったほかの行の id（リード・タグ・テンプレートなど）は、使う前に `assertInOrganization`（`lib/multi-tenant/helpers/scope.ts`）で同じ組織のものか確かめる。別の組織の行は NOT_FOUND（存在しない id と同じ答え）にする
- 誰が読めて誰が変えられるかは、関係する決定に合わせる。parent_viewer（親組織の閲覧者）はリードを読めるが、営業の手引きなど読めないものがある
- 新しい手続きには、組織の分離の DB テストを足す：`test/unit/integration/*-org-isolation.db.test.ts`（別の組織の id を渡すと NOT_FOUND になり、相手の行が変わらないこと）
- 新しいルーターは `server/routers/_app.ts` に登録する（登録しないと外から呼べない）
