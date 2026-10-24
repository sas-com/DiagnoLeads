---
id: 2026-10-24-performance-targets
date: 2026-10-24
category: Performance
title: "公開5ページの性能の目標と測り方を決め、本番を毎日 Lighthouse で測る（#569）"
status: active
superseded_by: []
issues: [569, 611, 612, 613, 614]
paths: [".github/workflows/lighthouse.yml", "scripts/lighthouse-*"]
---

### [Performance] 公開5ページの性能の目標と測り方を決め、本番を毎日 Lighthouse で測る（#569）
- **日付**: 2026-10-24（オーナー判断：#569 のコメント「分析とオーナーの判断（2026-10-24）」で、読み取り専用の分析の推奨どおりに決めた）
- **決定**:
  - D1 対象のページ：公開の5ページ
    - `/ja/ax-migration`・`/ja/ax-migration/access`・`/ja/ax-diagnosis`・コラム一覧 `/ja/ax-migration/column`・最新のコラム1本
    - 最新のコラムは、本番のコラム一覧で公開日（`<time dateTime>`）がいちばん新しい記事。同じ日なら一覧の上のもの。記事が増えると測るページが替わる
    - 管理画面には点数の目標を持たない（ログインが要り、使う人が限られる）
  - D2 目標（端末ごと）

    | | モバイル | デスクトップ |
    |---|---|---|
    | Performance | 90 以上 | 95 以上 |
    | Accessibility | 100 | 100 |
    | Best Practices | 100 | 100 |
    | SEO | 100（公開＝テストモード off の後） | 100（同じ） |
    | LCP | 2.5 s 以下 | 目標なし |
    | CLS | 0.1 以下 | 目標なし |
    | TBT | 200 ms 以下 | 目標なし |

    - 判定は3回の中央値で行う。値ごとに中央値を取る（中央の1回の値ではない）
    - 判定は公開後の値から始める（公開前はテストモードの noindex で SEO が 69）
  - D3 測り方
    - 本番を毎日1回（03:17 JST、`cron: '17 18 * * *'`）と手動で測る。PR の CI とは別のワークフロー `.github/workflows/lighthouse.yml`（`uptime.yml` と同じ形）
    - 道具は Lighthouse 13.5.0 の CLI（`npx lighthouse@13.5.0`、版を固定）。Chrome は GitHub のランナーに入っているものを headless で使い、版は Summary に出す。モバイルは既定（シミュレートしたスロットリング）、デスクトップは `--preset=desktop`
    - 回数は5ページ×2端末×3回
    - 記録は2か所：実行の Summary（中央値の表、`scripts/lighthouse-summary.ts`）と、JSON のレポートの artifact（30日）
    - 必須の検査にしない。PR の CI に入れない。LHCI は使わない
    - 臨時の確認は、Actions の手動実行か、手元の `bash scripts/lighthouse-run.sh` で行う
  - 最初は測るだけにする：点数でワークフローを落とさず、Issue も開かない（ワークフローが落ちるのは、Lighthouse の結果が出なかったときだけ）
    - 目標割れで Issue を開き、戻ったら閉じる判定（`uptime.yml` と同じ形）は、公開後の基準の値が数日分そろってから足す（#612）
  - D4 バンドルの予算
    - 同じ実行の resource-summary（Lighthouse の audit）で、ページごとの JS（script）と CSS（stylesheet）の転送量（圧縮後）を取る。最初の一歩では Summary に出すだけ
    - 上限は公開後の最初の値＋10%。超えたら警告だけで、止めない。基準の値がそろってから足す（#613）
    - `build:analyze`（`@next/bundle-analyzer` が無く、webpack 専用）は `next analyze`（Turbopack の Bundle Analyzer）に置き換える（#611）
  - D5 記録と切り出し
    - この決定を1件書き、続きを Issue にした（#611 `next analyze`・#612 目標の判定・#613 バンドルの予算の警告・#614 公開後のフィールドデータ）
    - #510（メイン LP の LCP）の優先度は、公開後に目標との差を見て見直す
- **理由**:
  - #7 の「90+」は、対象のページ・端末・回数が決まっておらず、達成したかを判定できなかった
  - 本番の値（#497、Lighthouse 13.5.0）はモバイル 89〜93、デスクトップ 97〜100。モバイル 90・デスクトップ 95 は今の値のすぐ下なので、悪くなればすぐ分かる
  - 1回の計測は数点ぶれる（#497）ので、3回の中央値で見る
  - CI を重くしない方針（`2026-10-18-ci-light-and-audit-gate`）。main へのマージのたびに本番が更新されるので、本番を毎日測れば、どの日のマージで変わったかを追える
  - 判定を先に入れると、公開前のテストモードの SEO や、基準の無い値で Issue が開き続ける
- **却下案**:
  - PR ごとに Lighthouse を流す（CI が重くなる。プレビューと本番では配信の条件が違う）
  - LHCI（`@lhci/cli`。結果の置き場所と設定が増える。今は CLI と集計のスクリプトで足りる）
  - 最初から目標割れでワークフローを落とす・Issue を開く（基準の値がまだ無い）
  - 管理画面の点数の目標（テスト用の組織とログインの手順が要る）
- **ルール**:
  - 値は GitHub のランナーから本番を測った lab の値。#497 の手元の値とも、利用者の値（フィールドデータ、#614）とも、そのまま比べない
  - Lighthouse の版・回数・ページ・オプションを変えたら、この決定を更新する。前後の値を比べられないことを、その PR に書く
  - 計測の送信（Vercel Web Analytics の `/_vercel/insights/view`・`event`、GA4 の `/g/collect`、自前の `/api/collect`）は `--blocked-url-patterns` で止める
    - 止める理由：毎日30回の表示を、利用者の数字に混ぜないため。Lighthouse の UA はふつうの Chrome の UA（`moto g power (2022)`）で、`lib/features/site-visits` のボットの判定に当たらない
    - 止めるのは送信だけで、スクリプトの読み込みと実行は止めない。その重さは値に入る
    - 止めた要求のコンソールのエラーは Lighthouse が数えない（`errors-in-console` の `ERR_BLOCKED_BY_CLIENT.Inspector`）。Best Practices は下がらない（2026-10-24 に手元のページで確かめた）
  - 集計（`scripts/lighthouse-*.ts`）は依存を足さない。Node 22（型の除去）と Bun の両方で動く TypeScript にする。ワークフローは Node だけを入れ、`sparse-checkout` で `scripts/lighthouse-*` だけを取り出す
  - ワークフローの権限は `contents: read` だけにする。判定を足すとき（#612）に `issues: write` を足す
