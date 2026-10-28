---
id: 2026-10-26-session-start-latest-main
date: 2026-10-26
category: Process
title: "並行のセッションは、作業ディレクトリを最新の main にそろえてから始め、兄弟の worktree で作業する。子の agent はルールを自分で読む（#784）"
status: active
superseded_by: []
issues: [784, 461, 809, 821]
paths: [".claude/settings.json", ".claude/hooks/**", ".claude/rules/**"]
---

### [Process] 並行のセッションは、作業ディレクトリを最新の main にそろえてから始め、兄弟の worktree で作業する。子の agent はルールを自分で読む（#784）
- **日付**: 2026-10-26
- **決定**:
  - オーナーの判断（#784 の 2026-10-26 のコメント「オーナーの判断と進み具合」）
    - セッションを始める前に、作業ディレクトリ（primary working directory。例 `/home/user/DiagnoLeads`）を最新の main にそろえる。切り離した HEAD にして、編集しない
    - 兄弟の worktree で作業するときは、該当する `.claude/rules/*.md` を自分で読む。子の agent には、依頼文でそう書く
  - 手順（この決定を書いたセッションが、下の「確かめたこと」をもとに足した。オーナーの判断ではない）
    - 作業ディレクトリ：`git -C <作業ディレクトリ> fetch origin main && git -C <作業ディレクトリ> checkout --detach origin/main`。依存のインストールは要らない。フックは `node:` の組み込みモジュールだけを使い、コミットのときの lefthook は worktree の node_modules から動く。クラウドでは、SessionStart フックが起動のときに作業ディレクトリで `bun install --frozen-lockfile` を流す
    - worktree：`git -C <作業ディレクトリ> worktree add -b <branch> /home/user/wt-<key> origin/main` のあと、worktree の中で `bun install --frozen-lockfile` を流す。worktree の node_modules は別のディレクトリで、`/home/user/wt-*` は作業ディレクトリの下に無いので、作業ディレクトリの node_modules は使われない。入れないと test も typecheck も動かない
    - 作業は worktree で、絶対パスで行う
    - 子の agent は、触るファイルに当たる `.claude/rules/*.md` と、worktree の CLAUDE.md（最新の main から切ったもの）を自分で Read する。調整役は依頼文に、読むルールの名前を書く
  - ガードと決定の通知のフックは、兄弟の worktree での操作にも当たる（下の「確かめたこと」）。動くのは、作業ディレクトリのチェックアウトにあるフックのスクリプト
- **理由**:
  - フックと `.claude/settings.json` は作業ディレクトリの `.claude/` から読まれ、親のディレクトリへはさかのぼらない（https://code.claude.com/docs/en/permissions の「Additional directories grant file access, not configuration」：「Hooks and other `.claude/settings.json` keys load from the current working directory's `.claude/` folder with no parent-directory fallback」）。作業ディレクトリが古くて `.claude/settings.json` が無いと（#784 の 649ef222）、ガードも決定の通知もどこにも当たらない
  - このリポジトリのフックは `bun ${CLAUDE_PROJECT_DIR}/.claude/hooks/*.ts` で動く（`.claude/settings.json` の `args`）。`${CLAUDE_PROJECT_DIR}` はセッションを始めたプロジェクトの根（https://code.claude.com/docs/en/hooks の「Reference scripts by path」）。この手順ではセッションが worktree に入らないので、最初から作業ディレクトリを指す
  - セッション開始の決定の索引（`.claude/hooks/session-start.ts` の `loadDecisions`）は、`CLAUDE_PROJECT_DIR`、つまり作業ディレクトリから読む。worktree のブランチにしかない決定は索引に出ない（PostToolUse の通知は、触ったファイルのチェックアウトから決定を読むので出る。#461）。これも、作業ディレクトリを最新の main にそろえる理由
  - パスで絞ったルールは、そのルールの `.claude` を持つディレクトリからの相対で照合される。兄弟の worktree のファイルに読み込ませるには、その worktree でセッションを始めるか `/cd` で移る（https://code.claude.com/docs/en/memory の「Path-specific rules」）
  - CLAUDE.md は起動のときに読まれ、`/compact` のあとにディスクから読み直される（memory のページ）。子の agent は、メインの会話が読み込んだ CLAUDE.md を受け取る（https://code.claude.com/docs/en/sub-agents の「What loads at startup」）
    - 2026-10-26、作業ディレクトリを途中で 649ef222 から 8ee03373 に移した会話から起動した子の agent に渡った CLAUDE.md は、649ef222 の版（見出し「DiagnoLeads v2 開発ルール」）だった。ディスクの CLAUDE.md は今の版だった
    - フックとスキルは途中から効いた（hooks のページ：設定ファイルのフックの直接の編集は、ファイルの監視が拾う）
    - だから「始める前に」そろえる。途中でそろえたときは、起動し直すまで、子に worktree の CLAUDE.md を読ませる
- **確かめたこと**（2026-10-26。作業ディレクトリ `/home/user/DiagnoLeads` は 8ee03373、worktree `/home/user/wt-784` は 89404e8d で、`.claude/` に差は無い）:
  - ガード（`.claude/hooks/pre-tool-guard.ts`）のコード
    - settings.json の matcher はツールの名前だけを見るので、フックはパスにかかわらず動く
    - bun.lock と `.env*` はファイル名で判定する（`checkEditPath`・`isSecretEnvFile`）。プロジェクトの外のパスには絶対パスのまま同じルールを当てる（`displayPath`）。`CLAUDE_PROJECT_DIR` の外を通す分岐は無い
  - 兄弟の worktree の `/home/user/wt-784/bun.lock` への Edit（1行の書き換え）を、ガードが `[guard:lockfile]` で止めた（`PreToolUse:Edit hook error`）。ファイルは変わらなかった（`git status` が空）
  - ガードのスクリプトに、作った入力を流した
    - Edit の `/home/user/wt-784/bun.lock` と、Bash の `printf x >> /home/user/wt-784/bun.lock` は exit 2 で止めた
    - Edit の `/home/user/wt-784/README.md` は通した
  - 決定の通知（PostToolUse）は、worktree の `.claude/rules/api-routers.md` と `bun.lock` を Read したときに、関係する決定（`2026-10-24-official-docs-check`・`2026-10-21-frozen-lockfile-on-vercel`）を知らせた。#461 のとおり、触ったファイルのチェックアウトから決定を読む
  - worktree の `lib/features/notifications/api/router.ts` を Read しても、`.claude/rules/api-routers.md` は読み込まれなかった（作業ディレクトリの同じファイルでは読み込まれる。#784 のコメント）
  - `.env*` は試していない（触らない）。bun.lock と `.env*` の編集のルールがプロジェクトの外のパスにも当たることは、コード（`.claude/hooks/lib/guard.ts` の `displayPath`・`checkEditPath` と、`checkBashCommand` の書き込み先の検査）で確かめた。ユニットテストで固定しているのは、プロジェクトの外の読み取り（`test/unit/claude-hooks/guard.test.ts` の Grep の `/other/worktree/.env`）だけ。編集と Bash の書き込みのテストを足すのは #821
- **ルール**:
  - 作業ディレクトリは main を映すだけにし、編集もブランチの切り替えもしない。ほかのセッションのフック・スキル・CLAUDE.md の元になる
  - 作業ディレクトリをセッションの途中で更新すると、そこで動いているすべてのセッション（子の agent を含む）のフックのスクリプトが一斉に切り替わる。checkout の最中に呼ばれたフックが、一瞬 fail-closed で止まることもありうる（推測。試していない）。途中で更新するときは、子の agent が動いていない合間に行う
  - worktree のブランチでフックを変えても、そのセッションの操作には効かない（動くのは作業ディレクトリのフック）。フックの変更は、`test/unit/claude-hooks/` と、スクリプトに入力を流して確かめる
  - 権限の deny（`Edit(./bun.lock)`・`Read(./.env.local)` など）は今のディレクトリからの相対で当たるので（permissions のページの「How path patterns match」）、兄弟の worktree の bun.lock・`.env*` を守るのはフックだけ。`disableAllHooks` でフックを止めると守りが無くなる。当てるかどうかは #809
- **CLAUDE.md への推奨**（変えるかはオーナーが決める。CLAUDE.md の6）:
  - 「並行するセッションとの連携」に1行足す：セッションを始める前に作業ディレクトリを最新の main にそろえ（切り離した HEAD・編集しない）、作業は兄弟の worktree で行う。兄弟の worktree では `.claude/rules/` が自動で読み込まれないので、子の agent には該当するルールと worktree の CLAUDE.md を読ませる（この決定）
  - 「置き場所」の「該当するファイルを触ると読み込まれる」に、「作業ディレクトリの中のファイルだけ」と足す
- **却下案**:
  - 子のセッションを worktree で始める：ルール・設定・フックのスクリプトのすべてが worktree の版になり、いちばん確実。ただ、今の進め方（1つの会話から子の agent を出す）では、子の agent はメインの会話の作業ディレクトリで始まる（sub-agents のページ）。別のセッションとして worktree で始めるときは、そうしてよい
  - `/cd` で worktree に移る：ルールと設定（フックの定義を含む）は worktree の版になる。ただ、移ったあとのフックにも `${CLAUDE_PROJECT_DIR}` はセッションを始めたプロジェクトの根が渡るので（permissions のページの「Move the session to another directory」）、動くフックのスクリプトは始めたディレクトリのもののまま。worktree の版のスクリプトが動くのは、最初から worktree で始めたセッションだけ。また `/cd` は人が打つコマンドで、Claude からは呼べない（permissions のページの「Cd」）
  - `EnterWorktree` で worktree に入る：Claude から呼べるが、`.claude/worktrees/` の外へ移るときはユーザーの承認が要り、セッション全体（作業ディレクトリ・書き込み・CLAUDE.md と設定）が移る（https://code.claude.com/docs/en/worktrees の「Ask Claude to create a worktree」）。フックの `${CLAUDE_PROJECT_DIR}` は始めたディレクトリのまま。調整役の会話ごと1つの worktree に移るので、子の agent を並べる今の進め方に合わない
  - 子の agent の `isolation: worktree`：Agent の呼び出しごとにも渡せる（sub-agents のページ）。ただ、自分の worktree で動く子の agent は、CLAUDE.md などをメインの会話から受け取り、`.claude/worktrees/` の下にある worktree の CLAUDE.md と `.claude/rules/` を読み込まない（worktrees のページの「Isolate subagents with worktrees」）。子がルールを自分で読む必要は変わらない。一時的な worktree を Claude Code が作って片付ける仕組みで、名前を決めたブランチと場所で作る今の進め方とは別なので、使うなら別に決める
  - 何もしない（作業ディレクトリが古いまま）：フックが当たらず、古い CLAUDE.md が読まれる（#784）
