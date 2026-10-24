---
id: 2026-02-07-testing-guide
date: 2026-02-07
category: Process
title: "テスト原則ドキュメント"
status: active
superseded_by: []
issues: []
paths: ["docs/TESTING.md"]
---

### [Process] テスト原則ドキュメント
- **日付**: 2026-02-07
- **決定**: `docs/TESTING.md` にテスト種別ごとの原則・ルールを文書化
- **理由**: 
  - 一貫した品質基準の確立
  - 新規参加者のオンボーディング効率化
  - レビュー基準の明確化
- **内容**:
  - Unit: AAAパターン、単一責任、外部依存排除
  - Integration: モック境界明確化、実関数テスト、エラーハンドリング
  - E2E: ユーザー視点、POM、待機戦略
