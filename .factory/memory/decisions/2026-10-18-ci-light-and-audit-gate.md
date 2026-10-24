---
id: 2026-10-18-ci-light-and-audit-gate
date: 2026-10-18
category: CI
title: "CI を軽くし、依存の脆弱性で止める範囲を決める（#217）"
status: active
superseded_by: []
issues: [217]
paths: [".github/workflows/**"]
---

### [CI] CI を軽くし、依存の脆弱性で止める範囲を決める（#217）
- **日付**: 2026-10-18
- **決定**:
  - 依存パッケージの更新は PR を分ける（next 15.5.28 → next 16 + payload → better-auth → 残り）。Payload の修正版は next 15.5 系と組み合わせられないため、Next.js 16 に上げた（#228）
  - CI の Security Scan は `bun audit --audit-level=critical` で失敗させる（continue-on-error を外す）。high は間接依存と修正版のない xlsx が残るため、#236 で解消してから基準を high に戻すか判断する
  - `ci-failure-comment.yml`（ログをスクリプトに埋め込み SyntaxError で壊れていた）と `auto-fix-lint.yml`（GITHUB_TOKEN で積んだコミットで CI が動かない。整形は lefthook が担う）を削除する
  - Build とカバレッジは lint だけを待ち、ユニットテストと並行に動かす。Bun は `BUN_VERSION` で固定し、意図して上げる
  - main を保護し、PR の検査（Lint & Type Check・Unit Tests 4本・DB Integration Tests・Build）を必須にする。「最新の main を取り込んでいること」は必須にしない。Security Scan は安定したら必須に加える
- **理由**: 機能を速く出す段階なので、CI は重くせずに壊れたまま気づかない箇所をなくす。複数のセッションが並行してマージするため、検査が落ちたままのマージを防ぐ
- **却下案**: E2E をマージ前に必須にする（E2E は PR でも動くが、本番の自動デプロイは止まらない。重くしない方針と合わない）、最新の main の取り込みを必須にする（並行マージのたびに CI のやり直しが続く）
- **ルール**: CI のレビューは `.claude/agents/ci-devops-specialist.md`（CI 専門のエージェント）に頼める。ロックファイルを更新すると Bun が vite の任意の依存 terser を外すため、terser は devDependencies に明記してある
