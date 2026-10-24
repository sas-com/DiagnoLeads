---
id: 2026-10-09-v1-consolidation
date: 2026-10-09
category: Architecture
title: "v1 リポジトリの集約"
status: active
superseded_by: []
issues: [31]
paths: []
---

### [Architecture] v1 リポジトリの集約
- **日付**: 2026-10-09
- **決定**: 本リポジトリ（旧 diagnoleads-v2）を正本として `DiagnoLeads` に改名。v1 は `DiagnoLeads-v1-legacy` に改名してアーカイブ。v1 の Issue #1-12 は本リポジトリの #32-43 に移管
- **理由**: v2 は v1 の作り直しとして始まり、機能の幅・テスト基盤とも v2 が上回る。二重管理をやめる
- **移植方針**: v1 のコードは取り込まず、価値のあるロジック（診断データモデル、サーバー側スコアリング、AI プロンプト資産、レポート出力、Teams 通知など）を Issue 単位で TypeScript に移植する（Epic #31）
- **却下案**: v1 リポジトリに v2 を上書き（v2 の Issue・スター・Vercel 連携を失う）、v1 を `legacy/` に取り込み（Python 資産が混在して保守対象が増える）
