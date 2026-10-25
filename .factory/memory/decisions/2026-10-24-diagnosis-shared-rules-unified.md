---
id: 2026-10-24-diagnosis-shared-rules-unified
date: 2026-10-24
category: Assessments
title: "AX とビルダーの5点を diagnostics/service.ts にまとめた。時期はオーナーが #480 の前に変えた（#481、2026-10-24-diagnosis-shared-rules と 2026-10-16-agency-links の一部を変更）"
status: active
superseded_by: []
issues: [481]
paths: ["lib/features/diagnostics/service.ts", "lib/features/diagnostics/types/consultation.ts", "lib/features/diagnostics/types/contact.ts"]
---

### [Assessments] AX とビルダーの5点を diagnostics/service.ts にまとめた。時期はオーナーが #480 の前に変えた（#481、2026-10-24-diagnosis-shared-rules と 2026-10-16-agency-links の一部を変更）
- **日付**: 2026-10-24
- **経緯**: `2026-10-24-diagnosis-shared-rules` では、まとめる作業を #480 の後（11/14 以降）にしていた。オーナーが「今すぐ全部やる」を選んだ（AX の公開 10/29 の前に AX の公開フォームのコードを触ることも承知のうえ）
- **変えたところ**:
  - `2026-10-24-diagnosis-shared-rules` の「時期：まとめるのは #480 の後」を外した。ほかのルールは変えていない
  - `2026-10-16-agency-links` の「リンクは AX 診断の URL だけ」を広げた。組織が発行したコードは、その組織のビルダーの診断の URL（`/diagnostic/<slug>?agency=<コード>`）でも効く。リンクを発行する画面が出す URL は AX のままで、ビルダーの URL を出す画面は #117〜#121 で作る
- **決定**: 5点を `lib/features/diagnostics/` の公開面にまとめ、AX とビルダーの両方から呼ぶ。`diagnosis-builder/` は `diagnostics/ax-migration/` を読まなくなった
  1. 相談申込の受付期間：`claimConsultation`（`service.ts`）。回答から `CONSULTATION_WINDOW_MS`（24時間、`types/consultation.ts`）を過ぎたら `closed`。ビルダーのルートも 409 `{ code: 'closed' }` を返し、結果画面は「受付期間を過ぎた」と出す。プレビューのテスト回答（`is_test`）は、AX でも受け付けない（AX は `is_test` を書かないので挙動は同じ）
  2. 通知の上限：`checkNotificationLimits`。上限を超えても、相談申込は別枠（ビルダーは `dx-notify-consultation-org`、1時間300件）で知らせる。Webhook は上限の中だけ
  3. 宛先：`diagnosisConsultationRecipients`（#563 の `builderConsultationRecipients` を移した）。AX も使う。上限に達したときの知らせのメール（AX の `noticeLimitReached`）も、運営の組織（`resolveDiagnosisOrganizationId()`）のときだけ `AX_DIAGNOSIS_SALES_EMAIL` に送る
  4. 代理店リンクと社員紹介：`resolveInflow`。ビルダーも `agency_link_id` を付け、社員の紹介リンクなら紹介した社員に知らせる（文言は診断の名前を出す）
  5. 運用アラート：ビルダーのルートも `reportServerError` を呼ぶ（`diagnosis/submit`・`diagnosis/notify`・`diagnosis/consultation`・`diagnosis/consultation-notify`）
  - そのほか：連絡先の型（`contactSchema`・`plainText`・電話番号の形）は `types/contact.ts`、連絡期限（2営業日）と `consultationDeadline` は `types/consultation.ts`
- **営業メールの上限**: 分けずに共有のままにした（`SALES_EMAIL_LIMITS`、名前は `ax-sales-email-org-hour`・`ax-sales-email-org` のまま）。送信の枠はログインのメールと組織ごとに共有なので、診断ごとに枠を足すと、上限が守るものを超えて送れてしまう
- **却下案**:
  - #480 の後まで待つ：オーナーが選ばなかった
  - 送る処理（アプリ内・メールの振り分け）まで1つの関数にする：文面と Webhook の中身が診断ごとに違い、引数が増えるだけ。宛先と上限だけを共有し、同じ結果になることをテスト（`test/unit/features/diagnostics/shared-rules.test.ts`）で確かめる
- **ルール**:
  - 公開の診断の規則を変えるときは `diagnostics/service.ts` か `types/` を直し、AX とビルダーの両方に効かせる。片方だけに写さない
  - `diagnostics/service.ts` と `types/` は `diagnostics/ax-migration/` を import しない
