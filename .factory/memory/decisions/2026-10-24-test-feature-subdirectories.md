---
id: 2026-10-24-test-feature-subdirectories
date: 2026-10-24
category: Naming
title: "機能のテストが複数あるときは test/unit/features/{feature}/ に置いてよい（base-test-directory の補足）"
status: active
superseded_by: []
issues: [450]
paths: ["docs/TESTING.md", "test/unit/features/*/*.test.ts"]
---

### [Naming] 機能のテストが複数あるときは test/unit/features/{feature}/ に置いてよい（base-test-directory の補足）
- **日付**: 2026-10-24
- **経緯**: #450 の質問4（推奨つき）に、オーナーが「推奨どおりで進めてください」と答えた
- **決定**: 機能のテストが複数あるときは、`test/unit/features/{feature}/` のサブディレクトリに置いてよい。`{feature}` は `lib/features/` のディレクトリ名と同じにする。1つだけなら今までどおりフラットに置く（`test/unit/features/{feature}.test.ts` か `{feature}-<対象>.test.ts`）
  - base-test-directory の置き換えではなく補足。テストをソースと別に置く方針（コロケーションの却下）は変えない
  - 実 DB のテストは今までどおり `test/unit/integration/*.db.test.ts`（決定 2026-10-24-test-file-naming）
- **理由**: すでにサブディレクトリが8個・23ファイルあり（#416 の site-visits/ を含む）、決定と実態がずれていた。フラットの160ファイルのうち、名前が機能のディレクトリ名と同じか「機能名-」で始まるのは99（約62%）で、1つの機能のテストを探しにくい
- **却下案**: フラットのまま、ファイル名の先頭を機能のディレクトリ名にそろえる（移動は少ないが、lead-* と leads-* のような取り違えが残る）
- **ルール**:
  - 既存のテストを移すためだけの PR は作らない。フラットとサブディレクトリに同じモジュールのテストが重なっている組（5組）の整理は、別の Issue で行う
  - 構成の正本 `docs/ARCHITECTURE.md`（#514）の置き場所の表にも、この形を書く
  - `docs/TESTING.md` への反映は、担当の core systems review のセッションが行う
