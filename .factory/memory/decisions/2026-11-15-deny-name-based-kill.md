---
id: 2026-11-15-deny-name-based-kill
date: 2026-11-15
category: Process
title: "名前で探してプロセスを止めるコマンド（pkill・killall）を権限の deny で止める（#1130）"
status: active
superseded_by: []
issues: [1130]
paths: [".claude/settings.json"]
---

### [Process] 名前で探してプロセスを止めるコマンド（pkill・killall）を権限の deny で止める（#1130）
- **日付**: 2026-11-15
- **決定**（オーナー判断、2026-11-14「推奨どおり」で案 A）: `.claude/settings.json` の `permissions.deny` に `Bash(pkill *)` と `Bash(killall *)` を足す。決定 `2026-10-24-claude-harness-guards` の「権限」の禁止に、この2つを加える
- **理由**:
  - 2026-10-24 に2回、`pkill -f` で自分のシェルを止め、同じマシンのほかのセッションのサーバーにも当たりうる形で止めた（学び `[Harness] pkill -f は…`、`violations.md`）。機械で判定でき、2回起きているので、文章ではなく権限で掛ける（決定 `2026-11-12-memory-review-monthly-issue` の基準）
  - リポジトリのスクリプト・ドキュメント・CI に `pkill`・`killall` は無く、止めても困る場面はまず無い
  - 公式（https://code.claude.com/docs/en/permissions 、参照日 2026-11-14）では、deny は複合コマンド（`&&`・`||`・`;`・`|`・サブシェル・`$()`・`for` の中）のどの部分に当たっても効き、`timeout`・`nohup` などの前置きと、先頭の変数の代入を越えて当たる
- **ルール**:
  - 止めたいプロセスは、起動したときに控えた PID で `kill <PID>` する（止めない）
  - `… | xargs kill` は止めない。フラグの無い `xargs` は外して照らし合わせるので `kill` として扱われ、PID を指定した `kill` と区別できないため
  - このセッションで確かめた（2026-11-15）：`pkill -x <名前>`・`true && pkill …`・`FOO=1 pkill …`・`timeout 5 pkill …`・`killall <名前>` はどれも拒否された。PID を指定した `kill -0 $$` は通った。公式では当たらないとされる `/usr/bin/pkill` も拒否されたが、deny によるのか、ほかの判定によるのかは区別できない
- **却下案**:
  - ガードに `xargs kill` も止める規則とテストを足す（案 B）：再発が2回で止まっていることに比べて費用が大きい
  - 止めない（案 C）：文章を読み落としたときに同じ事故が起きる
