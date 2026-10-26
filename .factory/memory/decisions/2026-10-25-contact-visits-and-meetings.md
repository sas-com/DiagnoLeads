---
id: 2026-10-25-contact-visits-and-meetings
date: 2026-10-25
category: Sales
title: "連絡の記録に訪問・オンライン商談を足し、日時・所要時間・結果・商談を残す（#554）"
status: active
superseded_by: []
issues: [554, 430]
paths: ["lib/features/lead-follow-up/types/schemas.ts", "lib/features/lead-follow-up/service.ts", "lib/features/lead-follow-up/api/router.ts", "components/features/lead-follow-up/record-activity-dialog.tsx", "components/features/lead-follow-up/contact-quick-actions.tsx", "lib/features/lead-activity/api/router.ts", "lib/features/deals/access.ts", "lib/features/deals/types/schemas.ts", "lib/auth/permissions.ts"]
---

### [Sales] 連絡の記録に訪問・オンライン商談を足し、日時・所要時間・結果・商談を残す（#554）
- **日付**: 2026-10-25
- **決定**（結果の区分と所要時間の扱いは初期値。オーナー・営業部門の確認で変える）:
  - 連絡の種類に「訪問」「オンライン商談」を足す（`CONTACT_KINDS`）。どちらも相手につながったので、相談の連絡待ちを終わらせる（`REACHED_CONTACT_KINDS`）
  - 1タップのボタンは、電話・メール・不通の3つのまま（`QUICK_CONTACT_KINDS`）。訪問・オンライン商談と、日時・所要時間・結果・商談・メモは「活動を記録」の画面で入れる。前の「メモ付き」の吹き出しは、この画面に置き換えた。この画面では種類に既定を置かず、毎回選ばせる（記録はまだ後から直せないため。編集は #772）
  - 結果の区分は 前進・変化なし・後退。所要時間は任意で、1〜1440分。不通には、どちらも付けない（DB の CHECK も同じ）
  - 日時の既定は今。過去だけを記録でき、2000年より前と未来は拒む。画面の時計の進みを見込んで、5分先までは今として記録する。画面は日本時間で入力し、表示する
  - 商談は、同じ組織・同じリードのものだけを選べる（ほかは BAD_REQUEST）。リードの開いた商談が1つだけなら、それを初めから選んでおく。商談を消しても記録は残し、商談を空にする
  - 監査ログ（resource `lead_contact`）には、種類・日時・所要時間・結果・商談の id・メモの有無を残し、メモの本文は残さない（#435 の商談と同じ）
  - 親組織の閲覧者には、記録がどの商談のものかを見せない（活動の履歴の `deal` を空にする。商談の詳細の活動は `canReadDeals`）。リードの連絡のバーには商談を出さない
- **理由**: 訪問・オンライン商談は初回のヒアリングとしてしか残らず、過去の連絡、かかった時間、結果、どの商談の活動かが分からなかった（#554 の背景）。商談が複数あるリードでは、活動を商談に結び付けないと商談ごとの動きが追えない
- **ルール**:
  - 種類・結果を変えるときは、`lib/features/lead-follow-up/types/schemas.ts` の定数と、`lib/db/schema.ts` の `lead_contact_logs` の CHECK を一緒に変える
  - 商談を読めないのにリードを更新できる役割（#276 の営業代行のアカウント）を作るときは、`recordContact` で商談の id を拒む（今はリードを更新できる役割は、すべて商談を読める）。lead-follow-up は機能の循環に入っているので、`canReadDeals` を lead-follow-up から読むと deals も循環に入る（arch:check の features-in-cycles）。拒む判断の置き場所は、そのときに決める（この決定の paths に `lib/features/deals/access.ts` を入れ、除外する役割を足す人にフックが知らせる）
  - 「同じリードの商談だけ」は、商談のリード（`deals.lead_id`）を変えられないこと（`updateDealSchema` に leadId がない）に乗っている。商談を別のリードへ付け替える機能を作るときは、付いている記録の扱いを先に決める（`test/unit/features/lead-follow-up.test.ts` が、updateDealSchema に leadId がないことを確かめている）
  - 過去の日時を記録できるので、初回連絡（最初の記録の日時）がリードの作成より前になることがある。応答時間（#138）を出すときに扱いを決める
- **却下案**: 訪問・オンライン商談も1タップにする（日時と所要時間を入れる場面なので、画面を通す）。結果を必須にする（入力の手間で記録されなくなる）。商談を DB の外部キーで同じリードに縛る（`deals` に (id, lead_id) の一意の索引が要る。商談のリードは変えられないので、記録するときの確認とロックで足りる）
