---
id: 2026-11-12-memory-ace-grow-and-refine
date: 2026-11-12
category: Process
title: "MemoryBank の学びは差分で足し、効いた・外れたを記録して、月1回の見直しで整理する（ACE の grow-and-refine、#1094）"
status: active
superseded_by: []
issues: [1094]
paths: [".factory/memory/learnings.md", ".factory/memory/README.md", ".claude/skills/record-decision/SKILL.md"]
---

### [Process] MemoryBank の学びは差分で足し、効いた・外れたを記録して、月1回の見直しで整理する（ACE の grow-and-refine、#1094）
- **日付**: 2026-11-12
- **決定**: ACE（Agentic Context Engineering）の考え方を、`learnings.md` の運用に入れる（オーナーの依頼「以下を取り込んでください」と、取り込み方の選択「MemoryBank の運用に反映」）
  - 振り返り（ACE の Reflector）：PR のレビューの指摘・CI の失敗・手戻り・オーナーの訂正から、次の作業でも使える教訓を取り出す
  - 差分で足す（Curator の delta update）：項目を1つ足すか、同じ学びの項目に追記する。ファイル全体や節をまとめて書き直さない。短く言い直さない
  - 評価（helpful / harmful のカウンタ）：学びに従って作業したら、項目の「評価」の「効いた」か「外れた」を1つ増やす。外れたときは理由と Issue・PR の番号を添える
  - 整理（refine）：月1回の見直しで、重複をまとめ、「外れた」が多い学びと今のコードと合わない学びを直すか消す。人が PR で確かめる。繰り返し効いていて機械で判定できる学びは、フックかテストに移す
- **理由**:
  - ACE の論文は、毎回コンテキスト全体を LLM に書き直させると短く情報の乏しい要約に潰れる「コンテキスト崩壊」と、短く汎用的な文に寄る「brevity bias」を挙げ、カウンタ付きの差分更新と、重複の除去・剪定（grow-and-refine）で避けている
  - `learnings.md` は482行あり、「重複をまとめる」見直しだけでは、どの学びが今も効くのかを判断する材料がなかった
  - 学びの質は振り返りとフィードバックの質に依存する（論文も限界として挙げている）。誤った学びが残らないよう、整理は人が PR で確かめる
- **ルール**:
  - 手順はスキル `record-decision` の「学び」、置き場所と見直しは `.factory/memory/README.md`
  - 既存の学びに評価を付け直す作業はしない。使ったときに付ける
  - 顧客固有の情報・社外秘・秘密情報は、教訓にも書かない（リポジトリは公開）
- **却下案**:
  - 論文の実装（ace-agent/ace）をそのまま入れ、LLM に自動で学びを更新させる：誤った学びが人の確認なしに入り、公開リポジトリに社外秘が混ざるおそれがある
  - 学びを1件1ファイルに分ける（決定と同じ形）：今の量では索引とフックを作る費用に見合わない。肥大化したら改めて考える
- **出典**（参照日：2026-11-12）：Zhang et al. "Agentic Context Engineering: Evolving Contexts for Self-Improving Language Models"（ICLR 2026）https://arxiv.org/abs/2510.04618 ・ 公式実装 https://github.com/ace-agent/ace
