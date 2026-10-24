---
id: 2026-10-11-ax-diagnosis-v2
date: 2026-10-11
category: Domain
title: "AX 診断 v2: 移行元ごとの設問と LP（#62）"
status: active
superseded_by: []
issues: [62]
paths: ["lib/features/diagnostics/ax-migration/definition.ts", "lib/features/diagnostics/ax-migration/evaluate.ts", "lib/features/diagnostics/ax-migration/technical.ts", "lib/features/diagnostics/ax-migration/access-support.ts", "components/features/ax-diagnosis/**"]
---

### [Domain] AX 診断 v2: 移行元ごとの設問と LP（#62）
- **日付**: 2026-10-11
- **決定**: 最初に移行元（AS/400・NEC ACOS・Access・その他）を選び、移行元ごとに設問を変える。LP `/[locale]/ax-migration` に診断を埋め込む。デザインは同社の maru2-dx.com に合わせる
- **理由**: オーナー指示（移行元ごとに必要な診断内容を聞き、回答者の負担を極力減らす）。専門家レビュー（フォーム UX、Access・AS/400・ACOS 移行、コード、セキュリティ、アクセシビリティ）を反映
- **ルール**:
  - 必須は1経路あたり約10問。数値は範囲で聞き、技術的な設問にはすべて「わからない」を置く。詳しい設問は結果のあとの任意の追加質問（`detail`）にする
  - 刷新の緊急度は「使い続けるリスク」（直せる人・保守期限・サポート終了）で測り、回答者の検討時期は入れない（検討時期はリードスコアにだけ使う）
  - ACOS は NEC が継続を表明しているため、機器契約の区切りの重みを他より小さくする。「ACOS の終了」を理由にした文言は使わない
  - Access（Office）のサポート状況は終了日から計算する。終了日の当日はサポート中とみなす
  - 選択肢を足すときは、点数表（`AX_POINT_TABLES`）に重みを書く（加点しない選択肢も 0 と明記）。テストで漏れを検出する
  - 追加質問は1回だけ、送信から24時間以内。営業が変えたリードスコアは上書きしない
- **却下案**: 検討時期を緊急度に入れる（「1年以内」と答えるほど緊急度が上がる循環になる）。追加質問を必須にする（回答者の負担が増える）
