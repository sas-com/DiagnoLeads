---
id: 2026-02-07-test-file-naming
date: 2026-02-07
category: Naming
title: "テストファイル命名規則（種別別）"
status: superseded
superseded_by: [2026-10-24-test-file-naming]
issues: []
paths: []
---

### [Naming] テストファイル命名規則（種別別）
- **日付**: 2026-02-07
- **決定**: 
  - `*.test.ts` → Unit tests（外部依存なし、高速）
  - `*.integration.ts` → Integration tests（モック使用、中程度）
  - `*.spec.ts` → E2E tests（実環境、長時間）
- **理由**: 
  - テスト種別による明確な分類
  - CI並列化の容易さ（種別ごとに分離実行可能）
  - 外部依存の有無が明確になる
- **却下案**: 
  - レイヤー別のみの分類（Unit/Integration/E2Eが混在）
  - ディレクトリ分離のみ（ファイル名で判別不可）
