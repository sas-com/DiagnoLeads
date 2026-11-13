---
paths:
  - "test/unit/**"
---

# ユニットテスト

- `bun run verify` は、import をたどって流すテストを選ぶ（`vitest related`）。テストでファイルを直接読む（`readFileSync`・`readdirSync` など）ときは、`scripts/verify-changed.ts` の `DISK_READERS`（読むファイルとテストの組）か `FULL_SUITE` に規則を足す。足さないと、そのファイルを変えたコミットでテストが流れず、CI で初めて落ちる（決定 `2026-11-12-verify-changed-before-commit`）
- 規則を足したら `test/unit/scripts/verify-changed.test.ts` にも例を足す
