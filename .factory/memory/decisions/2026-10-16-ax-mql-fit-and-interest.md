---
id: 2026-10-16-ax-mql-fit-and-interest
date: 2026-10-16
category: Domain
title: "AX 診断の MQL を「適合」と「関心あり」に分ける（#139）"
status: active
superseded_by: []
issues: [139]
paths: ["lib/features/diagnostics/ax-migration/mql.ts", "lib/features/diagnostics/ax-migration/config.ts", "lib/features/leads/mql-level.ts"]
---

### [Domain] AX 診断の MQL を「適合」と「関心あり」に分ける（#139）
- **日付**: 2026-10-16
- **決定**: 業種×システム（必須条件）を満たすだけなら「適合」。それに加えて強いシグナル（相談申込／保守期限・サポート終了が過ぎている・1年以内／決裁に関わる立場／切り替え時期が1年以内）のどれか、または最低スコア以上なら「関心あり（MQL）」。MQL 判定日（`mql_qualified_at`）を付けるのは「関心あり」だけ。2026-10-09 の「Web診断の完了を MQL の行動に数える」は廃止（`countWebDiagnosisAsMqlAction=false`。true で旧ルールに戻せる）
- **理由**: 対象の業種・システムの人は診断を終えただけで全員 MQL になり、営業が優先順位を付けられなかった（営業戦略レビュー、オーナー判断）
- **ルール**:
  - 条件は `lib/features/diagnostics/ax-migration/config.ts` の `mql` に1か所で持つ（管理画面はまだない。具体的な値は営業と決める＝要確認）。言葉は診断ビルダーの MQL ルール（必須条件・強いシグナル・最低スコア）にそろえる
  - 判定と理由はリードの `responses.axMigration.mql`（level / signals / unmet）と診断結果（`diagnostic_submissions.result.mql`）に保存する。DB の列は増やさない
  - 後からの相談申込・別システムの診断でレベルは上がるだけ（下がらない）。判定日は未設定のときだけ付け、マーケが付けた日は変えない。追加の質問への回答ではリードの判定を変えない
  - 既存のリードは書き換えない（再判定しない）。旧ルールで付いた MQL 判定日はそのまま残り、画面では「適合（2026年10月16日より前の判定）」と出る。ダッシュボードの MQL 件数は判定日で数えるので、切り替え前の期間には旧ルールの件数が含まれる
  - ダッシュボードの MQL は「関心あり」だけ。「適合のみ」は期間中に作られたリードの件数を別の行で出す
- **却下案**: 既存リードの一括再判定（回答から再計算はできるが、営業・マーケが手で付けた判定と区別できず、過去の件数が変わる）
