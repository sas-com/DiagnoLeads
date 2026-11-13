---
id: 2026-11-12-memory-ace-grow-and-refine
date: 2026-11-12
category: Process
title: "MemoryBank の学びは差分で足し、効いた・外れたを記録して、月1回の見直しで整理する（ACE の grow-and-refine、#1094）"
status: active
superseded_by: []
issues: [1094]
paths: [".claude/skills/record-decision/SKILL.md", ".claude/skills/ship/SKILL.md"]
---

### [Process] MemoryBank の学びは差分で足し、効いた・外れたを記録して、月1回の見直しで整理する（ACE の grow-and-refine、#1094）
- **日付**: 2026-11-12
- **決定**: ACE（Agentic Context Engineering）の考え方を、`learnings.md` の運用に入れる（オーナーの依頼「以下を取り込んでください」と、取り込み方の選択「MemoryBank の運用に反映」）
  - 振り返り（ACE の Reflector）：PR のレビューの指摘・CI の失敗・手戻り・オーナーの訂正から、次の作業でも使える教訓を取り出す
  - 同じ学びかの判定：読む人が取る行動が既存の項目と同じなら同じ学びとし、新しく足さない。固有の名前を外して書けるときは1段だけ一般化してから比べる
  - 差分で足す（Curator の delta update）：項目を1つ足すか、同じ学びの項目に追記する。ファイル全体や節をまとめて書き直さない。短く言い直さない
  - 評価（helpful / harmful のカウンタ）：学びに従って作業したら、PR の本文の「役立った学び」か「外れた学び」に見出しを書く。`learnings.md` の「評価」の数は、月1回の見直しでマージ済みの PR の本文から数えて増やす
  - 整理（refine）：月1回の見直しで、候補（重複・外れた方が多い・今のコードと合わない・「効いた」が3以上で機械で判定できる）をファイルを変えずに出し、オーナーが承認した分だけ PR で適用する。機械で判定できる学びは Issue にしてフックかテストに移す。評価の数は、まとめるときの足し合わせのほかは減らさない（→ [2026-11-12-memory-review-monthly-issue](./2026-11-12-memory-review-monthly-issue.md) で変更：フックかテストに移す候補は「機械で判定でき、同じ学びへの追記か再発が2回以上」。見直しは毎月 Actions が開く Issue から始める）
  - 同じ学びかの判定・PR の本文での記録・承認してから整理する手順・3回の基準は、feel-flow/ff-dev-toolkit（Apache-2.0）の `ace-curate`・`ace-refine`・`retrospective` を参考にした。プラグインは入れない
- **理由**:
  - ACE の論文は、毎回コンテキスト全体を LLM に書き直させると短く情報の乏しい要約に潰れる「コンテキスト崩壊」と、短く汎用的な文に寄る「brevity bias」を挙げ、カウンタ付きの差分更新と、重複の除去・剪定（grow-and-refine）で避けている
  - `learnings.md` は482行あり、「重複をまとめる」見直しだけでは、どの学びが今も効くのかを判断する材料がなかった
  - 学びの質は振り返りとフィードバックの質に依存する（論文も限界として挙げている）。誤った学びが残らないよう、整理はオーナーが承認してから適用する
  - 評価の数を作業の PR で増やすと、並行する PR が `learnings.md` の同じ行を変えて衝突する。PR の本文に書いておけば、月1回まとめて数えられる。書き忘れても、PR を作る手順（スキル `ship`）で気づける
- **ルール**:
  - 手順はスキル `record-decision` の「学び」、置き場所と見直しは `.factory/memory/README.md`
  - 既存の学びに評価を付け直す作業はしない。使ったときに付ける
  - 顧客固有の情報・社外秘・秘密情報は、教訓にも書かない（リポジトリは公開）
- **却下案**:
  - 論文の実装（ace-agent/ace）をそのまま入れ、LLM に自動で学びを更新させる：誤った学びが人の確認なしに入り、公開リポジトリに社外秘が混ざるおそれがある
  - 学びを1件1ファイルに分ける（決定と同じ形）：今の量では索引とフックを作る費用に見合わない。肥大化したら改めて考える
  - ff-dev-toolkit をプラグインとして入れる：セッション開始のたびに外部のコードが自動で更新される（公開リポジトリで本番に自動デプロイするため、外部コード経由の攻撃の入口になる）。約25本のフックが `.claude/hooks/` と重なり、`docs/08-knowledge/` の構成も MemoryBank と合わない
  - 作業の PR で評価の数を直接増やす：並行する PR が同じ行で衝突する
- **出典**（参照日：2026-11-12）：Zhang et al. "Agentic Context Engineering: Evolving Contexts for Self-Improving Language Models"（ICLR 2026）https://arxiv.org/abs/2510.04618 ・ 公式実装 https://github.com/ace-agent/ace ・ feel-flow/ff-dev-toolkit https://github.com/feel-flow/ff-dev-toolkit （コミット 15c78c5、v1.2.0）
