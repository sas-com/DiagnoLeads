---
id: 2026-10-26-sql-before-leaving-qualification
date: 2026-10-26
category: Sales
title: "商談を見極めから先へ動かす前に、画面で SQL判定を聞く。API は拒まず警告だけ返す（#801）"
status: active
superseded_by: []
issues: [801, 430, 444]
paths: ["components/features/deals/use-stage-move.tsx", "components/features/deals/sql-decision-dialog.tsx", "lib/features/deals/types/pipeline.ts", "lib/features/deals/service.ts", "lib/features/deals/api/router.ts"]
---

### [Sales] 商談を見極めから先へ動かす前に、画面で SQL判定を聞く。API は拒まず警告だけ返す（#801）
- **日付**: 2026-10-26
- **決定**: オーナーが #801 の推奨案で承認（2026-10-26）
  - 商談を見極めから先（課題の確認・提案・条件の調整・受注）へ動かすとき、リードの SQL判定が未判定なら、ボードと商談の画面で判定を聞く。判定は `skipsSqlDecision`（`lib/features/deals/types/pipeline.ts`）で決める。失注にするときは聞かない
  - 「適格」はその移動と一緒に `deals.update` の `sqlDecision` で送り、同じトランザクションでリードに記録する（リードの監査ログと Webhook も同じ1回）。受注へ動かすときは、適格の後に受注のダイアログに進む
  - 「不適格」は失注のダイアログに進み、失注と一緒に `sqlDecision: 'not_qualified'` を送る。取り消すと動かさない
  - API は拒まない（取り込み・連携・過去のデータを止めない）。未判定のまま見極めから出たときは、応答の `sqlUndecided` を真にする（`handedOff` と並べる。決定 `2026-10-26-deal-move-undo`）
  - 「元に戻す」はステージと確度だけを戻し、記録した SQL判定は戻さない。判定は初回ヒアリングの結果で、移動はその後に来るため
- **理由**: SQL判定の記録が漏れると、獲得元・代行会社別の SQL 数が少なく出る（`lib/features/analytics/lead-sources.ts`、`lib/features/agency-contracts/report.ts`）。SQL判定は見極めの出口（決定 `2026-10-25-lead-lifecycle`）
- **ルール**:
  - 商談を最初から見極めより先のステージで作るときは聞かない（見極めから動かす操作ではないため。過去の商談の登録に使う）。見極めから動かす別の入口を足すときは、`skipsSqlDecision` で同じように聞く
  - `deals.update` の `sqlDecision` は、未判定のリードにだけ記録する（ロックした後に読んだ値で比べる）。古いボードから聞いた判定で、その間に入った判定を書き換えない
  - 不適格はリードの判定なので、同じリードにほかの開いた商談があっても、リードは不適格になる
  - 失注から開き直す移動は見極めから出る移動ではないので、聞かない（`sqlUndecided` も偽）。この道筋で漏れが目立てば、開き直しでも聞くかを決め直す
  - 商談を持つリードの SQL判定は、リードの画面でも今までどおり変えられる（状態と商談フェーズと違い、商談から計算しない）
- **却下案**: API でも拒む（過去のデータや連携で止まる）／何もしない（SQL 数のずれが続く）／判定を `leads.update` で別に送る（移動と別のトランザクションになり、片方だけ残る）
