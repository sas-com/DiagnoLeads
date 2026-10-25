---
id: 2026-10-25-ax-boundary
date: 2026-10-25
category: Architecture
title: "AX 診断を読む場所を arch:check の ax-boundary で数え、リードの AX 回答と営業の手引きの読み出しを1か所にする（#480）"
status: active
superseded_by: []
issues: [480, 450]
paths: ["scripts/architecture/rules.ts", "lib/features/diagnostics/ax-migration/lead-submissions.ts", "lib/features/ax-playbook/service.ts"]
---

### [Architecture] AX 診断を読む場所を arch:check の ax-boundary で数え、リードの AX 回答と営業の手引きの読み出しを1か所にする（#480）
- **日付**: 2026-10-25
- **経緯**: #480 は「2つ目の診断の方式が決まった後、11/14 以降」の予定だった。方式は決定 `2026-10-24-diagnosis-shared-rules` でビルダーに決まり、オーナーの指示で今に前倒しした
- **決定**:
  - `arch:check` に `ax-boundary`（許可リストつき）を足す。`diagnostics/ax-migration/` を読むのは、AX 診断の中と、AX のための機能（名前が `ax-` で始まる `ax-site`・`ax-playbook` など）だけ。対象は lib/features 全体で、型だけの import も数える。項目は「読む側 -> AX のファイル」で、今の15件を許可リストに入れた
    - 対象を lib/features 全体にした理由：2つ目の診断はビルダーで作るので、汎用の名前の機能（leads・lead-hearings など）が AX を読む箇所は、増やさずに減らす方向にしたい。汎用の診断だけに絞ると、そこが見えなくなる
    - 画面（app・components）は数えない。AX の画面はもともと AX を読むためにある
  - リードの最新の AX 回答は `diagnostics/ax-migration/lead-submissions.ts` の `latestAxSubmission`（1件）と `latestAxSubmissions`（複数のリード）で読む。act-timing・lead-prep・delivery-reviews の3か所のクエリをここにまとめた（選び方は同じで、作成日時の新しいもの）
  - 営業の手引きは `ax-playbook/service.ts` で読む。保存したままの内容を返す `readPlaybookContent` と、スキーマで確かめる `readPlaybook` がある。challenge-guide・lead-prep・AX の回答の保存の3か所を切り替えた。objection-card は PR #603 が同じファイルを触っているので、そのマージの後に切り替える
- **AX の純粋な定義（definition.ts など）の見せ方**: 今は動かさない。読む側は `ax-boundary` の許可リストで見えるので、`types/` へ移しても数は減らない。移すと約20ファイルの import が変わり、開いている PR とぶつかるうえ、AX の公開（10/29）の直前でもある。コードで定義する2つ目の診断は作らない（ビルダーで作る）ので、移す理由ができたときに見直す
- **却下案**:
  - `lead-submissions.ts` を `diagnostics/service.ts` に置く（公開面なので `cross-feature-internal` が増えない）：`diagnostics/service.ts` は AX を読まないと決めている（決定 `2026-10-24-diagnosis-shared-rules-unified`）。そのため `cross-feature-internal` に1行（`ax-migration/lead-submissions.ts`）を足した
  - 対象を汎用の診断（`diagnostics/` 直下・`diagnosis-builder/` など）だけにする：上の理由
- **ルール**:
  - 新しく AX を読むときは、まず `lead-submissions.ts` か `ax-playbook/service.ts` に関数があるかを見る。なければそこに足し、各機能でクエリを書かない
  - `ax-boundary` の許可リストは減らす方向にだけ動かす。足すときは PR に理由を書く
