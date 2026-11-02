---
id: 2026-11-01-ui-audit-skill
date: 2026-11-01
category: UI
title: "画面の「AI らしさ」の点検は、unslop を DADS 優先で書き直したスキル ui-audit で行う（#910）"
status: active
superseded_by: []
issues: [910, 423]
paths: [".claude/skills/ui-audit/**"]
---

### [UI] 画面の「AI らしさ」の点検は、unslop を DADS 優先で書き直したスキル ui-audit で行う（#910）
- **日付**: 2026-11-01
- **決定**（オーナー判断。採用の検討で示した案2を選んだ）:
  - 外部のスキル unslop（heydamir/unslop、commit `a6f121e`、CC BY 4.0）をそのままは入れず、考え方と兆候の一覧を日本語に訳して、プロジェクトのスキル `.claude/skills/ui-audit/` にする
  - DADS（[2026-10-24-admin-dads](./2026-10-24-admin-dads.md)）と既存の決定（グラフ・AX サイトの書体・部品・locales・ヘルプ）が、unslop の決まりより先に立つ
  - 取り込まないもの：書体の変更、太さの上限 600、独自の色のランプ、画像の生成、動画（story）、ライブサイトの取り込みのスクリプト
- **理由**: unslop の「色を注目させたい所だけに置く」「挨拶の見出しを期間にする」などの観点は管理画面に効く。一方、そのままでは太字 700・本文 16px・Green と Solid Gray・フォントの決定とぶつかり、自動で呼ばれると DADS の値を崩す変更が出る
- **却下案**:
  - そのまま `.claude/skills/unslop/` に入れる：DADS とぶつかる。Playwright と ffmpeg の手順は npm 前提で、Bun の決まりとも合わない
  - 個人の環境（`~/.claude/skills/`）だけで使う：ほかの端末とクラウドのセッションで使えず、DADS との優先順位も伝わらない
- **ルール**:
  - CC BY 4.0 の表記（作者・元のリポジトリと SHA・ライセンス・変更点）を `SKILL.md` と `references/signs.md` に残す。消さない
  - unslop の更新を取り込むときは、SHA を新しくし、DADS とぶつかる所を同じように直す
  - スキルは点検の結果と注目させる所を見せてから編集する（「そのまま直して」と言われたときを除く）
- **参照**: https://github.com/heydamir/unslop 、https://code.claude.com/docs/en/skills
