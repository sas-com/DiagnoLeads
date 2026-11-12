---
id: 2026-11-12-ci-jobs-start-together
date: 2026-11-12
category: CI
title: "CI のジョブは lint の終わりを待たずに同時に始め、E2E だけが Build を待つ（#1104、2026-10-18-ci-light-and-audit-gate の一部を変更）"
status: active
superseded_by: []
issues: [1104, 217]
paths: [".github/workflows/ci.yml"]
---

### [CI] CI のジョブは lint の終わりを待たずに同時に始め、E2E だけが Build を待つ（#1104、2026-10-18-ci-light-and-audit-gate の一部を変更）
- **日付**: 2026-11-12
- **決定**（オーナー判断。直近100回の PR の CI の実績を示して聞いた）:
  - `ci.yml` の `test`（4分割）・`test-coverage`・`build`・`integration`・`security` は `needs` を持たず、`lint` と同時に始める。`e2e` は、ビルドの成果物を使うので `needs: build` のまま
  - [2026-10-18-ci-light-and-audit-gate](./2026-10-18-ci-light-and-audit-gate.md) の「Build とカバレッジは lint だけを待ち、ユニットテストと並行に動かす」を、この決定で置き換える。ほかの点（Security Scan の基準・Bun の固定・必須の検査・E2E を必須にしない）は、そのまま有効
- **理由**:
  - 直近100回の PR の CI（2026-11-10〜12）で、`Lint & Type Check` が落ちたのは0回だった（失敗した4回は、どれも 2026-11-11 の apt 障害による E2E）。lint を待っても何も止めず、毎回の CI を `Lint & Type Check` の平均57秒だけ長くしていた
  - 必須の検査が揃うまでと、E2E が終わるまでが、どちらも約1分短くなる。並行するセッションが PR を出す回数が多いので、効果が積み上がる
  - リポジトリは公開なので、lint が落ちたときにほかのジョブが最後まで動いても、費用はかからない
  - Anthropic のソース管理の作り直しの記事（Scion。https://www.anthropic.com/research/redesigning-source-control 、2026-11-12 参照）が、全体のロックをやめて並行に処理するとしたことを、ジョブの並べ方に当てはめた
- **却下案**: 今のまま lint を待つ（lint が落ちたときに、ほかのジョブを動かさずに済む。ただ、実績では一度も効いていない）
- **ルール**:
  - ジョブを足すときは、前のジョブの成果物を使うときだけ `needs` を付ける。順番のためだけの `needs` は付けない
  - 必須の検査の名前（Lint & Type Check・Unit Tests 4本・DB Integration Tests・Build）は変えない。変えると、ブランチ保護の設定も変える必要がある。lint も必須なので、落ちればマージは止まる
  - lint がほとんど落ちないのは、lefthook がコミット前に整形（biome）と型チェックを流しているためと考えている。lefthook の検査を減らしたり、CI で lint が落ちる回数が増えたりしたら、この決定を見直す
