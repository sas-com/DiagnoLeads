---
name: record-decision
description: MemoryBank（.factory/memory/）に決定・違反・学びを記録する手順。オーナーが判断したとき、設計や運用を決めたとき、決定を置き換えるとき、原則に違反したとき、問題を解決して学びがあったときに使う
---

# record-decision：MemoryBank に記録する

どれも公開リポジトリに入る。

- 接続情報・キー・社外秘（取引先名・単価・営業の手引きの本文）は書かない
- 「最終更新」の行は書かない（並行するセッション同士の衝突の元になる）

## 決定（`.factory/memory/decisions/`）

1. 同じ話題の決定がないか探す：`bun run memory:index` または `grep -rl '<言葉>' .factory/memory/decisions/`
2. `<今日の日付>-<英語の短い名前>.md` を作る。先頭の項目と本文の形は `.factory/memory/decisions/README.md` に従う
   - `title` と `paths` の値は `"` で囲む
   - `paths` には、その決定が縛るコードだけを書く。広すぎるパスは付けない
   - 本文は `### [分類] 題名` の見出しと、日付・決定・理由・却下案・ルールの箇条書き。オーナーの判断なら、そう書く
3. 置き換えるとき
   - 古い決定は消さない。`status: superseded` にし、`superseded_by: [<新しい id>]` を書く
   - 一部だけ変えるときは、どこを変えたかを新しい決定に書く
4. 確かめる
   - `bun run memory:index` の索引に出る
   - `bunx vitest run test/unit/claude-hooks` が通る（先頭の項目の形と、`paths` に当たるファイルがあることを検査する）

## 違反（`.factory/memory/violations.md`）

1. 「違反記録」の末尾に書く：重大度（CRITICAL / HIGH / MEDIUM）・日付・違反した原則・状況・影響・原因・対応・再発防止
2. 「統計」の表を更新する
3. 再発防止策を仕組みに入れる
   - 機械で判定できるもの：フック。ルールは `.claude/hooks/lib/` に書き、テストを `test/unit/claude-hooks/` に足す
   - 判断が要るもの：CLAUDE.md の「毎回守ること」

## 学び（`.factory/memory/learnings.md`）

- 分野の節に、日付・状況・原因・解決策・教訓を足す
- 同じ学びがすでにあれば、新しく足さずに追記する
