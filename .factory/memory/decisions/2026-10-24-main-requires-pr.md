---
id: 2026-10-24-main-requires-pr
date: 2026-10-24
category: DevOps
title: "main は PR 経由でのみマージする（承認0・管理者にも適用）（#530）"
status: active
superseded_by: []
issues: [530, 426]
paths: []
---

### [DevOps] main は PR 経由でのみマージする（承認0・管理者にも適用）（#530）
- **日付**: 2026-10-24
- **決定**（オーナーの判断。推奨どおり）: main のブランチ保護に「Require a pull request before merging」を足した。main へは PR 経由でのみマージでき、直接 push はできない。必要な承認の数は0（オーナーと Claude が自分の PR をマージする今の運用を変えない）。`2026-10-18-ci-light-and-audit-gate` の必須の検査7つ（Lint & Type Check・Unit Tests ×4・DB Integration Tests・Build）と「管理者にも適用（enforce_admins）」はそのまま
- **理由**: main へのマージはそのまま本番に出る（`2026-10-16-vercel-main-only`）ので、PR をレビューと記録の場として必ず通す。直接 push を仕組みで止めることで、権限の deny（`git push origin main` などの決まった形だけ）の抜けも塞ぐ。承認を0にするのは、承認者を増やさず今の自律運用を保つため
- **ルール**:
  - 変更は必ずブランチと PR で出す（スキル `ship`）。main に直接 push しようとすると、ブランチ保護が拒む
  - 確認は API で：`gh api repos/yusuke-kurosawa/DiagnoLeads/branches/main/protection`（`required_pull_request_reviews` が有効・`required_approving_review_count: 0`、`enforce_admins.enabled: true`）
- **却下案**: 承認を1以上にする（承認者がオーナー1人なので、Claude の PR が止まる）。PR を必須にしない従来の運用（本番に出る変更がレビューと記録を飛ばせてしまう）
