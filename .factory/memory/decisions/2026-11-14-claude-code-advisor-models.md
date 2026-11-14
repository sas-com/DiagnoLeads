---
id: 2026-11-14-claude-code-advisor-models
date: 2026-11-14
category: Process
title: "Claude Code はメインを Sonnet・相談役（advisor）を Fable・専門エージェントを Opus（セキュリティは Fable）にして試す（#1208）"
status: active
superseded_by: []
issues: [1208]
paths: [".claude/settings.json", ".claude/agents/**"]
---

### [Process] Claude Code はメインを Sonnet・相談役（advisor）を Fable・専門エージェントを Opus（セキュリティは Fable）にして試す（#1208）
- **日付**: 2026-11-14
- **決定**: `.claude/settings.json` に `model: sonnet` と `advisorModel: fable` を置き、専門エージェント（`.claude/agents/*-specialist.md`）の frontmatter に `model: opus` を置く（`security-specialist` だけは `model: fable`）。実装は Sonnet が書き、方針を決める前・同じエラーが続くとき・完了を宣言する前に Fable に相談する構成を試す（オーナーの指示。SNS の紹介を公式で確かめたうえで入れた）
- **理由**:
  - 作業の費用を下げる。公式の説明では、節約になるのは最終の出力を下位のメインのモデルが書くから
  - メインを Sonnet にすると、専門エージェントは親のモデルを引き継いで Sonnet に下がるので、モデルを固定する
  - これまでの専門エージェントは、Fable のセッションでは Fable で動いていた。Opus に固定すると、メインが Sonnet のときは底上げ、メインが Fable のときは格下げになる。マージ前の必須のレビューである `security-specialist` は質を下げないよう Fable にし、ほかの6つは費用を取って Opus にする（セキュリティレビューの指摘）
- **ルール**:
  - advisor はメインのモデル以上でなければ付かない。メインが Fable のとき付くのは Fable だけで、その場合は advisor の分だけ費用が増える。**費用が下がるのは、メインが Sonnet のセッションだけ**
  - クラウドのセッションは、アプリで選んだモデルで起動する。設定の `model` より起動時の指定が優先されるので、クラウドで費用を下げるには、アプリのモデル選択で Sonnet を選ぶ。Fable を選ぶと、メインは Fable のまま Fable の advisor が上乗せされる
  - 手元の CLI では、設定の `model` が各自の `/model` で保存した既定より優先される。そのセッションだけ変えるときは `/model <名前>`・`/advisor off` を使う
  - サブエージェントは親の advisor を引き継ぐ。Fable の advisor の利用分は、プランによって usage credits に課金される
  - 相談の回数を決める設定は無い。増やす・減らすときは指示に書く。CLAUDE.md に「いつ相談するか」の行は、呼ばれ方を見てから決める
  - 戻すときは、`.claude/settings.json` の2つのキーと、専門エージェントの `model` の行を消す
- **確かめたこと**（2026-11-14、Claude Code 2.1.325、クラウドのコンテナの中で `claude -p`）:
  - 設定あり：使われたモデルは Sonnet 5.5、`/advisor` の表示は Fable 5.2
  - 設定なし：使われたモデルは Fable 5.2、`/advisor` の表示は off
  - 設定ありで専門エージェントを呼ぶ：`security-specialist` は Fable 5.2、`architecture-specialist` は Opus 5.5 で動いた
  - 設定を置いたクラウドのセッション（アプリで Fable を選んだもの）：メインは Fable のまま、advisor が付いた
  - 公式：https://code.claude.com/docs/en/advisor ・ https://code.claude.com/docs/en/sub-agents ・ https://code.claude.com/docs/en/model-config ・ https://code.claude.com/docs/en/settings
- **公式に記載が無いこと**: クラウドのセッションでの advisor の対応、アプリのモデル選択と設定の `model` の優先順位。SNS の「3.4倍安い」「指示の行が無いと advisor が一度も呼ばれない」は公式に裏付けが無い
- **却下案**:
  - `advisorModel` だけを置く（メインが Fable のままだと費用が増えるだけになる）
  - `CLAUDE_CODE_SUBAGENT_MODEL` で全サブエージェントを Haiku にする（調査の質が下がる。公式の優先順位は、呼び出し時の指定・frontmatter・この環境変数・親のモデルの順なので、専門エージェントには効かないが、ほかの調査が下がる）
  - 専門エージェントを親のモデルの引き継ぎのままにする（メインが Sonnet のとき、必須のレビューが Sonnet になる）
