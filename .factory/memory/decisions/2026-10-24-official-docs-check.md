---
id: 2026-10-24-official-docs-check
date: 2026-10-24
category: Process
title: "Claude の設定と Claude API は、Anthropic の公式ドキュメントで確かめてから変える（#429）"
status: active
superseded_by: []
issues: [429]
paths: ["CLAUDE.md", ".claude/settings.json", ".claude/hooks/**", ".claude/skills/**", ".claude/agents/**", ".claude/rules/**", "lib/features/ai/**"]
---

### [Process] Claude の設定と Claude API は、Anthropic の公式ドキュメントで確かめてから変える（#429）
- **日付**: 2026-10-24
- **決定**: CLAUDE.md・`.claude/`・MemoryBank の仕組み・Claude API の呼び出し（モデル・SDK）を変えるときは、記憶ではなく今の公式ドキュメントを読んで確かめ、PR に読んだページの URL を書く。月に1回、公式の変更（Claude Code の変更履歴、モデルの提供終了の予定）を確かめて見直す（オーナーの依頼「アンソロピック公式を常にチェックして見直してください」）
- **理由**:
  - Claude Code の仕様は速く変わり、モデルの知識より新しいことがある（`.claude/rules/` の `paths`、スキル、フックの判定の返し方など）
  - 使っていたモデル（`claude-sonnet-4-20250514`）が 2026-06-15 に提供終了していたのに、失敗が握りつぶされていて 2026-10-24 まで気づかなかった（#442・#443）
- **ルール**:
  - 手順と公式のページの一覧はスキル `official-check`
  - 公式と決定が食い違ったら、決定を置き換える（スキル `record-decision`）
  - 月1回の見直しは `.factory/memory/README.md` の「メンテナンス」
- **却下案**: 気づいたときだけ確かめる（#442 では気づくのが4か月遅れた）
