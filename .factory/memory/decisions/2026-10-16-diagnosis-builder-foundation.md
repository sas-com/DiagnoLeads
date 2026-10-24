---
id: 2026-10-16-diagnosis-builder-foundation
date: 2026-10-16
category: Architecture
title: "診断ビルダーの土台（#122）"
status: active
superseded_by: []
issues: [122]
paths: ["lib/features/diagnosis-builder/**", "lib/features/diagnostics/engine.ts"]
---

### [Architecture] 診断ビルダーの土台（#122）
- **日付**: 2026-10-16
- **決定**: マーケターが作る診断は、新しいテーブル `diagnoses`（下書き）と `diagnosis_versions`（公開版。変更不可の写し）で持つ。定義の形は AX 診断の型（sections / showWhen / exclusiveOptions）を広げたもので、回答の検査は `lib/features/diagnostics/engine.ts` を共有する。AX 診断はコード定義のまま残す。下書きの編集と公開は owner / admin だけ（オーナー判断）
- **理由**: v1 のビルダーは保存・公開の API がなく動いていなかった。`diagnostic_templates` は下書きと公開の区別がなく、`version` が A/B テストの派生番号と衝突し、点数の軸も1本しかない。AX の採点は専用ロジックで汎用の「軸×段階」では表せない
- **ルール**:
  - 採点はサーバーだけで行う。`evaluate` は検査済みの回答（`ValidatedAnswers`）しか受け取らず、回答者に返すのは `toPublicResult` / `toPublicDefinition` で点数・リードスコア・MQL を除いたものだけ
  - 点数は2種類：回答者に見せる結果タイプ（軸×段階）と、社内用のリードスコア（MQL 判定理由つき）
  - 公開済みの版は変えない。配点を変えても過去の結果は再計算しない
  - スキーマ変更は追加だけにし、本番 DB に適用してからマージする。画面は MVP（#113〜#121）がそろうまで feature flag で隠す
  - シードやテストは架空の診断だけ。営業の内容はリポジトリに置かない
- **却下案**: `diagnostic_templates` の拡張（意味の衝突と1本の採点を抱え続ける）、Payload の DiagnosticForms（組織の分離がない）、AX 診断のビルダー移行（過去回答の再計算が全件一致することを条件に後で再検討）
