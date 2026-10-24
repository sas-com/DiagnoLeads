---
id: 2026-10-24-memory-one-file-per-decision
date: 2026-10-24
category: Process
title: "MemoryBank の決定を1件1ファイルにし、索引と関係するパスから辿る（#426, #428）"
status: active
superseded_by: []
issues: [426, 428]
paths: [".claude/hooks/lib/decisions.ts", "scripts/memory-index.ts"]
---

### [Process] MemoryBank の決定を1件1ファイルにし、索引と関係するパスから辿る（#426, #428）
- **日付**: 2026-10-24
- **決定**: 決定は `.factory/memory/decisions/<id>.md` に1件ずつ置き、先頭に ID・日付・分類・題名・状態・置き換え先・Issue・関係するパスを書く（書き方は `decisions/README.md`）。セッションの始めには全文を読まず、索引（有効な決定の題名の一覧）だけを読む。本文は、作業に関係する決定だけを開く（オーナー判断）
- **理由**:
  - decisions.md は62件・約3.2万トークンになり、セッションの始めに毎回通読していた。作業に関係ない決定まで読むので、費用がかかり注意も散る。10/9 以降は1日約3件のペースで増えていた
  - 並行するセッションが同じファイルの末尾に追記するため、直近4日で22回変更されたホットスポットになり、main の取り込みで衝突していた（末尾の「最終更新」の行は毎回衝突する）
  - 置き換えられた決定（main 直接開発、TailAdmin など）が、有効な決定と見分けられずに残っていた
- **ルール**:
  - 索引は Claude Code のセッション開始のフックが出す（`.claude/hooks/session-start.ts`）。ほかのエージェントと人は `bun run memory:index`
  - `paths` に当たるファイルを読む・編集すると、フックがその決定を知らせる（セッションで1回）。知らされた決定は、本文を読んでから変更する
  - 決定を置き換えるときは、古い方を消さずに `status: superseded` と `superseded_by` を書く
  - ファイルに「最終更新」の行を書かない（日付は git にある）
  - 先頭の項目と `paths` の正しさはユニットテスト（`test/unit/claude-hooks/memory-integrity.test.ts`）で確かめる。コードを移したら `paths` も直す
- **却下案**: decisions.md のまま ID と索引を足す（変更は小さいが、衝突と通読の重さが残る）。Claude Code の `.claude/rules/` に決定を置く（Claude Code だけのものになり、`paths` のない決定が毎回すべて読み込まれる）
