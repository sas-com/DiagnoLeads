---
id: 2026-10-24-diagnosis-shared-rules
date: 2026-10-24
category: Assessments
title: "2つ目の診断はビルダーで作り、AX とずれている規則は5点ともそろえて diagnostics 直下にまとめる（#481）"
status: active
superseded_by: []
issues: [450, 481]
paths: ["lib/features/leads/assignment.ts", "lib/features/diagnosis-builder/notify.ts", "lib/features/diagnosis-builder/submission-service.ts", "lib/features/diagnosis-builder/limits.ts", "lib/features/diagnostics/ax-migration/notify.ts", "lib/features/diagnostics/ax-migration/submission-service.ts", "lib/features/diagnostics/ax-migration/limits.ts", "app/api/diagnoses/[slug]/**", "app/api/diagnostics/ax-migration/route.ts", "app/api/diagnostics/ax-migration/consultation/route.ts"]
---

### [Assessments] 2つ目の診断はビルダーで作り、AX とずれている規則は5点ともそろえて diagnostics 直下にまとめる（#481）
- **日付**: 2026-10-24
- **経緯**: #450 の質問5に、オーナーが「推奨どおりで進めてください」と答えた。推奨（ビルダーで作る・5点ともそろえる）は、回答の前に Issue に書いていなかった。この決定と PR で初めて示した
- **決定**:
  - 2つ目の診断は、診断ビルダー（決定 2026-10-16-diagnosis-builder-foundation）で作る。診断を登録する仕組みは作らない。テーマ・対象・担当は、今までどおり AX 診断の公開判断の後に決める（決定 2026-10-18-second-diagnosis-timing）
  - AX とビルダーで次の5点がずれている。AX だけにしておくものはなく、5点ともそろえる
    1. 結果画面から相談申込を受け付ける期間（回答から24時間。過ぎたら 409）：AX にあり、ビルダーにない（営業への連絡期限の2営業日は両方にある）
    2. 相談申込の通知の別枠：AX は相談申込を上限の外で送り、ビルダーは上限に達すると相談申込の知らせも止まる
    3. 組織の窓口メンバー宛て：AX は `consultationRecipients` で窓口がいれば窓口に送る。ビルダーは、この決定を書いた時点では常に全員（アプリ内）と `AX_DIAGNOSIS_SALES_EMAIL`（メール）に送っていた。#563 の `builderConsultationRecipients` で直した（窓口がいれば窓口、いなければその組織のメンバー。`AX_DIAGNOSIS_SALES_EMAIL` は運営の組織の診断のときだけ）。残りは、この規則を共有の関数にして AX からも呼ぶこと
    4. 代理店リンクと社員紹介：AX は発行済みのリンクと社員紹介（紹介者と、紹介した社員への通知）を扱う。ビルダーは `inferInflowSource`（UTM と ref）だけで、`tracking.agency` を無視する
    5. サーバーエラーの運用アラート：AX は `reportServerError` を呼び、ビルダーのルートは `console.error` だけ（拒否のアラート `reportRejectedRequest` は両方にある）
  - そろえる規則は `lib/features/diagnostics/` の関数にまとめ、AX とビルダーの両方から呼ぶ。ビルダーから読むので、`diagnostics` の `types/` か `service.ts` から出す（ほかの機能から読めるのはそれだけ。docs/ARCHITECTURE.md の `cross-feature-internal`）。まとめるもの：連絡先の型（contactSchema）・plainText・流入元の判定（resolveInflow）・相談申込の確定（claimConsultation）・通知の宛先と上限。運用アラートは、ビルダーのルートから `lib/ops/alert` の `reportServerError` を呼ぶ（移さない）
  - 回答の後の処理が増えたら（#48・#154）、`afterDiagnosisSubmitted` という関数を1つだけ作る（イベントにはしない。#308）
- **理由**: 一部は AX から import し（連絡期限・営業メールの上限・電話番号）、残りを手で写した結果、主なずれが5点ある（ほかに、上限に達したときのメールでの知らせなどの小さな差もある）。2つ目の診断をビルダーで作ると、今のままではビルダーのずれ（受付期間がない・上限で相談申込が止まる。窓口宛ては #563 で直した）をそのまま引き継ぐ
- **却下案**: 今のまま（2つ目以降の診断がビルダーのずれを引き継ぐ。AX のようにコードで作れば3か所目の写しになる）、診断を登録する仕組みを作る（利用先が2つで、先回りの抽象化になる）
- **ルール**:
  - ビルダーの相談申込の宛先は、診断の組織に限る（窓口がいれば窓口、いなければその組織のメンバー）。`AX_DIAGNOSIS_SALES_EMAIL` に送るのは、運営の組織（`resolveDiagnosisOrganizationId()`）の診断のときだけ。`consultationRecipients` は窓口のいない組織でこのアドレスに戻るので、そのまま呼ぶだけでは足りない。相談申込の宛先は #563（#481 の1）で直した。上限に達したときの知らせ（AX の `noticeLimitReached`）を運営の組織に限る修正は #563 に入っていないので、まとめる PR（#481 の2）で入れる。どちらも、ビルダーの画面（#117〜#121）を出す前に入っていること
  - diagnostics 直下の関数は `diagnostics/ax-migration/` を import しない（docs/ARCHITECTURE.md）。使っている AX の定数（連絡期限・営業メールの上限・電話番号の形）も、まとめるときに直下へ下ろす。営業メールの上限は今 AX と同じ枠を数えているので、まとめるときに分けるか共有のままにするかを決める
  - 代理店リンクをビルダーの診断にも使えるようにするので、決定 2026-10-16-agency-links（リンクは AX 診断の URL だけ）の範囲を広げる。まとめる PR で、あちらの決定も直す
  - plainText の写しは、ほかに4つの機能の `types/schemas.ts` にもある。そちらの整理は別の Issue で行う
  - 時期：1 は #563 で済み。まとめるのは #480 の後（#481 の「順番」）
