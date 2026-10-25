# リードのライフサイクルと段階の対応表

リードの「段階」を表す値は、いくつもの軸（列）に分かれている。この文書は、それらを1本のライフサイクルに当てはめ、各集計がどの軸を数えているかを示す（#444、Epic #430）。値の定義はコードの側が正本で、この文書と食い違ったらコードに合わせて直す。

## 1. ライフサイクル（1本）

```
リード ─→ MQL ─→ 商談（見極め） ─→ SQL ─→ 商談（課題の確認 → 提案 → 条件の調整） ─→ 受注 / 失注
   │        │          │                         │
   └────────┴──────────┴─────────────────────────┴─→ 再育成（ナーチャリング）─→ 条件がそろえば前の段に戻る
```

| 段 | 入る条件 | 出る条件 |
|---|---|---|
| リード | リードができたとき（診断の回答・CSV の取り込み・手入力・顧客探しからの引き継ぎ） | MQL になる。対象外のまま育成か失注にする |
| MQL | 診断の MQL段階が「関心あり」、または MQL判定日（`mql_qualified_at`）が入ったとき。「適合」は MQL の手前（MQL候補） | 初回商談の日時が確定する |
| 商談（見極め） | 初回商談の日時が確定したとき（商談を作る。決定：#444 のコメント 2026-10-24） | 初回ヒアリングの後の SQL判定。適格なら SQL、不適格なら失注（理由付き）か再育成 |
| SQL | SQL判定が「適格」（`sql_decision = qualified`） | 商談が受注か失注で閉じる |
| 受注 | 商談が受注になったとき。AX 移行は段階的に売る（現行調査 → 移行 → AX 化）ので、次の商談が続くことがある | ― |
| 失注 | すべての商談が失注になったとき、または失注の理由を付けて閉じたとき。「保留」は失注ではない（#445） | 再育成に戻すことがある |
| 再育成 | 時期・予算・保留などで今は進まないとき。次の行動か動くべき時期が必要（#446） | 動くべき時期が来て、再び商談になる |

## 2. 軸ごとの対応表

### 2.1 リードの状態（`leads.status`）

定義は `lib/features/leads/types/pipeline.ts` の `LEAD_STATUSES`。

| 値 | 表示 | 段 |
|---|---|---|
| `new` | 新規 | リード・MQL（商談の前） |
| `nurturing` | ナーチャリング | 再育成 |
| `negotiating` | 商談中 | 商談（見極め〜条件の調整）・SQL |
| `won` | 成約 | 受注 |
| `lost` | 失注 | 失注 |

`leads.has_negotiated`（商談済み）は、一度でも商談に入ったリードに付く印で、状態が戻っても消えない。

### 2.2 商談フェーズ（`leads.deal_phase`）

定義は同じファイルの `DEAL_PHASES`。初めて入った日を `leads.deal_phase_reached_at` に残す。

| 値 | 表示 | 段 |
|---|---|---|
| `initial_hearing` | 初回ヒアリング | 商談（見極め） |
| `simple_diagnosis` | 簡易診断 | 商談（課題の確認） |
| `proposal` | 提案 | 商談（提案・条件の調整） |
| `survey_won` | 現行調査受注 | 受注（1段目） |
| `migration_won` | 移行受注 | 受注（2段目） |
| `ax` | AX化 | 受注（3段目） |

### 2.3 MQL段階と MQL判定日

定義は `lib/features/leads/mql-level.ts`（一覧の SQL は `lib/features/leads/api/list-sql.ts` の `listMqlLevel`）。見込みの指標はこれに一本化した（決定 `2026-10-24-mql-level-over-score`）。

| 値 | 表示 | 段 |
|---|---|---|
| `interest`、または MQL判定日あり | 関心あり（MQL） | MQL |
| `fit` | 適合 | リード（MQL候補） |
| `none` | 対象外 | リード（育成か失注の候補） |
| なし（診断なし） | 診断なし | リード（手入力などは MQL のチェックで判断する） |

### 2.4 SQL判定（`leads.sql_decision`）

定義は `pipeline.ts` の `SQL_DECISIONS`。

| 値 | 表示 | 段 |
|---|---|---|
| `qualified` | 適格 | SQL（見極めを抜けた） |
| `not_qualified` | 不適格 | 失注（理由付き）か再育成 |
| なし | 未判定 | 見極めの前・途中 |

### 2.5 商談のステージ（`deals.stage`、#435）

定義は `lib/features/deals/types/pipeline.ts`（#435 のマージ後）。確度はステージに入ったときの初期値で、担当が商談ごとに変えられる。

| 値 | 表示 | 確度 | 段 | リードの商談フェーズ |
|---|---|---|---|---|
| `qualification` | 見極め | 10% | 商談（見極め） | 初回ヒアリング |
| `discovery` | 課題の確認 | 20% | 商談（課題の確認） | 簡易診断 |
| `proposal` | 提案 | 40% | 商談（提案） | 提案 |
| `negotiation` | 条件の調整 | 70% | 商談（条件の調整） | 提案 |
| `won` | 受注 | 100% | 受注 | 商談の種類で決まる（現行調査 → 現行調査受注、移行 → 移行受注、AX 化 → AX化） |
| `lost` | 失注 | 0% | 失注 | 変えない |

商談からリードへの反映は `lib/features/deals/lead-sync.ts` にだけ書く。商談を持つリードの状態と商談フェーズは商談から決まり、手では変えない（#444 の2つ目の PR で入れる）。

### 2.6 顧客探しの段階（`prospects.stage`、#265）

定義は `lib/features/prospects/types/schemas.ts` の `PROSPECT_STAGES`。顧客探しは、SAS のメンバーが話した相手をリードにする前に書く一覧で、リードに引き継いだ（`prospects.lead_id` が入った）後はリードの側が正になる。値は表計算の選択肢に合わせてある。

| 値 | 表示 | 当たる段（目安） |
|---|---|---|
| `interest` | 1 関心確認 | リード・MQL |
| `quick_diagnosis` | 2 簡易診断 | 商談（課題の確認） |
| `spec_survey` | 3 現行仕様調査 | 受注（1段目：現行調査） |
| `proposal` | 4 移行提案 | 商談（提案。移行の商談） |
| `contract` | 5 契約 | 受注（2段目：移行） |
| `nurturing` | 育成 | 再育成 |
| `dropped` | 見送り | 失注 |

顧客探しの段階とリードの状態は自動では連動しない。引き継いだ後に顧客探しの段階を書き続けると、リードの側と食い違うことがある。

## 3. 集計がどの軸を数えているか

| 集計 | 場所 | 数えている軸 |
|---|---|---|
| ダッシュボードのパイプライン（状態ごとの件数） | `lib/features/analytics/dashboard.ts` | `leads.status` |
| ダッシュボードの MQL | 同上 | MQL判定日（期間内）と MQL段階の「適合」 |
| 分析の上部の KPI・MQL段階の内訳 | `lib/features/analytics/api/router.ts`（`getOverview`） | `leads.status`（成約率）、MQL段階と MQL判定日（`listMqlLevel`） |
| 分析のファネル | 同上（`getConversionFunnel`） | `leads.status` と `leads.has_negotiated`（後の段に進んだリードは前の段にも数える） |
| 獲得元・代行会社別の費用 | `lib/features/analytics/lead-sources.ts` | `leads.sql_decision`（SQL）、`leads.status`（成約） |
| 代行の契約別ファネル | `lib/features/agency-contracts/report.ts` | アポ（リード）→ 商談の実施（`has_negotiated` か商談フェーズの日付）→ SQL（`sql_decision`）→ 現行調査受注 → 移行受注（`deal_phase_reached_at`） |
| 段階的な納品の集計 | `lib/features/delivery-reviews/report.ts` | `deal_phase_reached_at`（現行調査受注 → 移行受注 → AX化） |
| 売上予測（#437） | `lib/features/deals/`（#437 のマージ後） | `deals.stage` と確度・金額 |
| 顧客探しの集計 | `lib/features/prospects/summary.ts` | `prospects.stage` |

## 関連

- 決定：`2026-10-09-lead-pipeline-status`（状態の5区分）、`2026-10-24-on-hold-is-not-lost`、`2026-10-24-nurturing-follow-up`、`2026-10-24-mql-level-over-score`
- Issue：#444、#435、#436、#437、#265、Epic #430
