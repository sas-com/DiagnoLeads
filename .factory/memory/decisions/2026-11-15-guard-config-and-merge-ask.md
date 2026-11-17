---
id: 2026-11-15-guard-config-and-merge-ask
date: 2026-11-15
category: Process
title: "Claude の守りの変更（設定・フック・エージェントの定義）と PR のマージは、フックと権限で毎回オーナーに確認を出す（#1209）"
status: active
superseded_by: []
issues: [1209, 1293, 1208, 809]
paths: [".claude/hooks/lib/protect.ts", ".claude/hooks/lib/guard.ts", ".claude/hooks/pre-tool-guard.ts", ".claude/settings.json", ".claude/agents/**", "test/unit/claude-hooks/protect.test.ts"]
---

### [Process] Claude の守りの変更（設定・フック・エージェントの定義）と PR のマージは、フックと権限で毎回オーナーに確認を出す（#1209）
- **日付**: 2026-11-15
- **きっかけ**: #1208 の `security-specialist` のレビュー。メインのセッションが `.claude/settings.local.json` に `disableAllHooks` を書くこと、フックやエージェントの定義を書き換えること、PR をマージすることを、ガードも権限も止めていなかった。守っていたのは CLAUDE.md の文章（「権限・設定の変更や破壊的な操作は、オーナー本人から受けた指示があるときだけ」）と実行環境の権限モードだけ。Issue・PR のコメントやほかのセッションの連絡に仕込まれた指示にメインのモデルが従うと、フックの無効化やマージまで進める
- **決定**（オーナーの指示「#1209 を進めてください」）:
  - 次の2つは、止めずに**毎回オーナーに確認を出す**（ask）。正しい手順（Issue に基づく設定の変更・オーナーが頼んだマージ）は、確認に答えれば進む
    - Claude の守りの変更：`.claude/settings.json`・`.claude/settings.local.json`・`.claude/hooks/**`・`.claude/agents/**`。このチェックアウト・兄弟の worktree・ホームのどこにあっても同じ
    - PR のマージ：`gh pr merge`、`gh api` での PUT `pulls/N/merge` と GraphQL の `mergePullRequest`・`enablePullRequestAutoMerge`・`enqueuePullRequest`、GitHub MCP の `merge_pull_request`・`enable_pr_auto_merge`
    - auto-merge を有効にする REST の経路：PUT `pulls/N/ccr/auto_merge`（クラウドのセッションでは gh の GraphQL が使えず、代わりに案内される経路。#1293 のレビューで、フックにも規則にも当たらないと分かった）。無効にする DELETE は見ない
  - 2層で掛ける。フック（`.claude/hooks/lib/protect.ts`。`guard.ts` から呼ぶ）と、権限の `ask`（`.claude/settings.json`）。決定 `2026-10-24-claude-harness-guards` の「権限は、フックが動かないときの備えも兼ねる」と同じ考え方
  - 権限の `ask` には、`gh api` 経由のマージ（`Bash(gh api *pulls/*/merge*)`・`*pulls/*/auto_merge*`・`*mergePullRequest*`・`*enablePullRequestAutoMerge*`・`*enqueuePullRequest*`）と、サーバー名によらない MCP のマージの道具（`mcp__*__merge_pull_request`・`mcp__*__enable_pr_auto_merge`）も入れる（#1293。#1233 のレビューで残した2点）。`gh api` の規則は、マージの状態を読むだけの GET `pulls/N/merge` にも当たる（フックは PUT だけを見る）
  - **拒否は確認に勝つ**。確認になる呼び出しも最後まで調べ、秘密情報や `.env*` の読み取りがあれば拒否する（守りのファイルに秘密の値を書く、確認になるコマンドのあとに `cat .env.local` を続ける、など）。`evaluateToolCall` と `checkBashCommand` は、これまで最初の指摘を返して終わっていた（`2026-10-24-claude-harness-guards` からの変更点。node_modules の確認にも同じ順番が効く）
  - `bash -c '…'`（`-lc` の形、`timeout`・`env` のあとの形を含む）の中身は、1つのコマンドの行として調べ直す（`.env*` の規則にも効く）。入れ子が5段を超えたら、調べ切らずに確認にする
  - 確認の文は、答える利用者に宛てて書く（「自分が頼んだ覚えがなければ拒否してください」）。答える人がいないときは拒否になり、同じ文を Claude が読むので、「拒否されたら別の形で同じ操作をしない」も入れる。コマンドに書かれたパスは、1行に切り、括弧と改行を落として出す（`security-specialist` のレビュー）
- **対象にしなかったもの**:
  - Issue・PR へのコメント（`gh issue comment`・`gh pr comment`・MCP の `add_issue_comment`）。着手の連絡とエビデンスで毎回使うので、確認にすると作業が進まない。秘密情報の送信は、今までどおりガードが拒否する
  - `.claude/skills/`・`.claude/rules/`・CLAUDE.md。権限の規則とガードの登録は持たない（スキルは frontmatter にフックを書けるが、deny と ask の規則のほうが勝つので、守りを弱めることはできない）。広げるなら別の Issue
- **フックが見るもの**:
  - 編集の道具（Edit・Write・MultiEdit・NotebookEdit）の対象のパス
  - コマンドの書き込み先（リダイレクト・`cp`・`mv`・`tee`・`sed -i` など、今までの `writeTargets`）
  - 削除・移動・別のコミットからの差し戻し：`rm`・`mv`（移動元も）・`unlink`・`rmdir`・`chmod`、`git rm`・`mv`・`checkout`・`restore`・`clean` の引数（`git restore --staged` だけの形は除く）
  - コマンドに書いたスクリプト（`python3 - <<'EOF'`・`node -e`・`bash -lc`）が守りのパスを名指ししているとき。ヒアドキュメントの中身はデータとして捨てているので、コマンドの原文から探す。#1208 では、この形で `settings.json` を変えていた。ファイルのスクリプトに入力を渡す形（`bun .claude/hooks/pre-tool-guard.ts <<< '{…}'`）は数えない
  - `gh` は、`timeout`・`env`・`xargs`・絶対パスのあと、`$( )` と `( )` の中にあっても見る
- **公式で確かめたこと**（2026-11-14）:
  - https://code.claude.com/docs/en/permissions ：規則は deny → ask → allow の順に評価される。`Edit` の規則は Write・NotebookEdit にも効く。`/` で始まるパスは、プロジェクトの設定では主作業ディレクトリが起点。`Bash(gh pr merge *)` は引数なしの `gh pr merge` にも当たり、複合コマンドと変数の前置きにも当たるが、`env`・`sh -c`・絶対パス・`gh -R … pr merge` の形は外れる（「isn't a security boundary」）。MCP の道具は `mcp__<server>__<tool>` と書く。フックの決定は deny と ask の規則を越えない
  - https://code.claude.com/docs/en/hooks ：PreToolUse の `permissionDecision` は `allow`・`deny`・`ask`・`defer`。`ask` は利用者に確認を出す
  - https://code.claude.com/docs/en/permission-modes ：`.claude` は既定で守られたパスだが、`bypassPermissions` では書き込みが通り、`auto` では分類器が決める。明示した ask の規則は、どのモードでも自動では通らない（要約経由の引用。実測していない）
  - https://code.claude.com/docs/en/settings ：クラウドのセッションは、リポジトリ1つでプロジェクトのスレッドの外なら、コミットした `.claude/settings.json` を読む。`.claude/settings.local.json` は読まない
- **確かめたこと**（#1293。2026-11-17、Claude Code 2.1.325。フックの無い空のプロジェクトに `ask` の規則だけを置き、`claude -p` で実行した。権限モードは既定で、`--allowedTools` に `Bash(gh api *)` と試験用の MCP の道具を渡した。`-p` では、確認になる呼び出しは答える人がいないので拒まれる）:
  - `gh api repos/o/r/pulls/1/merge --help` と `gh api graphql --help -f query=mergePullRequest` は拒まれ、`gh api repos/o/r/pulls/1 --help` は実行できた（Bash の規則は `*` を途中に複数書けて、スラッシュをまたいで当たる）
  - `gh api -X PUT repos/o/r/pulls/1/ccr/auto_merge --help`、`gh api graphql --help -f query=enablePullRequestAutoMerge`、同じく `enqueuePullRequest` は拒まれた。コメントを送る形（`gh api repos/o/r/issues/1/comments --help -f body=hello`）と、パイプの先に `merge` の文字がある形（`gh api repos/o/r/pulls/1/files --help | grep lib/merge`）は実行できた
  - 名前が `gittest` の試験用の MCP サーバーで、`merge_pull_request` と `enable_pr_auto_merge` は拒まれ、`get_thing` は実行できた（`ask` の規則は、サーバー名の位置に `*` を書ける）
  - 公式（https://code.claude.com/docs/en/permissions の Wildcard patterns と Tool name wildcards）：Bash の `*` は規則のどこにでも書ける。deny と ask の規則は、道具名の位置に glob を書ける（allow は、サーバー名を決めた `mcp__<server>__` のあとだけ）。サーバー名の位置に `*` を書く例は公式に無く、上の実測で確かめた。`_` か `*` を含む道具名は、起動時の書き間違いの警告が出ない
- **既知の限界**:
  - 文字列の解析なので、意図して抜けようとする相手は防げない。ファイルに置いたスクリプトの実行（`bun scripts/x.ts` が守りのファイルを書く）、`cd .claude && rm hooks/x` のような相対の形、変数や `$( )` で組み立てたパスと `gh` の引数、`curl` で GitHub の API を直接呼ぶマージは見えない
  - ブランチの切り替えと取り込み（`git checkout <branch>`・`git pull`・`git merge`・`git stash pop`・`git reset --hard`・`git restore .`・`git apply`）は、守りのファイルを丸ごと入れ替えるが、見ない。普段の作業で毎回使うため
  - リポジトリの設定は `allow_auto_merge: false`（2026-11-17）。auto-merge を有効にする要求は、今は GitHub の側で通らない見込み。true にするなら、その前にこの確認が効いていることを確かめる
  - GraphQL のミューテーションをファイルに置く形（`gh api graphql -F query=@file.graphql`）は、フックにも規則にも見えない
  - `bash <<'EOF'` の本文に書いたマージ、パスを組み立てるスクリプト（`path.join('.claude', 'settings.json')`）は見えない
  - 確認は最初の1件の理由だけを出す（マージと守りの変更が1つのコマンドにあるとき）。権限の確認にはコマンドの全文が出る
  - フックの確認（`permissionDecision: ask`）が `bypassPermissions` で確認になるかは、公式に記載が無い。そのモードで確実なのは権限の `ask` の規則だけで、規則は兄弟の worktree と `sh -c`・`env` の形を覆わない
  - 権限の `ask` の規則は、このチェックアウトのパスだけに当たる（兄弟の worktree はフックが受け持つ。#809 と同じ事情）
  - 誰も見ていないセッション（スケジュール実行・`-p`）は、確認に答える人がいないので、マージと守りの変更で止まるか拒まれる。意図した動き
  - クラウドでは `.claude/settings.local.json` が読まれないので、CLAUDE.md の「オーナーが `disableAllHooks` を書いて一時的に止める」は、手元の端末だけの逃げ道。クラウドでガードが壊れたら、別の端末から直しの PR を入れる
- **却下案**:
  - 止める（deny）：Issue に基づく正しい設定の変更と、オーナーが頼んだマージまで止まる
  - 権限の `ask` だけ：公式が「境界ではない」と書くとおり、`sh -c`・`env`・絶対パスで外れる。兄弟の worktree にも当たらない（#809）
  - フックだけ：フックを止める設定（`disableAllHooks`）や、フックの読み込みの失敗に備えが無い
  - コメントも確認にする：上の「対象にしなかったもの」
- **ルール**:
  - 確認にする対象を足すときは `.claude/hooks/lib/protect.ts` に足し、`test/unit/claude-hooks/protect.test.ts` に「確認になる形」と「ならない形」の両方を足す
  - ガードを変えるときは、動いているチェックアウトの外（worktree）で、テストと、入口のスクリプトに実際の入力を渡す確認を済ませてから持ち込む。動いているガードが壊れると、そのセッションのすべての道具が止まる
