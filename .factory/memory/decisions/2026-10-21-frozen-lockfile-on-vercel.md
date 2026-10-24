---
id: 2026-10-21-frozen-lockfile-on-vercel
date: 2026-10-21
category: Process
title: "Vercel のインストールでロックファイルを厳密に守る（#257）"
status: active
superseded_by: []
issues: [257]
paths: ["vercel.json", "package.json", "bun.lock"]
---

### [Process] Vercel のインストールでロックファイルを厳密に守る（#257）
- **日付**: 2026-10-21
- **決定**: `vercel.json` の `installCommand` を `bun install --frozen-lockfile` にする。CI と同じく、`bun.lock` どおりの版で本番をビルドする（解決し直しで別の版が入り、型チェックやビルドが壊れたことがあるため。#236）
- **Bun の版**: Vercel のビルドは Bun 1.3.14、CI は 1.4.3。2026-10-21 時点の `bun.lock`（lockfileVersion 1）は、1.3.14 の `--frozen-lockfile` でも書き換えなしで入ることを手元で確かめた
- **手順**:
  - 依存を変えたら、`bun install` で `bun.lock` を更新し、`package.json` と一緒にコミットする
  - `package.json` と `bun.lock` がずれていると、本番デプロイのインストールが `lockfile had changes, but lockfile is frozen` で失敗する（本番は前のデプロイのまま）。そのときは `bun install` でロックファイルを更新した PR を出し、マージし直す
  - 依存を変えた PR は、マージ後に本番デプロイの成功まで見届ける。スキーマ変更（マイグレーション）と依存の変更は同じ PR に入れない（失敗すると、新しいスキーマに古いコードが残る時間が延びる）。失敗したら最優先で直す（直すまで後のマージもすべてデプロイに失敗する）
  - 手元では差分が出ないのに失敗するときは、Bun の版の違いを疑う。ビルドログの Bun の版で `bunx bun@<その版> install --frozen-lockfile` を流して再現する。すぐ直せなければ、`installCommand` を戻す PR で逃がす
  - ビルドキャッシュが疑わしいときは、Vercel の Redeploy で「Use existing Build Cache」を外す
  - Bun の版を上げて `bun.lock` の形式が変わる場合は、Vercel の Bun が読めるかを先に確かめる
