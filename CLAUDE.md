# DiagnoLeads v2 開発ルール

## 🧠 MemoryBank

> セッション間で一貫した判断を行うための記憶システム

**セッション開始時に参照:**
- `.factory/memory/decisions.md` - 過去の意思決定
- `.factory/memory/preferences.md` - ユーザーの好み
- `.factory/memory/learnings.md` - 過去の学習・教訓
- `.factory/memory/violations.md` - **原則違反記録（必読）**

**重要な決定・学習があれば該当ファイルに追記する**
**原則違反があれば violations.md に記録する**

---

## 🚀 SprintPath - アジャイル開発フレームワーク

> **SprintPath**は汎用的なアジャイル開発フレームワークです。
> 詳細: [docs/SPRINTPATH.md](./docs/SPRINTPATH.md)

### SprintPathの5原則

1. **🎯 Issue-First [最重要]** - コードを書く前に、必ずIssueを確認
2. **🔄 Continuous Quality** - テストが通らなければ、コミットしない
3. **👤 Clear Ownership** - 役割分担を明確にし、責任者を決める
4. **📊 Visibility** - 進捗は常に見える状態にする
5. **🚀 Ship Small** - 大きな変更より、小さな改善を積み重ねる

> **警告**: 原則違反は `.factory/memory/violations.md` に記録される

---

## ⚠️ Droid開発フロー (SprintPath準拠)

### フロー概要

```
CONFIRM → IMPLEMENT → VERIFY → COMMIT → REPORT
```

---

### STEP 1: タスク確認 (作業開始前) [必須・スキップ不可]

**必ず実行:**
```bash
# 現在のIssue状況を確認
gh issue list --state open --limit 10

# 優先度の高いタスクを確認
gh issue list --label "priority: critical" --state open
gh issue list --label "priority: high" --state open
```

**確認事項:**
- [ ] 対応するIssueが存在するか
- [ ] Issueの受け入れ基準を理解したか
- [ ] 依存関係・ブロッカーがないか

**Issueがない場合:** 
```
ユーザーに確認: 「Issueを作成してから対応しますか？」
→ Yes: Issue作成後に作業開始
→ No: 作業しない
```

**違反した場合:** `.factory/memory/violations.md` に記録

---

### STEP 2: 実装

**コーディング規約:**
- Biomeのルールに従う
- 既存のコードパターンを踏襲
- `any`型を使わない
- UI文字列は`locales/`に定義

**ファイル配置:**
```
lib/features/{feature}/     # 機能モジュール
test/unit/features/         # ユニットテスト
components/                 # UIコンポーネント
```

---

### STEP 3: テスト (必須)

**実装後に必ず実行:**
```bash
bun run test        # ユニットテスト
bun run typecheck   # 型チェック
bun run lint        # リント
```

**全てパスするまでコミットしない**

**認証・セキュリティ・課金に関わる PR は、マージ前に読み取り専用のレビューを通す**（範囲とやり方は `.factory/memory/decisions.md` の「[Process] 認証・セキュリティ・課金に関わる PR は…」）

---

## 📊 テストカバレッジ方針

> 品質の一貫性を保つため、層別にカバレッジ目標を設定

### 層別カバレッジ目標

| 層 | 対象ディレクトリ | 目標 | テスト方法 |
|----|-----------------|------|-----------|
| **Core** | `lib/features/`, `lib/db/`, `lib/auth/` | **80%** | ユニットテスト |
| **API** | `server/`, `app/api/` | **70%** | ユニットテスト + 統合テスト |
| **UI** | `components/`, `app/[locale]/` | **30-40%** | コンポーネントテスト |
| **E2E** | 全ユーザーフロー | **主要フロー100%** | Playwright |

### テスト優先順位

1. **ビジネスロジック** (lib/features/) - 最優先
2. **データアクセス層** (lib/db/, server/routers/) - 高優先
3. **認証・認可** (lib/auth/) - 高優先
4. **API エンドポイント** (app/api/) - 中優先
5. **UIコンポーネント** (components/) - E2Eで補完

### 現状と目標

```
現状 (2024-02): 全体 27.40% (1,965 tests)
├── lib/features/: 50-90% ✅
├── lib/auth/: 80% ✅
├── server/: 50% 🔄
├── app/: 0% ❌ (E2Eで補完)
└── components/: 5% 🔄

長期目標: 全体 40%+ (E2E含めた実質カバレッジ 70%+)
```

### E2Eテストで補完する領域

- 診断フォーム送信フロー
- ログイン/ログアウト
- リード一覧/詳細/編集
- 組織切り替え
- ダッシュボード表示

---

### STEP 4: コミット

**コミットメッセージ形式:**
```bash
git commit -m "type(scope): description

- 変更点1
- 変更点2

Refs #ISSUE_NUMBER (あれば)

Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"
```

**Type一覧:** `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `perf`

---

### STEP 5: 報告

**作業完了時にユーザーに報告:**
- 実装した内容
- 追加/変更したファイル
- テスト結果
- 関連Issue番号 (あれば)

---

### ラベル体系 (参照用)

| カテゴリ | ラベル |
|---------|--------|
| 優先度 | `priority: critical/high/medium/low` |
| タイプ | `type: feature/tech-debt/test/spike` |
| 見積もり | `story-points: 1/2/3/5/8` |
| ステータス | `status: backlog/ready/in-progress/review/blocked` |
| エリア | `area: frontend/backend/database/devops/ai` |

---

### 参照ドキュメント

| ドキュメント | 内容 |
|-------------|------|
| `docs/SPRINTPATH.md` | SprintPathフレームワーク |
| `docs/TESTING.md` | **テスト戦略ガイド（種別別原則・ルール）** |
| `docs/WORKFLOW.md` | 詳細ワークフロー |
| `docs/AGILE_PROCESS.md` | スクラムプロセス |
| `CONTRIBUTING.md` | 開発者ガイド |

---

## UI/コンポーネントルール

- **その時点のモダンなUIコンポーネントを採用する**（2026-10-09 決定。旧方針の TailAdmin 指定は撤回）
- 現時点の標準は **shadcn/ui**（Radix UI + Tailwind CSS v4）。部品は `components/ui/` に `bunx shadcn@latest add <component>` で追加する
- グラフは1ライブラリに寄せる。現状 Recharts と ApexCharts が併存しているため、整理方針は Issue で決める
- 新しいUIライブラリを導入するときは Issue で理由を残し、`.factory/memory/decisions.md` に記録する

---

## 旧リポジトリ（v1）の参照

- v1（FastAPI + React）は `yusuke-kurosawa/DiagnoLeads-v1-legacy` としてアーカイブ済み
- 移植の計画と対象ファイルは Epic #31 を参照
- 注意: `github.com/yusuke-kurosawa/DiagnoLeads` は本リポジトリを指す。v1 のコードへのリンクは必ず `DiagnoLeads-v1-legacy` とコミット SHA 固定で書く
