---
id: 2026-10-16-vercel-main-only
date: 2026-10-16
category: DevOps
title: "Vercel は main だけをデプロイする"
status: active
superseded_by: []
issues: []
paths: ["vercel.json"]
---

### [DevOps] Vercel は main だけをデプロイする
- **日付**: 2026-10-16
- **決定**: `vercel.json` の `git.deploymentEnabled` で、main 以外のブランチ（PR）ではデプロイを作らない。古いプレビュー・本番のデプロイは、現在の本番と直近の数件を残して削除した
- **理由**: 無料プランのデプロイ保存容量（10GB）が、PR ごとのプレビューで1日に75%まで埋まった（1日60回のデプロイ）。上限を超えるとデプロイできなくなる。PR のビルドと E2E は GitHub Actions の CI で確かめているので、プレビューがなくても困らない（オーナー判断）
- **ルール**: 画面をプレビューで見たいときは、手元で起動するか、必要な PR だけ `vercel deploy` で手動デプロイする（使い終わったら削除）
- **見直す条件**: 有料プランにする、またはプレビューを日常的に人が見る運用になったとき
