---
id: base-test-directory
date: project-start
category: Naming
title: "テストファイルの配置"
status: active
superseded_by: []
issues: []
paths: []
---

### [Naming] テストファイルの配置
- **日付**: プロジェクト開始時
- **決定**: `test/unit/features/{feature}.test.ts`
- **理由**: テストとソースの分離、CI設定の容易さ
- **却下案**: コロケーション（`*.test.ts`を同じディレクトリに）
