---
id: 2026-10-24-harness-guards-hardening
date: 2026-10-24
category: Process
title: "ガードは判定できないときに止め、専門エージェントの読み取り専用もフックで守る（#461）"
status: active
superseded_by: []
issues: [461, 426]
paths: [".claude/settings.json", ".claude/hooks/**", ".claude/agents/**"]
---

### [Process] ガードは判定できないときに止め、専門エージェントの読み取り専用もフックで守る（#461）
- **日付**: 2026-10-24
- **決定**（オーナーの判断。推奨どおり）:
  - PreToolUse のガードだけ、壊れたとき・判定できないときは止める側にする。settings.json に `"onFailure": "block"`（起動の失敗とタイムアウト）を付け、ガードのスクリプトは想定外のエラーで exit 2 にする。セッション開始と決定の通知のフックは、今までどおり素通り（`2026-10-24-claude-harness-guards` の「フックは壊れても作業を止めない」は、ガード以外に当てはまる）
  - 名前が `-specialist` の専門エージェントの中では、ガードが読み取り専用のルールを掛ける（`.claude/hooks/lib/readonly.ts`）。フックの入力の `agent_type` で見分ける
  - サンドボックスは今は入れない
- **理由**:
  - 公式（https://code.claude.com/docs/en/hooks）：パスの間違いや異常終了したポリシーのフックは、すべてを素通りにする。ガードは秘密情報の書き込み（2026-10-15 の CRITICAL）の再発防止策なので、黙って通るより、止まって気づくほうが安全
  - 公式（https://code.claude.com/docs/en/sub-agents）：tools に Bash があると、読み取り専用にはならない。専門エージェントのレビュー（`2026-10-19-security-review-gate`）は読み取り専用が前提なのに、本文の指示だけに頼っていた
  - エージェントの frontmatter に書くフックは、フォルダを信頼していないセッション（`-p`・SDK）では使われない（https://code.claude.com/docs/en/permissions）。settings.json のフックはサブエージェントの中でも動き、入力に `agent_type` が入る（hooks のページ）ので、こちらで判定する
  - サンドボックス：クラウドのセッションは、隔離された VM・通信の制限・VM の外に置いた認証情報ですでに守られている（https://code.claude.com/docs/en/claude-code-on-the-web）。クラウドの VM には bubblewrap と socat が無く、プロジェクトの設定で有効にすると、黙って素通りになるか（既定）、`failIfUnavailable` でセッションが起動しなくなる
- **ルール**:
  - 読み取り専用のルールで通すもの：読むだけのコマンド（一覧にあるもの）、`git` の読み取り（`fetch` を含む。`src:dst` の形は除く）、`gh` の参照（`pr view` など、`api` は GET だけ）、読み取りのスクリプト（`bun run test:run`・`typecheck`・`lint` など。vitest・tsc・biome は書き込みもコードの読み込みもしないオプションだけ）
  - 書き込みは `/dev/null` だけ。一時ディレクトリにも書かない（そこに置いた設定やスクリプトを、テストランナーの `--config` や git の `-C` に読ませると、コマンドを動かせるため。#508 の見直し）。出力はパイプでつなぐ
  - 止めるもの：一覧に無いコマンド、ファイル・リポジトリ・GitHub を変えるサブコマンド、依存の変更、インラインのスクリプトとスクリプトの実行（`node -e`・`bun x.ts`。`bash -c` と `$( )` の中も検査する）、外部への送信（curl の POST など。curl は許可したオプションだけ）、読み取りではない MCP のツール、Edit・Write
  - 読み取りのコマンドでも、書き込みやコマンドの実行の機能は止める：`sort -o`・`uniq` の出力先・`rg --pre`・`git grep -O`・`sed` の e と w（`--sandbox` を付ければ通す）・`git fetch --upload-pack`・vitest の `--outputFile` と `--config`・tsc の `--noEmit false`・`bun test`（vitest の設定を使わず、実 DB のテストまで動かす）など
  - 変数：プログラムに渡せるのは LANG・LC_*・TZ・NO_COLOR・CI・TERM などだけ。`GIT_EXTERNAL_DIFF`・`GIT_CONFIG_*`・`NODE_OPTIONS`・`BASH_ENV`・`PATH`・`HOME` は、プログラムに別のコマンドを動かさせられる。シェルの中だけの変数は小文字の名前なら通す。環境変数の表示（`env`・`export`・`set`）は止める
  - 壊れたガードで作業が止まったら、まず直す。すぐに続ける必要があるときは、オーナーが `.claude/settings.local.json`（Git に入らない）に `"disableAllHooks": true` を書くと、その端末だけフックを止められる（公式の設定）
  - 権限：DB のスクリプトの直接の実行（`bun scripts/db-*` など）と、`git fetch` の `--u` で始まるオプション（`--upload-pack` など）は毎回確認する
  - フックのログと既読の記録は、利用者ごとの 0700 のディレクトリ（`<一時ディレクトリ>/claude-hooks-<uid>`）に書く（決まった名前のファイルは、ほかの利用者がシンボリックリンクを置ける）
  - 決定の通知は、触ったファイルが属するチェックアウト（worktree を含む）の根からパスを求める。worktree では `CLAUDE_PROJECT_DIR` が元のチェックアウトを指したままになるため
- **既知の限界**（読み取り専用のルール）：文字列の解析なので、意図して抜けようとする相手は防げない（`$( )`・変数・ブレースの展開や `xargs` の入力でオプションを足す、GET の URL に載せて送る など）。許可した読み取りのコマンドは、知られた書き込みと実行のオプションを止めているだけで、すべての機能を見てはいない
- **却下案**: エージェントの frontmatter のフック（クラウドと `-p` で動かない）。専門エージェントから Bash を外す（`git diff`・`gh pr view` が使えず、レビューにならない）。サンドボックスを今入れる（上の理由）
