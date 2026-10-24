---
id: 2026-10-24-column-sources
date: 2026-10-24
category: Marketing
title: "コラムの出典は公式の一次情報に限る。PHP の脆弱性の記事は PHP の開発元と IPA（#465）"
status: active
superseded_by: []
issues: [465, 324]
paths: ["lib/features/ax-site/columns/*.ts", "test/unit/features/ax-site-columns.test.ts"]
---

### [Marketing] コラムの出典は公式の一次情報に限る。PHP の脆弱性の記事は PHP の開発元と IPA（#465）
- **日付**: 2026-10-24
- **決定（オーナーの指示「コラムを Issue にして進めてよい」を受けて Claude が決めた。違えば #465 で知らせてもらう）**:
  - コラムの事実は、その製品の開発元の公式ページから取る。Access の記事は Microsoft（learn・support.microsoft.com）のまま
  - PHP の脆弱性「PHP2shell」の記事（`access-web-security`）だけは、PHP の開発元（www.php.net）と IPA（www.ipa.go.jp）を出典にする
  - #324 の守る線は変えない。他社の文・見出しを使わない、金額・事例・攻撃の統計を書かない、「Web 化すれば安全」と書かない。「攻撃」「サイバー」などの禁止語と、「安全」を含む文の決まり（`test/unit/features/ax-migration-claims.test.ts`）もそのまま
- **理由**: 出典を Microsoft に限る決まりは、Access の記事の一次情報を求めたもの（#324 の1本目は Microsoft の公式ページが出典）。PHP の脆弱性の一次情報は PHP の開発元の告知で、日本の公的な注意喚起は IPA が出している。セキュリティ企業の解説は、他社の文を使わない線と、情報の食い違い（悪用の状況など）があるため使わない
- **却下案**: セキュリティ企業や報道の記事を出典にする（他社の文に頼ることになり、内容が食い違うことがある）。記事ごとの許可をやめて出典を自由にする（一次情報の決まりが崩れる）
- **ルール**: 新しい出典の種類を足すときは、`test/unit/features/ax-site-columns.test.ts` の `SOURCE_HOSTS` に記事ごとに足し、理由を PR に書く
