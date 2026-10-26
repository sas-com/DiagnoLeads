---
paths:
  - "lib/features/*/api/**"
  - "lib/features/*/router.ts"
  - "server/routers/**"
  - "lib/trpc/**"
  - "lib/multi-tenant/**"
---

# tRPC のルーターと組織の分離

組織（テナント）の分離がこのプロダクトの土台。RLS はまだ効いていない（`lib/multi-tenant/middleware/organization.ts` の NOTE）ので、分離は各クエリの条件だけで守られている。

- 組織のデータを扱う手続きは `organizationProcedure` で受ける。入力の `organizationId` でメンバーシップを確かめ、`ctx.ability` を作る。`protectedProcedure` で組織のデータを読み書きしない
  - hierarchy と organizations のルーターには、`protectedProcedure` の中で手でメンバーシップを確かめる古い形が残っている。新しい手続きでは真似しない。そのファイルに手続きを足すときも、所属と権限の確認を省かない（古い形を直すなら別の Issue にする）
- 最初に権限を確かめる：`if (!ctx.ability.can('<action>', '<Subject>')) throw new TRPCError({ code: 'FORBIDDEN', message: '<メッセージ>' })`。閲覧は `read Lead`、設定の変更は `update Settings` のように、アクション・対象・メッセージの言語を同じルーターのほかの手続きに合わせる
- 読み込みも書き込みも `eq(<table>.organizationId, input.organizationId)` を条件に入れる。直前に組織で絞って読んだ行を書くときも入れる（`decisions/2026-10-23-admin-api-role-checks`）。id だけで更新・削除しない
- 入力で受け取ったほかの行の id（リード・タグ・テンプレートなど）は、使う前に `assertInOrganization`（`lib/multi-tenant/helpers/scope.ts`）で同じ組織のものか確かめる。別の組織の行は NOT_FOUND（存在しない id と同じ答え）にする
- resolver の `input`・`...input`・`...rest` を、DB の書き込み（`.set()`・`.values()`）・監査・外への送信・ログに広げず、項目を名前で取り出す
  - 今の `organizationProcedure` の最初の `.input()`（`organizationInputSchema`）は `.passthrough()` なので、手続きのスキーマに無い項目も `input` に残る。`notifications.updatePreferences` は残りを `.set()` に広げていて、送られた `userId` で行を書き換えられた（#743）
  - 型チェックでは止まらない。`input` の型が `[k: string]: unknown` を持つので、宣言していない項目を読んでも広げても型エラーにならない。passthrough を外したあとも名前で取り出す（#743 のオーナーの判断）
- 誰が読めて誰が変えられるかは、関係する決定に合わせる。parent_viewer（親組織の閲覧者）はリードを読めるが、営業の手引きなど読めないものがある
- 新しい手続きには、組織の分離の DB テストを足す：`test/unit/integration/*-org-isolation.db.test.ts`（別の組織の id を渡すと NOT_FOUND になり、相手の行が変わらないこと）
- 新しいルーターは `server/routers/_app.ts` に登録する（登録しないと外から呼べない）
