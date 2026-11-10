---
id: 2026-11-08-keep-organization-input-passthrough
date: 2026-11-08
category: API
title: "organizationInputSchema の passthrough は外さず、resolver では項目を名前で取り出して守る（#743・#982）"
status: active
superseded_by: []
issues: [743, 773, 787, 982]
paths: ["lib/multi-tenant/middleware/organization.ts"]
---

### [API] organizationInputSchema の passthrough は外さず、resolver では項目を名前で取り出して守る（#743・#982）
- **日付**: 2026-11-07（オーナーの判断）。記録は 2026-11-08
- **決定**: `organizationProcedure` の最初の `.input()`（`lib/multi-tenant/middleware/organization.ts` の `organizationInputSchema`）の `.passthrough()` は外さない。strip にも `.strict()` にもしない。2026-10-26 の「AX LP の公開（10/29）の後に strip にする」という判断を取りやめ、#743 を not planned で閉じた
- **守り方（このまま残す）**
  - resolver の `input`・`...input`・`...rest` を、DB の書き込み・監査・外への送信・ログに広げず、項目を名前で取り出す（`.claude/rules/api-routers.md`。PR #787）
  - `notifications.updatePreferences` は `pickPreferenceUpdates` で名前で取り出す（PR #773。実 DB のテストあり）
  - 219 の組織の手続きを見回し、宣言していない項目を書き込み・監査・外への送信に使う箇所はほかになかった（#743 の 2026-10-25 のコメント）
- **理由**: オーナーの判断。害（`notifications.updatePreferences`）は #773 で止まり、ほかの手続きは安全と確かめてある。passthrough を外すと、219 の手続きすべての入口が変わる
- **却下案**
  - strip にする（2026-10-26 に一度決めたもの）。壊れる手続きはないと確かめていたが、取りやめた
  - `.strict()` にする：各手続きの項目が `organizationInputSchema` の知らない項目になり、すべての呼び出しが BAD_REQUEST になる
- **ルール**
  - passthrough があるので、resolver の `input` には手続きのスキーマに無い最上位の項目も残る。型チェックでも止まらない（`input` の型が `[k: string]: unknown` を持つ）。名前で取り出すルールを守ることが唯一の守り
  - 見直すときは、オーナーに確かめてから。#743 の調べ（tRPC 11 の `.input()` のつなぎ方、strip・strict の挙動の表）が材料になる
