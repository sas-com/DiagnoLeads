# 本番 DB の戻し手順

本番の Supabase（DiagnoLeads v2）のデータが壊れた・消えたときに、正しかった時点へ戻す手順。アプリは Vercel。

- 作成：2026-10-23（#51「バックアップの確認」）／確定：2026-10-24（#515）
- **前提（2026-10-24 オーナー決定）**：Supabase は **Free プランのまま**。Free には毎日の自動バックアップも PITR もない（10/24 に Management API で 0 件を確認）。そのため、**毎日、手元で書き出した控え（pg_dump）から戻す**

## 1. まず決めること（戻すかどうか）

戻すと、その控えより後の書き込み（リード・診断の回答・ヒアリング・通知）はすべて消える。次の順で、戻さずに済まないかを先に考える。

1. **一部の行だけの問題か**：誤った更新・削除が特定の表・行だけなら、戻さずに SQL で直す（件数を確かめてから実行し、件数が合わなければ止まる SQL にする）。消えた行は、控えを使い捨ての DB に戻して（`scripts/prod-dump-verify.sh`）そこから拾える
2. **全体が壊れたか**：DB が開けない、広い範囲のデータが消えた → 戻す
3. **どの控えに戻すか**を決める：誤った SQL を流した時刻、デプロイの時刻（Vercel の記録）より前の、いちばん新しい控え

戻すと決めるのは **オーナー**。消える期間を了承してから進める。

## 2. 毎日の控え（仕組み）

| 項目 | 内容 |
|---|---|
| 何を | `public`・`drizzle`・`app` スキーマの定義とデータ（pg_dump 17、custom 形式）。`cms` は含めない（CMS のパスワードのハッシュがあり、本番の CMS はオフ） |
| どの接続で | 読み取り専用のユーザー `dl_readonly`。接続文字列は `~/.config/diagnoleads/prod-ro.env`（権限 600）にだけ置き、表示しない |
| どこに | オーナーの PC（WSL）の `~/diagnoleads-backups/`（フォルダ 700・ファイル 600）。リポジトリ・チャット・Issue には置かない |
| いつ | cron で1時間ごとに起動し、その日（日本時間）の分がまだなければ書き出す。PC が動いている日だけ取れる。本番に SQL を流す前は必ず `--now` で書き出す |
| 何日分 | 14日分。古いものは自動で消す |
| 誰が | 仕組みは自動。中身の確認と戻す判断はオーナー、作業は Claude とオーナー |
| 暗号化 | ファイル自体は暗号化していない。PC のディスクの暗号化（BitLocker）と、ファイルの権限で守る |
| スクリプト | `scripts/prod-dump.sh`（書き出し）、`scripts/prod-dump-verify.sh`（使い捨ての DB に戻して件数を出す）、`scripts/prod-restore-to.sh`（新しいプロジェクトへ戻す）。cron が動かすのは `~/diagnoleads-prod-db/prod-dump.sh` の写しで、リポジトリの版を変えたら写し直す |

状態の確かめ方：`ls -l ~/diagnoleads-backups/`（今日の日付のファイルがあるか）と `tail ~/diagnoleads-backups/dump.log`。

## 3. 戻す前に

1. **社外からの送信を止める**：Vercel の Production の環境変数 `APP_TEST_MODE=true` にして再デプロイする。社外のメールアドレスからの診断・相談を受け付けなくなる
2. 戻す時点から今までに届いた問い合わせの通知メールを、営業に残しておいてもらう（戻した後に手で拾い直すため）
3. 今の本番も、念のため書き出しておく：`bash ~/diagnoleads-prod-db/prod-dump.sh --now`（DB が読めるとき）

## 4. 戻す（新しいプロジェクトへ流して、切り替える）

**本番の DB に上から流し込まない。** 新しい空の Supabase プロジェクトに流し、確かめてから、アプリの接続先を切り替える。

1. **控えを確かめる**：`bash scripts/prod-dump-verify.sh <控え>` で使い捨ての DB に戻り、件数が出ることを見る
2. **新しいプロジェクトを作る**（オーナー）：Supabase の管理画面で、同じ組織・同じリージョン（ap-northeast-1）に作る。Free の組織に置けるのは、動いているプロジェクト2つまで
3. **流し込む**（オーナー）：`bash scripts/prod-restore-to.sh <控え>`
   - 新しいプロジェクトの接続文字列（Session pooler、`postgres` ユーザー）を聞かれるので貼る。画面には出ない
   - `public` に表が1つでもあれば止まる（本番に流してしまわないため）
   - 拡張機能（ltree・vector・pgcrypto・uuid-ossp）は `extensions` スキーマに自動で入れる
4. **CMS を使っていたら**：`cms/migrations/sql/` の SQL を、新しいプロジェクトの SQL Editor で流す（控えに cms は入っていない）
5. **読み取り専用のユーザーを作り直す**：`~/diagnoleads-prod-db/setup-prod-ro.sh` の手順で `dl_readonly` を作り、連番の読み取り（`GRANT SELECT ON ALL SEQUENCES IN SCHEMA public, drizzle`）も付ける
6. **接続先を切り替える**（オーナー）：Vercel の Production の `DATABASE_URL`（ほかに DB の接続文字列を使う変数があればそれも）を新しいプロジェクトに替えて、再デプロイする

## 5. 戻した後

1. 読み取り専用で件数を確かめる：`organizations`・`organization_members`・`users`・`leads`・`diagnostic_submissions`
2. マイグレーションの記録（`drizzle.__drizzle_migrations`）が、リポジトリの `drizzle/` の最後の番号までそろっているか確かめる。足りなければ、不足分を SQL Editor で流す
3. `APP_TEST_MODE` を元に戻して再デプロイする
4. 本番で診断を1件通し、確認欄（Turnstile）・通知・リードの表示を確かめる
5. 戻した期間に届いていた問い合わせを、通知メールから営業が拾い直す
6. 古いプロジェクトは、原因を調べ終わるまで消さない
7. #51（または新しい Issue）に、時刻・原因・戻した控え・消えた期間を記録する

## 練習の記録

- 2026-10-24：10/24 14:05 の控えを、本番と同じ系列のイメージ（supabase/postgres:17.6.1.176）の使い捨ての DB に戻し、全55表の件数が本番と一致した（`prod-dump-verify.sh`）。同じ控えを `prod-restore-to.sh` で空の DB に流し、表55・`users` 3件・マイグレーションの記録31件・`app` の関数4つがそろうこと、2回目は「表がある」で止まることを確かめた

## 有料（Pro）にした場合

Pro にすると毎日の自動バックアップ（7日分）が付き、Supabase の管理画面の Database → Backups から **Restore** で戻せる（プロジェクト全体が戻り、数分〜数十分つながらない）。そのときは、この文書の 2・4 を置き換える。
