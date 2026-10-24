---
id: 2026-10-21-access-mql-and-lp
date: 2026-10-21
category: Assessments
title: "Access の案件の受け方・MQL・経路別 LP（#292, #288, #158）"
status: active
superseded_by: []
issues: [292, 288, 158]
paths: ["lib/features/diagnostics/ax-migration/config.ts", "lib/features/diagnostics/ax-migration/mql.ts", "lib/features/diagnostics/ax-migration/access-path.ts"]
---

### [Assessments] Access の案件の受け方・MQL・経路別 LP（#292, #288, #158）
- **日付**: 2026-10-21
- **決定（オーナー）**:
  - **Access の案件**: 大企業の1部署を含めて何でも受ける。相談はマーケティングが受け、難しいものはエンジニア部門が同席する。「直して使い続ける」（64bit 対応など）も自社で受ける
  - **MQL**: Access の経路では必須条件の「業種」「企業規模」を問わない（「システム」は今までどおり）。相談を勧めるか（`recommendation`）も同じ扱い。Access のサポート終了（終了済み／1年以内）は、次のどれかと重なったときだけ強いシグナルにする: 止まったときの影響が「部署の主要な業務」または「全社・取引先・お客様」／利用人数が11人以上／基幹システムや SQL Server など Access の外のデータを直接読み書きしている（`access_features` の external_data、または `access_location` がデータベース）。ホストの保守期限（supportEnd）は変えない
  - **経路別 LP**: ホスト専用の LP は当面作らない。共通 LP に AS/400 と ACOS の見出しを足し、専用ページは11月の検索データを見て決める。Access の LP は11月上旬に出す。見出しは「その Access、直して使うか、Web に移すか。」、診断名は「無料Web診断（Access版）」。設問は足さず、`access_challenges` の中から主なものを選んでもらう。おすすめの道と入口の LP を保存する。警察の統計は原典で確かめるまで使わない
- **理由**: 2026-10-13 以降、Access 2016・2019・2021 の買い切り版はすべてサポート終了と判定され、サポート終了だけでは Access の回答のほとんどが「関心あり（MQL）」になり、連絡の優先度の差が出なかった（事業・営業・マーケティングのレビュー）
- **ルール**:
  - 値は `lib/features/diagnostics/ax-migration/config.ts` の `mql.anyIndustryPlatforms` / `mql.anySizePlatforms` / `mql.strongSignals.accessSupportWith` に置き、営業と見直すときはそこを変える
  - 判定結果の `criteria` は回答のまま（業種・企業規模が対象外ならそのまま残す）。経路で問わない条件は `waived` に入れ、満たしたものとして扱い、`unmet` には出さない。営業通知とリードの活動カードは `waived` を見て「この経路では問わない」と扱う
  - 影響・人数・データの置き場所は結果のあとに聞く詳細設問なので、詳細設問の回答でもリードの MQL を上げる（下げはしない。別システムの診断と同じ）
