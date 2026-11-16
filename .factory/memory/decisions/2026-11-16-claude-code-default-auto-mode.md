---
id: 2026-11-16-claude-code-default-auto-mode
date: 2026-11-16
category: Process
title: "Claude Code の対話セッションの既定（auto モード）を変えず、permissions.defaultMode を設定しない（#1138）"
status: active
superseded_by: []
issues: [1138]
paths: [".claude/settings.json"]
---

### [Process] Claude Code の対話セッションの既定（auto モード）を変えず、permissions.defaultMode を設定しない（#1138）
- **日付**: 2026-11-16
- **決定**（オーナー判断。推奨を添えて問い直し、「既定のまま」を選んだ）: Claude Code v2.1.284 から、権限モードを設定していない手元の対話セッションは auto モードで始まる。`.claude/settings.json` に `permissions.defaultMode` を足さず、この既定のままにする
- **理由**:
  - 公式（https://code.claude.com/docs/en/permission-modes 、参照日 2026-11-16）
    - `.claude/settings.json` と `.claude/settings.local.json` では `auto` と `bypassPermissions` が効かない。リポジトリで選べるのは `default`（毎回確認）などに固定することだけ
    - auto モードでも、明示的な ask ルールに当たる操作・deny ルール・protected paths（`.claude/`・`.git` など）の扱いは残る。分類器はツールの出力を見ないので、ファイルや Web ページに書かれた指示に直接は操られない
    - 分類器が3回続けてか合計20回止めると、auto モードは一時停止して確認に戻る
  - このリポジトリでは、重要な操作を ask（DB を変えるスクリプト・E2E・`.claude/` の設定とフックとエージェントの編集・PR のマージ）と deny（`.env*`・bun.lock・main への push・`pkill`・`killall`）とフックのガードで止めている（決定 `2026-10-24-claude-harness-guards`・`2026-11-15-deny-name-based-kill`）
  - オーナーの好み（確認は重要な判断だけで、ほかは自律で進める）に合う
- **ルール**:
  - 新しく止めたい操作は、モードではなく ask・deny のルールかフックに足す
  - クラウドのセッションは、アプリで選んだモードで動く（設定ファイルの `bypassPermissions`・`dontAsk` は無視される）
- **却下案**: `permissions.defaultMode: "default"` で毎回確認に固定する（確認が大幅に増えて作業が遅くなる。効くのは主に手元の CLI）
