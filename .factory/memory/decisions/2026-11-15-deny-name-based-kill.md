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
  - 2026-10-24 に2回起きた。1回は `pkill -f "next start"` が自分のシェルを止めた（終了コード 144）。もう1回は `pkill -f "next dev"` や `ps | grep | xargs kill` で、同じマシンのほかのセッションのサーバーにも当たりうる形で止めた（学び `[Harness] pkill -f は…`、`violations.md`）。機械で判定でき、2回起きているので、文章ではなく権限で掛ける（決定 `2026-11-12-memory-review-monthly-issue` の基準）
  - クラウドのセッションのシェルでは、Claude Code 側が `pkill` を関数で包み、Claude 本体とその祖先のプロセスには当たらないようにしている（2026-11-15 に `type pkill` で確認。リポジトリの外のもの）。自分のシェルを止める事故は起きにくくなったが、ほかのセッションのプロセスは守られないので、deny は要る
  - リポジトリのスクリプト・ドキュメント・CI に `pkill`・`killall` は無く、止めても困る場面はまず無い
  - 公式（https://code.claude.com/docs/en/permissions 、参照日 2026-11-14）では、deny は複合コマンド（`&&`・`||`・`;`・`|`・サブシェル・`$()`・`for` の中）のどの部分に当たっても効き、`timeout`・`nohup` などの前置きと、先頭の変数の代入を越えて当たる
- **ルール**:
  - 止めたいプロセスは、起動したときに控えた PID で `kill <PID>` する（止めない）
  - `… | xargs kill` は止めない。フラグの無い `xargs` は外して照らし合わせるので `kill` として扱われ、PID を指定した `kill` と区別できないため
  - **権限では止まらない形**：公式によると、deny はパスで呼んだ形（`/usr/bin/pkill`）と `sh -c '…'`・`bash -c '…'` の中には当たらず、セキュリティの境界ではない。名前やポートで探して止める `kill $(pgrep -f …)`・`kill -9 $(lsof -t -i:3000)`・`lsof -ti:3000 | xargs kill`・`ps | grep | xargs kill` も止まらない。これらも、ほかのセッションのプロセスに当たる形なので使わない（文章での禁止は残る。deny の拒否には案内の文を付けられない）
  - 足していない、名前で止めるほかのコマンド（`killall5`・`skill`）は、Claude が書いた記録が無いので今回は足さない。`Bash(killall *)` は空白を挟むので `killall5` には当たらない
  - このセッションで確かめた（2026-11-15）：`pkill -x <名前>`・`true && pkill …`・`FOO=1 pkill …`・`timeout 5 pkill …`・`killall <名前>` はどれも「Permission to use Bash with command … has been denied.」で拒否された（上の関数の「refusing to run」ではなく、権限の層での拒否）。PID を指定した `kill -0 $$` は通った。公式では当たらないとされる `/usr/bin/pkill` も同じ文で拒否されたが、deny によるのか、権限の層のほかの判定によるのかは区別できない
- **却下案**:
  - ガードに `xargs kill` も止める規則とテストを足す（案 B）：再発が2回で止まっていることに比べて費用が大きい
  - 止めない（案 C）：文章を読み落としたときに同じ事故が起きる
