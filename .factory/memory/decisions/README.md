# MemoryBank: 決定（decisions）

意思決定を1件1ファイルで置く。セッションの始めには索引だけを読み、作業に関係する決定の本文を開く（[2026-10-24-memory-one-file-per-decision](./2026-10-24-memory-one-file-per-decision.md)）。

## 探し方

- 索引（有効な決定の一覧）：`bun run memory:index`。Claude Code ではセッション開始時に自動で出る
- コードから：そのファイルを読む・編集すると、`paths` が当たる決定を Claude Code のフックが知らせる。手で探すときは `grep -l '<パスの一部>' .factory/memory/decisions/*.md`
- 言葉から：`grep -rl '<言葉>' .factory/memory/decisions/`

## 書き方

ファイル名は `<日付>-<英語の短い名前>.md`（例：`2026-10-24-test-file-naming.md`）。先頭に次の項目を書き、その下は今までどおり見出し `### [分類] 題名` と、日付・決定・理由・却下案・ルールの箇条書き。

```markdown
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
```

- `id` はファイル名（`.md` を除く）と同じ。日付が分からない初期の決定は `base-<名前>` と `date: project-start`
- `status` は `active` か `superseded`。置き換えるときは新しい決定を足し、古い決定を `superseded` にして `superseded_by` に新しい ID を書く（古いファイルは消さない）
- `paths` はその決定が縛るコード。リポジトリの根からのパスで、`*` は1階層、`**` は複数階層。`lib/**` のような広すぎるパスは付けない（どのファイルでも知らせることになる）。コード全体に効く決定は空のまま
- `title` と `paths` の値は `"` で囲む（`#` や `[` を含むため）
- 「最終更新」の行は書かない（並行するセッションの衝突の元。日付は git にある）
- このリポジトリは公開。接続情報・キー・社外秘（取引先名・単価・営業の手引きの本文）を書かない
- 書いたら `bun run memory:index` で索引に出ること、`bunx vitest run test/unit/claude-hooks` が通ることを確かめる（先頭の項目の形と、`paths` に当たるファイルがあることを検査する）
