---
id: 2026-10-26-session-start-latest-main
date: 2026-10-26
category: Process
title: "並行のセッションは、作業ディレクトリを最新の main にそろえてから始め、兄弟の worktree で作業する。子の agent はルールを自分で読む（#784）"
status: active
superseded_by: []
issues: [784, 461, 809]
paths: [".claude/settings.json", ".claude/hooks/**", ".claude/rules/**"]
---

### [Process] 並行のセッションは、作業ディレクトリを最新の main にそろえてから始め、兄弟の worktree で作業する。子の agent はルールを自分で読む（#784）
- **日付**: 2026-10-26
- **決定**（オーナーの判断。#784 の 2026-10-26 のコメント）:
  - セッションを始める前に、作業ディレクトリ（primary working directory。例 `/home/user/DiagnoLeads`）を最新の main にそろえる。切り離した HEAD にして、編集しない
    - `git -C <作業ディレクトリ> fetch origin main && git -C <作業ディレクトリ> checkout --detach origin/main` のあと、そのディレクトリで `bun install --frozen-lockfile`
  - 作業は、最新の main から作った兄弟の worktree（例 `/home/user/wt-<key>`）で、絶対パスで行う：`git -C <作業ディレクトリ> worktree add -b <branch> /home/user/wt-<key> origin/main`
  - 子の agent は、触るファイルに当たる `.claude/rules/*.md` と今の CLAUDE.md を自分で Read する。調整役は依頼文に、読むルールの名前を書く
  - ガードと決定の通知のフックは、兄弟の worktree での操作にも当たる（下の「確かめたこと」）。動くのは作業ディレクトリのチェックアウトにあるフック
- **理由**:
  - フックと `.claude/settings.json` は作業ディレクトリの `.claude/` から読まれ、親のディレクトリへはさかのぼらない（https://code.claude.com/docs/en/permissions の「Additional directories grant file access, not configuration」）。フックのコマンドの `${CLAUDE_PROJECT_DIR}` は、セッションを始めたプロジェクトの根を指したまま（https://code.claude.com/docs/en/hooks の「Worktrees are different」）。作業ディレクトリが古くて `.claude/settings.json` が無いと（#784 の 649ef222）、ガードも決定の通知もどこにも当たらない
  - パスで絞ったルールは、そのルールの `.claude` を持つディレクトリからの相対で照合される。兄弟の worktree のファイルに読み込ませるには、その worktree でセッションを始めるか `/cd` で移る（https://code.claude.com/docs/en/memory の「Path-specific rules」）
  - CLAUDE.md は起動のときに読まれ、`/compact` のあとにディスクから読み直される（memory のページ）。子の agent は、メインの会話が読み込んだ CLAUDE.md を受け取る（https://code.claude.com/docs/en/sub-agents の「What loads at startup」）
    - 2026-10-26、作業ディレクトリを途中で 649ef222 から 8ee03373 に移した会話から起動した子の agent に渡った CLAUDE.md は、649ef222 の版（見出し「DiagnoLeads v2 開発ルール」）だった。ディスクの CLAUDE.md は今の版だった
    - フックとスキルは途中から効いた（hooks のページ：設定ファイルのフックの直接の編集は、ファイルの監視が拾う）
    - だから「始める前に」そろえる。途中でそろえたときは、起動し直すまで、子に今の CLAUDE.md を読ませる
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
  - `.env*` は試していない（触らない）。`.env*` のルールが worktree のパスにも当たることは、コードとユニットテスト（`test/unit/claude-hooks/guard.test.ts` の `/other/worktree/.env`）で確かめた
- **ルール**:
  - 作業ディレクトリは main を映すだけにし、編集もブランチの切り替えもしない。ほかのセッションのフック・スキル・CLAUDE.md の元になる
  - worktree のブランチでフックを変えても、そのセッションの操作には効かない（動くのは作業ディレクトリのフック）。フックの変更は、`test/unit/claude-hooks/` と、スクリプトに入力を流して確かめる
  - 権限の deny（`Edit(./bun.lock)`・`Read(./.env.local)` など）は今のディレクトリからの相対で当たるので（permissions のページの「How path patterns match」）、兄弟の worktree の bun.lock・`.env*` を守るのはフックだけ。`disableAllHooks` でフックを止めると守りが無くなる。当てるかどうかは #809
- **CLAUDE.md への推奨**（変えるかはオーナーが決める。CLAUDE.md の6）:
  - 「並行するセッションとの連携」に1行足す：セッションを始める前に作業ディレクトリを最新の main にそろえ（切り離した HEAD・編集しない）、作業は兄弟の worktree で行う。兄弟の worktree では `.claude/rules/` が自動で読み込まれないので、子の agent には該当するルールと今の CLAUDE.md を読ませる（この決定）
  - 「置き場所」の「該当するファイルを触ると読み込まれる」に、「作業ディレクトリの中のファイルだけ」と足す
- **却下案**:
  - 子のセッションを worktree で始める、または `/cd` で移る：ルールもフックも worktree の版になり、いちばん確実。ただ、今の進め方（1つの会話から子の agent を出す）では、子の agent はメインの会話の作業ディレクトリで始まり（sub-agents のページ）、子ごとに変えられない。`/cd` は人が打つコマンドで、Claude からは呼べない（permissions のページの「Cd」）。別のセッションとして worktree で始めるときは、そうしてよい
  - 何もしない（作業ディレクトリが古いまま）：フックが当たらず、古い CLAUDE.md が読まれる（#784）
  - 子の agent の `isolation: worktree`（一時的な worktree を作る）は試していない。名前を決めたブランチと場所で作る今の進め方に合うかは、使うときに確かめる
