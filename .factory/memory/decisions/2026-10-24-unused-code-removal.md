---
id: 2026-10-24-unused-code-removal
date: 2026-10-24
category: Architecture
title: "判断の要る未使用コードは、audit-logs・feature-flags・REST v2・旧汎用フォームを消し、tags・comments・workflows は残す（#470）"
status: active
superseded_by: []
issues: [450, 470, 46, 289, 430, 555]
paths: ["lib/features/audit-logs/**", "lib/features/feature-flags/**", "app/api/v2/**", "lib/api/v2-auth.ts", "lib/features/diagnostics/legacy-form.ts", "app/[locale]/(public)/diagnostic/page.tsx", "components/features/diagnostic/**", "app/api/diagnostic/route.ts", "lib/features/tags/**", "lib/features/comments/**", "lib/features/workflows/**"]
---

### [Architecture] 判断の要る未使用コードは、audit-logs・feature-flags・REST v2・旧汎用フォームを消し、tags・comments・workflows は残す（#470）
- **日付**: 2026-10-24
- **経緯**: #450 の質問に、オーナーが「推奨どおりで進めてください」と答えた。回答の前に推奨を書いていたのは #470 の (a)・(b) だけで、(c) の「消す」と (d) の扱いは、この決定と PR で初めて示した
- **決定**:
  - (a) `lib/features/audit-logs`・`lib/features/feature-flags`（`server/routers/_app.ts` に登録されていないルーターと、その周りのコード）を消す。表は残す。`feature_flags` の表は、(a) の後に読み書きするコードがなくなるので DROP の候補にする（DROP は下のルールどおり別の PR で、オーナーに確かめてから）。`audit_logs` の表には、リードの更新（決定 2026-10-16-lead-activity-and-audit）のほか、ヒアリング・引き継ぎ・フォローアップ・診断ビルダー・アカウントの削除も書き込み、活動履歴（`lib/features/lead-activity`）が読んでいる
  - (b) REST v2（`app/api/v2` と、それだけが使う `lib/api/v2-auth.ts`）を消す
  - (c) 旧汎用フォーム一式を消す：`lib/features/diagnostics/legacy-form.ts`・`app/[locale]/(public)/diagnostic/page.tsx`・`components/features/diagnostic/`・`app/api/diagnostic/route.ts`・環境変数 `LEGACY_DIAGNOSTIC_FORM_ENABLED`。それだけが使う旧診断の結果メール（`lib/features/email/templates/diagnostic-result.ts` と `lib/features/email/index.ts` の再 export、そのテスト）も消し、決定 2026-10-22-email-templates の旧診断の結果メールの行を直す。URL の `/[locale]/diagnostic` は `/ax-diagnosis` へのリダイレクトとして残す（トップと landing のページからリンクがある。`[slug]` のリダイレクトもそのまま）
  - (d-1) tags・comments のルーター（`_app.ts` の `tags`・`comments`）と、今は画面から使われていない部品（`components/features/tags` の tag-manager・tag-selector と `components/features/comments`）は残す。SFA のセッションに確かめた（2026-10-24）：comments は #555（リード詳細の社内メモ）でルーターと部品をそのまま使い、tags は Epic #430 の先の段（リード一覧の一括操作でタグを付ける）で使う予定。リード一覧のタグの表示（`components/features/tags/tag-badge.tsx`）と、`tags`・`lead_tags`・`lead_comments` の表とその読み書き（leads・prospects・lead-activity）も、今までどおり使う
  - (d-2) workflows のルーター（`lib/features/workflows`）は残す。ワークフローは自前のランナー（決定 2026-10-24-workflow-runner-self-built、#289 の A 案）で作り、`docs/WORKFLOW_ENGINE_EVALUATION.md` の段階5（社外提供を決めたとき）で、利用者が設定するワークフローの置き場にする
- **理由**: 消すものは、どれも画面から使われていないのに、RLS（#51）で確かめる面を広げ、新しい機能の置き場の判断を迷わせる。audit-logs・feature-flags は本番から届かず（計1,407行、3ファイルがグローバルの db を使う）、REST v2（約1,150行）は認証済みの要求でも必ず 401 を返し、tRPC と違う権限の経路を通り、監査ログも書かない。旧汎用フォームは、本番では `LEGACY_DIAGNOSTIC_FORM_ENABLED=true` でない限り無効（ページはリダイレクト、API は 410。プレビューと開発では動く）
- **却下案**: (a) を `_app.ts` に登録して画面を作る（今の画面と運用に使い道がない）、(b) 認証を直して残す（成功する呼び出しは今もありえない。呼んでいるクライアントの有無は本番のログで確かめていない）、(d-1) tags・comments を消す（SFA が使うので、すぐに作り直すことになる）、(d-2) workflows も消す（段階5で同じ置き場を作り直すことになる）
- **ルール**:
  - 1項目1 PR。表の DROP はコードの削除と別の PR にし、本番の行数を読み取りで確かめ、オーナーに確かめてから行う
  - 消す PR で、一緒に扱うものを確かめる：そのコードだけを試すテスト（実 DB のテストを含む）、`lib/middleware/rate-limit.ts` の該当の行、`lib/api-docs/modules.ts`、locales のキー。README と docs の記述を直すかは、その PR でオーナーに確かめる
  - REST v2 を消す PR では、`app/api/v2/leads` を `paths` や本文に持つ決定（2026-10-09-lead-pipeline-status・2026-10-16-lead-activity-and-audit・2026-10-24-on-hold-is-not-lost）も直す。読み取り専用のセキュリティレビューを通す
  - 消したパスは、この決定の `paths` からも同じ PR で外す（`test/unit/claude-hooks` が、どのファイルにも当たらないパスを検出する）
  - #514 のマージ後は、`bun run arch:check --update` で許可リストの行を消す（(a) で7行。差分は行の削除だけになる）
  - #476 が止める範囲（`lib/features/*/api/router.ts`・`server/routers/_app.ts`・`test/unit/integration` など）を触る PR は、RLS の作業中（11/4〜11/14）を避ける
