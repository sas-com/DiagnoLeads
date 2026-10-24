---
id: 2026-10-18-secret-scanning-and-local-db
date: 2026-10-18
category: Security
title: "シークレット漏洩の検知とローカルの DB 接続先"
status: active
superseded_by: []
issues: []
paths: ["drizzle/**", "scripts/db-*.ts", ".env.example"]
---

### [Security] シークレット漏洩の検知とローカルの DB 接続先
- **日付**: 2026-10-18
- **決定**: GitHub の secret scanning と push protection を有効にする。漏洩の通知はオーナーがメールで受け取る（Watch → Custom → Security alerts）。ローカルの `.env.local` の `DATABASE_URL` はローカルの DB を指し、本番を指さない
- **理由**: 公開リポジトリに認証情報が残っていた（`violations.md` の 2026-10-18 の記録）。手元の作業やテストで本番を変えないため
- **ルール**: 本番 DB への作業（マイグレーションの適用など）は、その都度ユーザーの承認を得て、接続文字列をチャットやログに出さずに行う
