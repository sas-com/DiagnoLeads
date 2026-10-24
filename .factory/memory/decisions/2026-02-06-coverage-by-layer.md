---
id: 2026-02-06-coverage-by-layer
date: 2026-02-06
category: Testing
title: "テストカバレッジ方針"
status: active
superseded_by: []
issues: []
paths: ["vitest.config.ts"]
---

### [Testing] テストカバレッジ方針
- **日付**: 2026-02-06
- **決定**: 層別カバレッジ目標 + E2E補完
  - Core (lib/features, lib/db, lib/auth): 80%
  - API (server/, app/api/): 70%
  - UI (components/, app/[locale]/): 30-40% (E2Eで補完)
  - E2E: 主要フロー100%
  - 全体目標: 40%+ (E2E含めた実質70%+)
- **理由**: 
  - 品質の一貫性を保つため、カバレッジ対象を恣意的に除外しない
  - UIコンポーネントはE2Eで効果的にカバー可能
  - ビジネスロジック層は高カバレッジを維持
- **却下案**: 
  - 全体70%一律目標（UIテストのコストが高すぎる）
  - カバレッジ対象からUIを除外（品質の一貫性が損なわれる）
