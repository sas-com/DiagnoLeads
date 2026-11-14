---
id: 2026-11-14-prep-card-save-precondition
date: 2026-11-14
category: API
title: "事前調査カードの保存は、読んだときの更新日時が今も同じときだけ受ける（ほかの人が先に保存していたら断る）。空のカードは「無い」と同じに出す（#1222・#1225）"
status: active
superseded_by: []
issues: [1222, 1225, 1221, 1212]
paths: ["lib/features/lead-prep/service.ts", "lib/features/lead-prep/types/schemas.ts", "lib/features/lead-prep/api/router.ts", "components/features/lead-prep/lead-prep-card.tsx", "components/features/ai-employees/office-prep-file.tsx"]
---

### [API] 事前調査カードの保存は、読んだときの更新日時が今も同じときだけ受ける（ほかの人が先に保存していたら断る）。空のカードは「無い」と同じに出す（#1222・#1225）
- **日付**: 2026-11-14
- **きっかけ**: `leadPrep.save` はカードを丸ごと置き換え、前提条件を取らなかった。開発室の準備ファイルに下書きと取り消しを足した（#1212）ことで、書き手が「営業がリードの画面で数分かけて編集する」と「社長が開発室で1回の押下で保存する」の2つになり、あとから保存したほうが先の人の記入を黙って消す場面が現実になった（#1221 のレビュー）。#1222 で `architecture-specialist` に読み取り専用で調べてもらった
- **決定**（オーナーの判断。2026-11-14、3点とも選択肢から選んでもらった。どれも推奨どおり）:
  1. 保存に前提条件を**足す**（却下：足さず、営業の手引きと同じ「既知の限界」として記録する）
  2. リードの画面で断られたときは、**知らせと「読み直す」**を出す。ヒアリングの画面と同じ形（却下：トーストだけ）
  3. 空のカードは、**画面で「無い」と同じに出す**。API は足さない（却下：行を消す API を足す／今のまま）
- **形**（ヒアリングの保存 `updateLeadHearing` と同じ型）:
  - 入力に `expectedUpdatedAt: z.date().nullable()`（キーは必須）。`null` は「カードが無いと読んだ」
  - 比べるのは、書き込む1文の中：日時なら `update … where lead_id and organization_id and updated_at = expected`、`null` なら `insert … on conflict (lead_id) do nothing`。0行なら `CONFLICT`。2人が同時に最初の保存をしても、一意索引 `lead_prep_cards_lead_unique` で後の人は断られる
  - 新しい `updatedAt` は `max(now, expected + 1ms)`。時計が進んでいなくても必ず進め、古いトークンが二度と一致しないようにする。保存は新しい `updatedAt` を返す
  - ルーターは、項目を名前で service に渡す（決定 `2026-11-08-keep-organization-input-passthrough`）
  - スキーマの変更は無い。`updated_at` は JS の Date（ミリ秒）でだけ書く。DB の `now()`（マイクロ秒）で書くと、その行は断られ続ける（`lib/db/schema.ts` にコメント）
- **画面**:
  - リードの画面：トークンは、編集を始めたときのカードの `updatedAt`。保存のときに問い合わせの結果から取らない（編集の途中で読み直されると、トークンが黙って新しくなり、守りが効かない）。断られたら、入力を残して知らせ、「最新の内容を読み込む」で最新のカードから詰め直す（入力は消える）。上書きして保存する手段は無い
  - 開発室：実行の直前に読み直したカードの `updatedAt` を送る。空のカードを「無い」に畳む前の、行そのものの値を使う
  - 空のカード（全部の項目が空の行。開発室で、カードが無かったお客様の下書きを取り消すと残る）は、どちらの画面でも「無い」と同じに出す（`lib/features/lead-prep/draft.ts` の `prepCardFilled`）。前提条件のトークンには、空でも行の `updatedAt` を使う
- **理由**:
  - 既存の型をなぞれば小さく済む。AIエンジニアが下書きを用意する仕事（#1110）で、書き手はさらに増える
  - 項目を任意にすると、前提条件なしで置き換える経路が残り続ける。必須にして、古い画面（デプロイの直後に開いたままのタブ）の保存は BAD_REQUEST にする（入力は消えない。ヒアリング・診断ビルダーと同じ扱い）
  - 行を消す API は、新しい手続きになる（組織の分離の実 DB テストが要る。決定 `2026-11-14-engineering-room` の「API は足さない」にも触れる）。見え方を直すだけなら、画面の判定で足りる
- **範囲外**: 営業の手引きなど、ほかの「丸ごと置き換える」保存は、今のまま（決定 `2026-10-15-sales-playbook-in-db` の既知の限界）。そろえるなら別の Issue
- **ルール**:
  - 事前調査カードを保存する画面・仕事を足すときは、読んだときの `updatedAt` を必ず付ける。付ける値は、保存の直前ではなく「元にしたカードを読んだとき」のもの
  - `lead_prep_cards.updated_at` を SQL の `now()` や `defaultNow()` で書く経路を足さない
