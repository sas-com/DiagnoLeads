---
id: 2026-11-12-verify-changed-before-commit
date: 2026-11-12
category: Process
title: "コミット前の検証は bun run verify で変えたファイルに関係するテストに絞り、全テストは CI に任せる（#1096）"
status: active
superseded_by: []
issues: [1096]
paths: ["scripts/verify-changed.ts", "test/unit/scripts/verify-changed.test.ts", ".claude/skills/ship/SKILL.md", ".claude/rules/unit-tests.md"]
---

### [Process] コミット前の検証は bun run verify で変えたファイルに関係するテストに絞り、全テストは CI に任せる（#1096）
- **日付**: 2026-11-12
- **決定**（オーナー判断。直近の PR 12件の計測を示して聞いた）:
  - コミット前の検証は `bun run verify`（`scripts/verify-changed.ts`）にする。中身は次のとおり
    - origin/main との分岐点からの変更（コミットしていないものを含む）を集める
    - `vitest related` で関係するテストを流し、ファイルを直接読むテストを足す（`.factory/memory/`・`.claude/` → `test/unit/claude-hooks`、`app/globals.css`・`vercel.json`・`scripts/architecture/` → それを読むテスト）
    - そのあと、型チェック・リント・`arch:check` を流す
  - import をたどれない変更は、全テストに切り替える
    - 依存（`package.json`・`bun.lock`・`patches/`）
    - テストの共通設定（`vitest.config`・`tsconfig*`・`test/setup.ts`・`test/mocks/`・`test/fixtures/`・`test/helpers/`）
    - `locales/`・`drizzle/`
    - コードの削除と、`app/` へのファイルの追加（ルートの一覧を読むテストがある）
    - `app/`・`public/` のコード以外のファイル
    - 規則に無いファイル
  - 全テストの最終的な判定は、CI の必須の検査（Unit Tests 4本）に任せる。CLAUDE.md の「毎回守ること」4（テストが通らなければコミットしない）は、`bun run verify` が通ることを指す
- **理由**:
  - 全テストは手元で約270秒（2026-11-12）。直近にマージされた PR 12件で `vitest related` を流すと、平均47秒・中央値30秒だった
  - それらの PR が自分で直したテスト30件は、すべて related に含まれた（取りこぼし0件）
  - この PR の変更で `bun run verify` を流すと、テスト・型チェック・リント・`arch:check` まで14秒で終わった
  - 並行するセッションがコミットするたびに数分ずつ縮むので、効果が積み上がる
  - import をたどれない依存（ファイルを直接読むテスト、ルートの一覧を読むテスト）は、テストを grep して規則に入れた。規則に無いものは全テストに倒す
  - 公式の Best practices は、CLAUDE.md には「確かめ方の正確なコマンドと、1ファイルのテストの流し方」を書くよう勧めている（https://code.claude.com/docs/en/best-practices 、2026-11-12 参照）
  - Anthropic のソース管理の作り直しの記事（Scion）が、仕事の量をリポジトリ全体ではなく変更の量に比例させたことを当てはめた（https://www.anthropic.com/research/redesigning-source-control 、2026-11-12 参照）
- **却下案**:
  - 今のまま、コミット前に全テストを流す（安全だが、毎回約5分かかる）
  - 判断を人に任せ、CLAUDE.md に「関係するテストを流す」とだけ書く（どのテストが関係するかの判断がぶれ、ファイルを直接読むテストを落とす）
- **ルール**:
  - テストでファイルを直接読む（`readFileSync`・`readdirSync`）ときは、`scripts/verify-changed.ts` の `DISK_READERS` か `FULL_SUITE` に、そのファイルの規則を足す（`test/unit/**` を触ると `.claude/rules/unit-tests.md` が知らせる）
  - CI のユニットテストが、`bun run verify` の通った変更で落ちたら、取りこぼした依存を規則に足し、`learnings.md` に記録する
  - 迷ったら `bun run verify --full`
