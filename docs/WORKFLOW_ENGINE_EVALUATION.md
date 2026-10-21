# ワークフローエンジン選定の評価（DiagnoLeads 向け）

> 作成日: 2026年10月21日 / 参照日: 2026年10月21日
> 本スコアは AI による定性評価です。最終判断は PoC の結果と関係部門の確認を踏まえて行ってください。

## 要約

- MIRAI 向け（Java 前提）の評価を、本リポジトリ（TypeScript / Next.js / Vercel / Postgres）の前提で採点し直しました。「Java親和性」は「スタック親和性」に置き換えています。
- 結果は **Inngest が87点で首位**、Vercel Workflows が84点、Trigger.dev が81点です。Java 前提で首位だった Temporal は、Vercel 上で常駐ワーカーを持てない点で71点に下がります。
- Claude 親和性の重みを0にしても上位3候補の順位は変わりません。Inngest と Vercel Workflows の2案で PoC を行うことを提案します。

## 1. 前提：今のワークフロー機能の状態

| 項目 | 現状 | 根拠 |
|---|---|---|
| 定義の保存 | できる（`workflows` テーブル、tRPC の CRUD） | `lib/features/workflows/api/router.ts` |
| 実行 | **アプリから呼ばれていない** | `lib/workflow/engine.ts` の `WorkflowEngine` を import している箇所がない |
| 実行の記録 | テーブルはあるが、書き込む処理がない | `lib/db/schema.ts` の `workflowExecutions` |
| 状態の保持 | メモリ上のみ（再起動・デプロイで消える） | `WorkflowEngine.executions`（`Map`） |
| 待機（delay） | 実際は最大100ミリ秒で打ち切り | `engine.ts` の `executeDelay` |
| ジョブキュー | メモリ上のみ（BullMQ 等への置き換えを想定したコメントあり） | `lib/jobs/queue.ts` |
| 定期実行 | Vercel Cron（2本）。関数の実行時間は30秒まで | `vercel.json` |

「リード作成の3日後にフォローメール」のような、時間をまたぐ処理を確実に動かす仕組みはまだありません。そのため候補には、何もしない案ではなく「自作エンジンを Postgres + Vercel Cron で永続化する案」を比較対象として入れています。

## 2. 候補の選び方

| 区分 | 候補 | 扱い |
|---|---|---|
| TypeScript で書けて Next.js から呼べる | Inngest、Trigger.dev、Vercel Workflows、Upstash Workflow、Temporal（TypeScript SDK） | 採点する |
| 自作 | 既存エンジンを Postgres + Vercel Cron で永続化 | 採点する（比較の基準） |
| Java / BPMN 前提 | Flowable、Operaton、Camunda 8 | 対象外。Java の実行環境を別に持つ必要があり、本リポジトリの構成に合わない |
| Python のバッチ向け | Airflow | 対象外。イベント起点の業務フローより、定期バッチの依存関係の管理が主な用途 |

## 3. 評価観点と重み

| 観点 | 重み | MIRAI 版からの変更 |
|---|---|---|
| ライセンス・コスト | 15 | ― |
| 状態管理・補償処理 | 20 | ― |
| スタック親和性 | 15 | 「Java親和性」を置き換え |
| 運用負荷 | 15 | ― |
| 可視化・運用画面 | 10 | ― |
| 学習コスト | 5 | ― |
| 長期保守性 | 10 | ― |
| Claude親和性 | 10 | ― |

- **スタック親和性**：TypeScript で書けるか、Next.js の Route Handler から動かせるか、Vercel のサーバーレス関数（実行時間30秒）の制約の中で使えるか。
- **Claude親和性**：MIRAI 版と同じく「Claude Code での開発支援（公式 Skill・MCP※）」「稼働中のワークフローを Claude から参照・操作できるか」「Claude が生成・修正しやすい記述形式か」の3点。
  ※MCP（Model Context Protocol）：AI から外部のツールやデータを呼び出すための標準的な接続方式。

## 4. スコア（各観点5点満点）

| 観点（重み） | Inngest | Vercel Workflows | Trigger.dev | Temporal（TS） | Upstash Workflow | 自作（永続化） |
|---|---|---|---|---|---|---|
| ライセンス・コスト（15） | 4 | 4 | 4 | 3 | 4 | 5 |
| 状態管理・補償処理（20） | 4 | 4 | 4 | 5 | 3 | 1 |
| スタック親和性（15） | 5 | 5 | 3 | 2 | 4 | 4 |
| 運用負荷（15） | 4 | 5 | 4 | 2 | 4 | 2 |
| 可視化・運用画面（10） | 5 | 4 | 5 | 4 | 3 | 2 |
| 学習コスト（5） | 4 | 4 | 4 | 2 | 4 | 3 |
| 長期保守性（10） | 4 | 3 | 4 | 5 | 3 | 2 |
| Claude親和性（10） | 5 | 4 | 5 | 5 | 3 | 3 |
| **総合（100点）** | **87** | **84** | **81** | **71** | **70** | **54** |

総合点は「各観点の点数 × 重み ÷ 5」の合計です。

### 参考：Claude親和性の重みを0にした場合（90点満点を100点に換算）

| Inngest | Vercel Workflows | Trigger.dev | Temporal（TS） | Upstash Workflow | 自作（永続化） |
|---|---|---|---|---|---|
| 86 | 84 | 79 | 68 | 71 | 53 |

上位3候補の順位は変わりません。Claude親和性は順位を決める観点ではなく、上位の中での差を広げる観点として効いています。

## 5. 採点理由

### スタック親和性・運用負荷

- **Inngest（5／4）**：関数を Next.js の Route Handler として公開し、Inngest 側が呼び出す方式のため、Vercel の関数のまま動かせます。ステップごとに関数を呼び直すので、30秒の制約を受けにくい構成です。
- **Vercel Workflows（5／5）**：`"use workflow"` / `"use step"` の指定で関数を耐久化（※途中の状態を保存し、失敗や再デプロイのあとも続きから再開できる）でき、すでに使っている Vercel の中で完結します。新たな契約先が増えません。
- **Trigger.dev（3／4）**：タスクは Trigger.dev 側の実行環境で動くため、Vercel とは別にデプロイが必要です。そのぶん長時間の処理には強いです。
- **Temporal（2／2）**：ワーカー（※ワークフローを実際に実行する常駐プロセス）を常時動かす必要があり、Vercel のサーバーレス関数では動かせません。Temporal Cloud を使っても、ワーカーの置き場所は別に用意する必要があります。
- **Upstash Workflow（4／4）**：Next.js から使え、Upstash はすでに Redis で利用しています（`@upstash/redis`）。
- **自作（4／2）**：構成上の追加はありませんが、永続化・再開・リトライ・待機をすべて自分で作り、保守し続ける必要があります。

### 状態管理・補償処理

- **Temporal（5）**：実行履歴をもとに状態を再現する方式で、補償処理（※途中で失敗したとき、済んだ処理を取り消す処理）の実装例も豊富です。
- **Inngest／Vercel Workflows／Trigger.dev（4）**：ステップ単位の保存・自動リトライ・長時間の待機・外部イベントの待ち受けがそろっています。補償処理はコードで書く必要があります。
- **Upstash Workflow（3）**：ステップ実行と待機はできますが、上記3候補に比べると運用画面や待ち受けの機能が少なめです。
- **自作（1）**：現状はメモリ上のみで、待機も100ミリ秒で打ち切られます。

### Claude親和性

- **Inngest（5）**：Claude Code 向けの公式プラグインと Agent Skills を提供しています。ローカルの Dev Server に MCP エンドポイントが組み込まれ、関数の一覧・テストイベントの送信・実行の確認ができます。クラウド側にも、デプロイ済みの関数・実行履歴・トレースを扱う MCP があります。
- **Trigger.dev（5）**：公式の MCP サーバー（プロジェクトの初期化・タスクの起動・デプロイ・デバッグ）と、Claude Code 向けのルールとサブエージェントを提供しています。
- **Temporal（5）**：MIRAI 版の評価と同じく、Claude Code 向けの公式プラグインとドキュメント用の MCP があります。TypeScript SDK でも同じく使えます。
- **Vercel Workflows（4）**：Vercel の公式 MCP は本セッションでも利用できており、デプロイやログは Claude から見られます。ただし、ワークフローの実行単位の参照・操作が MCP でできるかは、今回の調査では確認できませんでした。記述は通常の TypeScript 関数のため、生成・レビューはしやすいです。
- **Upstash Workflow（3）**：Upstash の公式 MCP はありますが、対象は主に Redis などのアカウント管理で、Workflow の実行を扱えるかは確認できませんでした。
- **自作（3）**：コードがリポジトリ内にあるので Claude が直接読み書きできますが、稼働中の実行を参照する手段は自分で作る必要があります。

### ライセンス・コスト、長期保守性

- 価格は従量制で、利用量と契約プランで大きく変わるため、本書では金額を比較していません。PoC で想定実行数をもとに試算します。
- **Temporal（長期保守性5）**：採用実績が多く、OSS（MIT ライセンス）として長く続いています。
- **Vercel Workflows（長期保守性3）**：一般提供（GA）になって日が浅く、API の変更が続く可能性があります。マネージド版は Vercel への依存が強くなります（WDK 自体はオープンソース）。

## 6. 提案

1. Inngest と Vercel Workflows の2案で PoC を行う。題材は既存のトリガー `lead_created` → 「3日待ってフォローメール、反応がなければ Slack で担当者に通知」とする（待機・外部イベント待ち・通知を一度に確かめられる）。
2. PoC では「Vercel の30秒制約の中で動くか」「実行の様子を運用画面と Claude（MCP）の両方から追えるか」「想定実行数での月額」の3点を比べる。
3. 採用が決まったら、`lib/workflow/engine.ts` の条件判定・変数展開は残し、実行と永続化の部分だけを採用したエンジンに置き換える。決定は `.factory/memory/decisions.md` に記録する。

### 期待効果

- 時間をまたぐ自動化（フォローメール、再接触の通知など）を、デプロイや障害で途切れずに動かせるようになります。
- Inngest／Trigger.dev を採用した場合、関数の作成からテスト実行・実行結果の確認までを Claude Code の中で続けて行えます。

### 想定リスク

- **リードの個人情報の扱い**：Inngest／Trigger.dev／Upstash では、ステップの入出力（リードの氏名・メールアドレス等）が外部サービスに保存されます。保存先の地域・保存期間・契約上の扱いを、**情報システム部門に確認**する必要があります。ステップには ID だけを渡し、本体は自社の DB から読む設計にすると影響を小さくできます。Vercel Workflows は既存の契約先の中で完結しますが、同じ確認は必要です。
- **評価の陳腐化**：各製品の AI 対応は変化が速く、半年程度で評価が変わる可能性があります。
- **重みの前提**：Claude親和性の重み10は「AI 活用を進める方針」を前提にしています（重みを0にしても上位の順位は変わらないことは上記のとおりです）。

## 出典（参照日：2026年10月21日）

- Inngest 公式ドキュメント「Inngest Model Context Protocol (MCP)」 https://www.inngest.com/docs/ai-dev-tools/mcp
- Inngest 公式ドキュメント「AI Coding Agent Plugins & Skills」 https://www.inngest.com/docs/ai-dev-tools/agent-skills
- Trigger.dev 公式ドキュメント「MCP Introduction」 https://trigger.dev/docs/mcp-introduction
- Trigger.dev 公式ブログ「Official MCP server」 https://trigger.dev/blog/official-mcp-server
- Vercel 公式ブログ「A new programming model for durable execution」 https://vercel.com/blog/a-new-programming-model-for-durable-execution
- Vercel 公式ドキュメント「Workflow」 https://vercel.com/docs/workflow
- Upstash 公式ドキュメント「MCP」 https://upstash.com/docs/agent-resources/mcp
- Upstash 公式サイト「Upstash Workflow」 https://upstash.com/workflow/getstarted
- Temporal 公式ドキュメント「Develop with AI」（MIRAI 版の評価で参照したもの）
