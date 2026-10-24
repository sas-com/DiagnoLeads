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
    - 編集・読み取り・コマンド・MCP の前（`pre-tool-guard.ts`）に止めるもの
      - bun.lock と `.env*` の編集
      - `.env*` の読み取りと表示。`source`・`grep -q`・`test -f` のように値を出さない使い方と、env ファイル同士のコピーは通す。語の中に書いた形（`curl -d @.env.local`・`--env-file=.env.local`・`dd if=.env.local`・`$(<.env.local)`）も止める（#508）
      - Bun の共有キャッシュとハードリンクでつながった node_modules のファイル（リンク数2以上）への書き込み。`bun patch` で取り出したコピー（リンク数1）の編集は、利用者に確認を出す
      - 秘密情報の書き込みと送信：本番の接続文字列・API キー・秘密鍵、`NAME=値` の形の秘密の値
    - テストの架空の値は、文字列を組み立てて書くか、ファイルのその行に `gitleaks:allow` を付ける（Issue・PR・コマンドには効かない）
    - 読み取り・編集の後：そのファイルに関係する決定を知らせる
  - 権限
    - 禁止：`.env*` の読み取りと編集、bun.lock の編集、main への push。フックが動かないときの備えも兼ねる
    - 毎回確認：DB を変えるスクリプト、E2E、node_modules の編集
    - 確認なし：検証のコマンド
    - `git fetch` は origin だけ確認なしにする（`--upload-pack` で手元のコマンドを動かせるため。`--u` で始まるオプションは確認する：`2026-10-24-harness-guards-hardening`）
  - `.gitignore` は `.env*` を無視し、テンプレート（`*.example`）だけを追跡する
  - フックは壊れても作業を止めない（想定外のエラーは素通りさせる）。ただし PreToolUse のガードは、判定できないときに止める側にした（`2026-10-24-harness-guards-hardening`）
  - ルールを足すときは `.claude/hooks/lib/` に書き、`test/unit/claude-hooks/` にテストを足す。フックの型は `bun run typecheck` で検査される
  - 認証・セキュリティの PR と同じく、フックを変える PR は読み取り専用のセキュリティレビューを通す（#438 で blocker なし、should-fix 5件を反映）
- **既知の限界**：コマンドの検査では、次の経路で値が出るのを止められない。確実なのは、手元の `.env.local` に本番のキーを置かないこと
  - `source` した後の `echo`
  - `bun -e`（Bun は `.env.local` を自動で読む）
  - `env`
  - ルートからの `grep -r`
- **却下案**: 文章のルールを強める（守られないことがすでに起きている）。編集のたびに biome format をかける（lefthook がコミット時にかけている。編集中にファイルが書き換わると、Claude の次の編集が一致せず失敗しやすい）。node_modules の編集をすべて止める（`bun patch` の正しい手順まで止まる）
