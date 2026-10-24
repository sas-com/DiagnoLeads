---
id: 2026-02-07-test-issue-hierarchy
date: 2026-02-07
category: Process
title: "テストIssue階層構造"
status: active
superseded_by: []
issues: [6, 16, 17, 18]
paths: []
---

### [Process] テストIssue階層構造
- **日付**: 2026-02-07
- **決定**: テスト種別 → レイヤー別SubIssueの2階層構造
  ```
  #6 テストカバレッジ向上 (親)
  ├── #16 Unit Tests
  │   ├── #19 [Unit] Core層
  │   └── #20 [Unit] UI層
  ├── #17 Integration Tests
  │   ├── #21 [Integration] API層
  │   └── #22 [Integration] Core層
  └── #18 E2E Tests
      ├── #23 [E2E] 認証フロー
      ├── #24 [E2E] リード管理フロー
      └── #25 [E2E] 診断フォームフロー
  ```
- **理由**: 
  - テスト種別軸でCI最適化可能
  - レイヤー別で進捗管理が細かくできる
  - SprintPathの5原則（Clear Ownership, Visibility）に適合
- **却下案**: 
  - レイヤー別のみ（#11 Core, #12 API等）→ テスト種別が混在
  - フラットなIssue構造（進捗管理が困難）
