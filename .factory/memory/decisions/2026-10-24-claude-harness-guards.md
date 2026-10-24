---
id: 2026-10-24-claude-harness-guards
date: 2026-10-24
category: Process
title: "Claude の守りは、文章ではなくフックと権限で掛ける（#427）"
status: active
superseded_by: []
issues: [426, 427]
paths: [".claude/settings.json", ".claude/hooks/**"]
---

### [Process] Claude の守りは、文章ではなくフックと権限で掛ける（#427）
- **日付**: 2026-10-24
- **決定**: 毎回守らせたいことのうち、機械で判定できるものは `.claude/settings.json` のフックと権限で掛ける。CLAUDE.md の文章は、判断が要ることに絞る
- **理由**: 文章のルールは守られないことがあった（node_modules の直接編集 2026-10-22、秘密情報のコミット 2026-10-15 発見）。クラウドのセッションには依存が入っておらず、必須の検証がそのままでは動かなかった
- **ルール**:
  - フック（`.claude/hooks/`）
    - セッション開始：クラウドでは `bun install --frozen-lockfile`。決定の索引を出す
    - 編集・コマンド・MCP の前：node_modules・Bun の共有キャッシュ・bun.lock・`.env*` の編集、秘密情報（本番の接続文字列・API キー・秘密鍵）の書き込みと送信、`.env*` の中身の表示を止める。テスト用の架空の値は、文字列を組み立てて書くか、その行に `gitleaks:allow` を付ける
    - 読み取り・編集の後：そのファイルに関係する決定を知らせる
  - 権限：`.env*` の読み取りと main への push は禁止。DB を変えるスクリプトと E2E は毎回確認。検証のコマンドは確認なし
  - フックは壊れても作業を止めない（想定外のエラーは素通りさせる）。ルールを足すときは `.claude/hooks/lib/` に書き、`test/unit/claude-hooks/` にテストを足す
- **却下案**: 文章のルールを強める（守られないことがすでに起きている）。編集のたびに biome format をかける（lefthook がコミット時にかけている。編集中にファイルが書き換わると、Claude の次の編集が一致せず失敗しやすい）
