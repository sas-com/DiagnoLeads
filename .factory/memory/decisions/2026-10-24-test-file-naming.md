---
id: 2026-10-24-test-file-naming
date: 2026-10-24
category: Naming
title: "テストファイルの名前を、vitest が実行する名前にそろえる（#428）"
status: active
superseded_by: []
issues: [428]
paths: ["vitest.config.ts", "docs/TESTING.md"]
---

### [Naming] テストファイルの名前を、vitest が実行する名前にそろえる（#428）
- **日付**: 2026-10-24
- **決定**: ユニットテストとモックを使う結合テストは `test/unit/**/*.test.ts(x)`、実際の PostgreSQL を使うテストは `test/unit/integration/*.db.test.ts`、E2E は `test/e2e/*.spec.ts`。2026-02-07 の「結合テストは `*.integration.ts`」をやめる
- **理由**: vitest が実行するのは `test/**/*.{test,spec}.{ts,tsx}` だけ（`vitest.config.ts`）で、`*.integration.ts` は実行されない。実際に `*.integration.ts` のファイルは0件で、結合テストは上の名前で書かれていた。記録どおりに書くと、テストが黙って動かない
- **却下案**: vitest の対象に `*.integration.ts` を足す（今あるテストの名前と二重になり、得るものがない）
