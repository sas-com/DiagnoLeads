---
id: 2026-11-06-field-glossary-editors
date: 2026-11-06
category: Security
title: "項目の説明（項目辞書）を書き換えられるのは、運営の組織のオーナーと管理者だけにする（#800）"
status: active
superseded_by: []
issues: [800, 780]
paths: ["lib/features/field-glossary/**", "components/features/field-glossary/**", "test/unit/features/field-glossary-router.test.ts"]
---

### [Security] 項目の説明（項目辞書）を書き換えられるのは、運営の組織のオーナーと管理者だけにする（#800）
- **日付**: 2026-11-06
- **決定**: オーナーの判断（推奨案）。決定 `2026-10-26-field-glossary-site-wide` の「編集できるのは運営の編集者だけ（`content_editors` と同じ役割）」を、次のとおり具体的にする
  - 編集できるのは、運営の組織（AX 診断を受ける組織。`AX_DIAGNOSIS_ORGANIZATION_ID`、無ければ `DEFAULT_ORGANIZATION_ID`）の owner と admin だけ。判定は `canEditFieldGlossary`（`lib/features/field-glossary/editors.ts`）の1か所にし、組織の比較は `isDiagnosisOrganization` を使う（#698）
  - ほかの組織は owner・admin でも編集できない。運営の組織の member・parent_viewer・group_owner・group_admin も編集できない。運営の組織が設定されていないときは、誰も編集できない
  - 書き込めるのは、コードの一覧 `GLOSSARY_FIELDS`（`lib/features/field-glossary/types/fields.ts`）にある項目と値だけ。値の一覧は enum の定義から取り、二重に持たない。並び順は一覧の順で決め、入力では受けない
  - 編集の画面は「設定 → 項目の説明」（`/settings/field-glossary`）。読み取り（`getByKeys`）は今までどおり、ログインした人の全員
  - 一覧の最初は、#800 の優先度の高い項目（リードの状態・商談フェーズ・MQL段階・SQL判定・流入元・失注理由、商談のステージ・確度・金額・予測の区分・失注理由）の11項目。自由入力の値の候補（`label_ja`・`label_en`）は、それが要る項目を一覧に足すときに一緒に作る
- **理由**: 辞書は全組織に同じものが出るので、どの組織の管理者でも変えられると、ほかの組織の画面を書き換えられてしまう。`content_editors` は廃止が決まっていて（#339 P2・#422）、使えない。運営の組織の判定はすでに QR・代行会社のリンク・営業への通知で使っていて、新しい表も本番 DB の変更も要らない
- **却下案**:
  - 編集者を1人ずつ指名する表を作る（絞り込めるが、スキーマの変更・指名の画面・本番への適用が先に要る。今は社内の数人で、オーナーと管理者で足りる）
  - 説明文をコードに置いて画面では編集しない（利用ガイドと同じ形で画面とずれにくいが、10/26 の決定を変えることになり、オーナーは画面での編集を選んだ）
- **ルール**:
  - 書き込みの手続きは、最初に `canEditFieldGlossary(ctx.organization.id, ctx.membership.role)` を確かめる。`ctx.ability.can('update', 'Settings')` で代えない（group_admin なども通ってしまう）
  - 項目を足すときは `GLOSSARY_FIELDS` に足し、`fieldGlossary.fields.<id>` の名前を ja・en の両方に置く（`test/unit/features/field-glossary-fields.test.ts` が検査する）
  - 説明文に社外秘（取引先名・単価など）と組織ごとの手順を書かない（全組織に出るため。組織ごとの手順は営業の手引きに置く）
- **関連**: Epic #780、決定 `2026-10-26-field-glossary-site-wide`・`2026-10-23-cms-studio`・`2026-10-28-in-app-help`
