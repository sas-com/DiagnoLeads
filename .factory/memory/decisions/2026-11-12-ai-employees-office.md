---
id: 2026-11-12-ai-employees-office
date: 2026-11-12
category: Architecture
title: "AI社員は組織が採用して自律で働く担当者として新設し、オフィスの間取りの画面で見せる（Epic #1100）"
status: active
superseded_by: []
issues: [1100, 1101, 1102, 1103]
paths: ["lib/features/ai-employees/**", "components/features/ai-employees/**", "app/[locale]/(dashboard)/office/page.tsx"]
---

### [Architecture] AI社員は組織が採用して自律で働く担当者として新設し、オフィスの間取りの画面で見せる（Epic #1100）
- **日付**: 2026-11-12
- **決定**（オーナー判断）: 「AI社員オフィス」は、既存の AI・自動処理を社員に見立てて見せるだけの画面ではなく、組織ごとに採用でき、決まった仕事を自律して行う AI社員を新しく作る。働きぶりは `/office` のオフィスの間取りの画面（部屋ごとの席・状態・作業記録）で見せる。Epic #1100 と子 Issue（#1101 土台、#1102 実行の基盤、#1103 AI評価担当）に分けて段階的に進める
- **理由**: オーナーが3案（既存機能の可視化・自律型の新設・画面だけ先に）から自律型を選んだ
- **却下案**:
  - 既存の AI・自動処理を社員として見せるだけ：スキーマ変更なしで小さく出せるが、オーナーが選ばなかった
  - 画面の器だけ固定のデータで先に作る：中身のない画面が本番に出る
- **ルール**:
  - 役割はコードのカタログ（`lib/features/ai-employees/types/roles.ts`）で決め、1つの組織に1つの役割につき1人（`ai_employees` の一意の索引）。DB には採用したことだけを置く
  - 役割の仕事がまだ載っていない間は `workIssue` に Issue の番号を書き、画面では「研修中」として働かせない。仕事を載せる PR で `null` にする
  - 作業記録（`ai_employee_runs`）には件数と結果のコードだけを書き、リード・個人・プロンプト・自由な文を書かない（組織の全員が見るため）
  - 見る権限は `read Analytics`（メンバーと親組織の閲覧者も見られる）、採用・名前の変更・休止・解雇は `update Settings`（管理者）。新しい CASL の対象は足さない
  - Claude を呼ぶ役割（AI評価担当）は、決定 `2026-10-24-ai-call-rate-limits` と `2026-10-25-ai-no-personal-data` に従い、マージ前に `security-specialist` のレビューを通す（#1103）
