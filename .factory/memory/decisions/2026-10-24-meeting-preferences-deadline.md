---
id: 2026-10-24-meeting-preferences-deadline
date: 2026-10-24
category: Assessments
title: "初回商談の希望日時は、相談申込から24時間だけ受け付ける（#241、2026-10-18-meeting-requests の一部を変更）"
status: active
superseded_by: []
issues: [241]
paths: ["lib/features/meeting-requests/service.ts", "app/api/diagnostics/ax-migration/consultation/route.ts", "app/api/diagnoses/*/consultation/route.ts"]
---

### [Assessments] 初回商談の希望日時は、相談申込から24時間だけ受け付ける（#241、2026-10-18-meeting-requests の一部を変更）
- **日付**: 2026-10-24
- **決定**: 結果画面から希望日時を送る（送り直す）のは、その回答の相談申込（`diagnostic_submissions.consultation_requested_at`）から24時間（`MEETING_PREFERENCES_WINDOW_MS`）までにする。過ぎたら保存せず、応答の `preferences` を `'unavailable'` にする。AX 診断と診断ビルダーの両方に当てる。#241 の「一定期間」を、Claude が24時間に決めた（値はオーナーが変えてよい。変えるときは `MEETING_PREFERENCES_WINDOW_MS` だけを直す）
- **変えたところ**: `2026-10-18-meeting-requests` のルール「確定までは送り直しで置き換わり、確定後は変わらない」に、「相談申込から24時間まで」の期限を足した。確定後に変わらないのは今までどおり
- **理由**: 相談申込は回答から24時間で締め切る（#232）。しかし申込済み（`alreadyRequested`）なら、期限なしで `acceptMeetingPreferences` を呼んでいた。submissionId を持つブラウザ（や漏れた id）から、営業が確定するまでは何日後でも希望を書き換えられ、営業が見ている候補が変わりうる
- **ルール**:
  - 期限の起点は、その回答の相談申込の時刻。回答と一緒に申し込んだときは回答の時刻になる。`requestAxMigrationConsultation`・`requestBuilderConsultation` が `requestedAt` として返し、ルートがそれを `acceptMeetingPreferences` に渡す
  - 長さは、結果画面がフォームを出している1日（`RESULT_SCREEN_WINDOW_MS` と同じ24時間）。値は meeting-requests に置く（meeting-requests から diagnostics/ax-migration を読まない）
  - 期限を過ぎた送信は、DB を読まずに断る。応答は `'unavailable'` で、フォームは「ご希望の日時は、担当者からご連絡する際にお伺いします。」と出し、送り直しを勧めない。新しい状態は足さない（画面と文言を変えずに済む）
  - 同じ人が別の回答から新しく相談申込をすれば、その申込から24時間はまた受け付ける（希望はリードごとに1件のまま）
- **却下案**:
  - 回答の時刻から24時間（相談申込の締め切りと同じ起点）：締め切りの直前に申し込んだ人は、希望を入れる前に締め切られる
  - 新しい状態 `'closed'` を返し、画面に専用の文言を出す：AX の公開（10/29）の前に画面と文言を変えることになる。今の `'unavailable'` の文言で用が足りる
  - 期限なし（今まで）：上の理由
