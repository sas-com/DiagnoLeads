---
id: 2026-10-28-auto-qualification-deal
date: 2026-10-28
category: Sales
title: "初回の打ち合わせが確定したら、商談（見極め）を ensureQualificationDeal の1か所で自動で作る。どの入口でも商談は1件（#854）"
status: active
superseded_by: []
issues: [854, 856, 276]
paths: ["lib/features/deals/service.ts", "lib/features/deals/lead-sync.ts", "lib/features/meeting-requests/service.ts", "components/features/meeting-requests/meeting-request-card.tsx", "lib/features/agency-handovers/service.ts", "lib/features/prospects/api/router.ts", "components/features/agency-handovers/handover-import-dialog.tsx", "components/features/prospects/prospect-form-dialog.tsx", "components/features/prospects/prospect-convert-dialog.tsx"]
---

### [Sales] 初回の打ち合わせが確定したら、商談（見極め）を ensureQualificationDeal の1か所で自動で作る。どの入口でも商談は1件（#854）
- **日付**: 2026-10-28
- **決定**: オーナーの判断「初回の打ち合わせが確定したら、商談（見極め）を自動で作る」（2026-10-28、決定 `2026-10-28-consolidate-input-places`）を実装する。作る・作らない条件、作る商談の値、副作用、入口の条件、権限、重複の防ぎ方は、architecture-specialist の読み取り専用の設計（2026-10-28）に沿って Claude が決めた
  - 作成は `lib/features/deals/service.ts` の `ensureQualificationDeal` の1か所にまとめ、3つの入口（打ち合わせの確定・顧客探しの商談日・代行のアポ）が、それぞれのトランザクションの中から呼ぶ
  - #854 の PR の分け方：1つ目で作成の共通化と打ち合わせの確定（`confirmMeeting`）、2つ目で顧客探しの商談日と代行のアポ、3つ目で商談の無い商談中のリードの件数。2つ目の PR で3つの入口がそろった（2026-11-08）
- **理由**: 商談を手で作り忘れると、そのリードは予測とボードから漏れる（決定 `2026-10-28-consolidate-input-places` の評価）。入口ごとに作成の処理を書くと、条件と副作用がずれ、同じリードに商談が2件できる
- **ルール**:
  - 作る・作らない（判定は `lib/features/deals/lead-sync.ts` の `qualificationDealSkip`）
    - 作らない：開いた商談（見極め・課題の確認・提案・条件の調整）がある（`open_deal`）／受注の商談がある、または手で成約にした（`wonWithoutWonDeal`。`won`）／商談が無く、手で付けた商談フェーズが初回ヒアリングより先（`phase_ahead`。作るとフェーズが初回ヒアリングに戻るため。3つ目の PR の件数で拾う）／リードが無い（`lead_not_found`）。どれも例外にせず、入口の操作（確定など）はそのまま成功させる。手で作る `createDeal` が手で成約にしたリードを BAD_REQUEST で断るのとは違う
    - 作る：商談が無い（上を除く）／失注の商談だけがある（時期が来た再接触。決定 `2026-10-25-deals-set-lead-stage`）。失注の商談だけなら、商談フェーズが簡易診断・提案でも作る（リードは商談中・初回ヒアリングに戻る）。ただし、状態が成約か受注のフェーズ（現行調査受注・移行受注・AX化）が残っているリードは、失注の商談だけでも手で成約にしたリード（`wonWithoutWonDeal`）として作らない
    - 受注済みのリードの次の商談（移行・AX 化）は、営業が種類と前の商談を選んで手で作る
  - 作る商談の値：種類は現行調査（`survey`。`createDealSchema` の既定）、ステージは見極め、確度は 10%（`STAGE_PROBABILITY`）、担当はリードの担当 → 操作した人 → 無し（リードを持てるメンバーだけ。`createDeal` と同じ）、対象システムはリードの値、金額・受注予定日・予測の区分・前の商談は無し。作った人・履歴・監査の user は操作した人
    - 名前は「現行調査」（`QUALIFICATION_DEAL_NAME`）を、日本語のまま保存する。言語に依らない値（空・印の文字列）にして画面で訳す形にはしない。`deals.name` は必須の自由入力で（印を持たせるには列の変更が要る）、売上予測・活動履歴・今日の画面・商談の画面がそのまま読み、組織に言語の設定は無い。同じ入口の「次の行動」の題名（初回商談 …）も日本語で保存している。ボードと一覧は会社名・氏名を並べて出すので見分けられる。ただし売上予測の「今週の変化」（`lib/features/sales-forecast/service.ts` の `getPipelineChanges`、画面は商談名と担当者だけを出す）では、同じ名前の商談が並ぶと見分けにくい（会社名を足すのは別の Issue）。営業が分かった時点で名前を直す
    - 初回商談日の列は足さない。商談の監査ログの metadata に `{ leadId, source, meetingOn }` を残す（`source` は `QUALIFICATION_DEAL_SOURCES`：`meeting_request`・`prospect`・`agency_handover`）。`meetingOn` は実在する日付（YYYY-MM-DD）で、ほかの値は呼び元の誤りとして `ensureQualificationDeal` が何も読み書きする前に例外にする
  - 副作用：deal_history（`['created']`）、商談の監査ログ、リードへの反映（商談中・初回ヒアリング・商談済み・到達日）とリードの監査ログ（metadata に `{ dealId, source }`。手で作った商談では今までどおり `{ dealId }`）は、入口と同じトランザクションで書く。Webhook はコミットの後に `afterDealChanges` で1回だけ出す（複数の商談を作る入口は、結果を集めて1回）。引き継ぎのメール・通知は出ない（見極めで作るので `isFirstHandoff` が偽）。新しい通知・メールは足さない
  - 入口の条件：日付が新しく入ったとき、前と違う日付に変わったときだけ呼ぶ。同じ日付の保存し直し（同じ日の別の時刻・取り込み直し）では呼ばない（失注にした商談が、また作られないため）。過去の日付でも作る
    - 打ち合わせの確定（`lib/features/meeting-requests/service.ts` の `confirmMeeting`）：ロックする select で `confirmed_on` を読み、新しく確定したとき・別の日に確定し直したときだけ呼ぶ。応答には `dealCreated` だけを足す。画面（`meeting-request-card.tsx`）は、確定でリードの表示（次回日程）を、作ったときは商談と活動履歴も読み直し、トースト（`deals.autoCreated`。3つの入口で共有し、件数を受ける）で知らせる
    - 代行のアポの取り込み（`lib/features/agency-handovers/service.ts` の `importHandovers`。最大500行・1トランザクション）：保存する行のリードを id の順に1文でロックし（`for no key update`）、ロックの後に前の `appointment_on` を読み、引き継ぎを upsert してから、アポ日が新しく入った・前と違う日に変わったリードだけを `ensureQualificationDeals` にまとめて渡す（source `agency_handover`、meetingOn はアポ日）。マッチングの後に消えたリードの行は「見つからなかった行」にする。応答には作った件数（`dealsCreated`）だけを足し、Webhook はコミットの後に `afterDealChanges` で1回にまとめる。画面（`handover-import-dialog.tsx`）は、作ったときにリード・商談・活動履歴を読み直し、件数入りのトーストを出す
      - `ensureQualificationDeals` は `ensureQualificationDeal` の一括版（`ensureQualificationDeal` はこれを1件で呼ぶので、判定・値・副作用は1か所）：リードのロックと読み込みが1文（id の順）、商談の読み込み・担当の候補の読み込み・商談の insert・履歴の insert・商談の監査の insert・リードの監査の insert がそれぞれ1文で、リードの更新だけが1件ずつ。手で作る `createDeal` も同じ insert の処理（`insertDeals` を1件で）を通る
      - 500行（500件の商談）の取り込みを手元の PostgreSQL で測ると、行ごとに `ensureQualificationDeal` を呼ぶ形は 5,505 文・約2.5秒、一括版は 1,013 文・約1.0秒（商談を作らない取り込みは 505 文・約0.4秒）。本番（Vercel hnd1 から Supabase）は1文ごとの往復が加わるので、行ごとの形では 1文 1〜3 ミリ秒として約8〜19秒（関数の上限は30秒、`vercel.json`）になり、その間500件のリードをロックし続けるため、一括版にした
      - Webhook の1回の上限（`LEAD_WEBHOOK_EVENT_LIMIT`、500件のイベント）は、リードの CSV の取り込みと同じく今の仕組みのままにする：1件の商談でリードのイベントが2件（`lead.updated`・`lead.status_changed`）出るので、約250件を超える商談の分のイベントは `lib/features/webhooks/services/lead-events.ts` の `sendLeadEvents` で送らずに件数だけを報告する（`webhooks/lead-events-limit`。上限の中でも、時間内に送れずキューに回る配信が `WEBHOOK_BATCH_QUEUE_LIMIT` を超えた分は `webhooks/lead-events-queue-limit` で報告）。本番の Webhook は0件（決定 `2026-11-05-lead-webhook-personal-data`）。購読者が出てきて大きな取り込みが続くなら、上限の扱いを見直す
    - 顧客探しの商談日（`lib/features/prospects/api/router.ts`）
      - `update`：営業がリード化済みの行（`lead_id` あり）で商談日を新しく入れた・別の日に変えたときだけ、トランザクションの中で、リード（`for no key update`）→ 行（`for update`）の順にロックし、行の `lead_id` が読んだときと同じか確かめ（リードが消された・つなぎ直されたなら CONFLICT。もう一度保存すれば今の行で判定する）、ロックの下で日付をもう一度比べてから更新と `ensureQualificationDeal`（source `prospect`）を行う。リード化していない行・同じ日の保存し直し・日付を消したときは今までどおりトランザクションなしで保存する
      - `convertToLead`：行に商談日があれば、リードにつないだ後に呼ぶ。ここだけ行 → リードの順にロックするが、つなぐまで行の `lead_id` はほかから見て空なので、リードの削除が行を待つことはなく、すれ違わない
      - 応答には `dealCreated` だけを足す。画面（`prospect-form-dialog.tsx`・`prospect-convert-dialog.tsx`）は、作ったときにリード・商談・活動履歴を読み直し、トーストを出す（リード化では、作らなくてもリードを読み直す）
  - 重複の防ぎ方：リードの行ロック（FOR NO KEY UPDATE）。商談の書き込みはすべてリードの行で待ち合わせている（決定 `2026-10-24-deals-beside-leads`）。`ensureQualificationDeal` はリードをロックしてから、そのリードの商談を読む。READ COMMITTED なので、待った後の読み込みは先にコミットされた商談を見る
    - 入口はトランザクションの最初にリードをロックする（ロックの順：リード → 子の行。商談の変更・リードの削除と同じ順にして、デッドロックを避ける）。`confirmMeeting` は、リード → 希望日時の行（FOR UPDATE）の順に取る。複数のリードをロックする入口（代行の取り込み）は、id の順に取る
    - 手で作る商談（`createDeal`）は止めない。同じリードに開いた商談が並ぶことは決定が許している（自動の作成が先なら、手で作る商談は2件目になる）
  - 権限：自動の作成は入口の権限（打ち合わせの確定・代行のアポの取り込みはリードの更新で、親組織の閲覧者を除く）で行い、`canWriteDeals` は見ない。顧客探しは、行を変えられる権限（営業＝設定の更新）とは別に、`ensureQualificationDeal` を呼ぶ前に `update Lead` と親組織の閲覧者でないことを確かめる（今は営業の役割はどれもリードを更新できるが、#276 の代行のアカウントを見越す。security-specialist の指摘）。持たない人の保存・リード化は、行だけを変えて商談を作らない（`dealCreated: false`。入口の操作を失敗させない）。応答は作ったかどうか（取り込みは件数）だけで、商談の中身は返さない（商談を読めない役割、#276 の代行のアカウントを見越して）。この形は「リードを更新できる役割は、どれも商談を書ける」ことが前提で、`test/unit/features/deals.test.ts` がすべての役割で確かめる（役割を足すと型の検査かそのテストで落ちる。商談を読めないのにリードを変えられる役割を足すときは、入口で商談を作るかを先に決める）
  - 打ち合わせが流れたら、営業が商談を失注（理由付き）にする。自動で消す・失注にすることはしない
  - 依存の向き：meeting-requests → deals は循環にならない。agency-handovers・prospects → deals は、deals → lead-hearings → それら があるので循環になる。2つ目の PR で許可リスト（`scripts/architecture/allowlist.txt`）に `features-in-cycles deals` の1行を足した。循環をなくす移動（ヒアリングの下書きを lead-hearings に移す）は #959 で行い、そのときにこの行を消す。ファイルの移動になるので、RLS の作業中（11/4〜11/14）は移さない
  - 既存のデータ（この変更の前に確定済みで、商談の無いリード）には自動では作らない。本番の件数を読み取りだけの SQL で出してから（オーナーの承認が要る）、少なければ営業が手で作り、多ければ `ensureQualificationDeal` を呼ぶ一度だけのスクリプト（既定は dry-run）を別の PR で出す
- **却下案**:
  - advisory lock（`pg_advisory_xact_lock`）で重複を防ぐ：商談の削除・変更はリードの行で待ち合わせていて、advisory lock とは待ち合わせない。削除と自動の作成がすれ違い、読んだ商談の状態と書く時の状態が食い違う。リードの行ロックなら、今の商談の書き込みと同じ順で待ち合わせる
  - 一意の索引（リードごとに開いた商談は1件）：同じリードに開いた商談が並ぶこと（移行と AX 化など）を決定が許していて、手で作る商談まで止めてしまう。スキーマの変更も要る
  - 定期実行で、商談の無い確定済みのリードに後から作る：作るまでの間、予測とボードから漏れる。どの入口から誰の操作で作られたかが残らない。漏れは3つ目の PR の件数で見る
  - 画面から2回目の呼び出し（確定の後に `deals.create` を呼ぶ）：確定と作成が別のトランザクションになり、片方だけ残る。画面ごとに書くので入口が増えると漏れ、商談を作れない役割では作られない
- **見直しの条件**: 自動で作った商談が打ち合わせの前に失注になることが多ければ、作る時点（確定した時点か打ち合わせの当日か）を見直す。手で成約にしたリードと、商談フェーズが先のリードに作らない扱いは、3つ目の PR の件数を見て決め直す
