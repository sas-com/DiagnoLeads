---
name: official-check
description: Anthropic の公式ドキュメントで、Claude Code の設定（CLAUDE.md、.claude/ の設定・フック・スキル・エージェント・ルール、MemoryBank の仕組み）と Claude API（モデル ID・SDK・パラメータ）の今の仕様を確かめる手順。それらを変える前、書き方が公式と合っているか分からないとき、月1回の見直しで使う
---

# official-check：Anthropic の公式で確かめる

記憶（モデルの知識）で書かない。Claude Code と Claude API は月単位で変わり、モデルの知識より新しいことがある（決定 `2026-10-24-official-docs-check`）。

## 手順

1. 変えるものから、読むページを決める（下の表）。表に無ければ索引から探す
2. ページを読む。WebFetch で URL の末尾に `.md` を付けると本文だけが取れる。Claude Code の機能の質問は `claude-code-guide` エージェント、Claude API は `claude-api` スキルにも聞ける（どちらも公式を読んで答える）
3. 今のリポジトリと比べ、食い違い・非推奨・新しくできた仕組みを書き出す
4. 直す。決定と食い違うときは、決定を置き換える（スキル `record-decision`）
5. PR の本文に「確かめた公式ドキュメント」として、URL と確かめた点を書く

公式ではないもの（ブログ・解説記事・ほかのリポジトリの設定）は参考にとどめ、仕様の根拠にしない。

## ページ

| 変えるもの | ページ |
|---|---|
| 索引（Claude Code） | https://code.claude.com/docs/llms.txt ・ https://code.claude.com/docs/en/claude_code_docs_map.md |
| CLAUDE.md・`.claude/rules/` | https://code.claude.com/docs/en/memory |
| `.claude/settings.json` | https://code.claude.com/docs/en/settings |
| 権限（allow・ask・deny） | https://code.claude.com/docs/en/permissions |
| フック | https://code.claude.com/docs/en/hooks |
| スキル | https://code.claude.com/docs/en/skills |
| エージェント | https://code.claude.com/docs/en/sub-agents |
| クラウドのセッション | https://code.claude.com/docs/en/claude-code-on-the-web |
| 進め方全般 | https://code.claude.com/docs/en/best-practices |
| Claude Code の変更履歴 | https://code.claude.com/docs/en/changelog |
| 索引（Claude API） | https://platform.claude.com/llms.txt |
| モデルの一覧と ID | https://platform.claude.com/docs/en/models/overview |
| モデルの提供終了 | https://platform.claude.com/docs/en/about-claude/model-deprecations |
| Claude API の変更履歴 | https://platform.claude.com/docs/en/release-notes/overview |

## 月1回の見直し

1. Claude Code の変更履歴で、前回の見直しから変わった設定・フック・スキル・エージェントの仕様を探し、`.claude/` と CLAUDE.md に効くものを書き出す
2. モデルの提供終了の予定と、コードのモデル ID を突き合わせる：`grep -rn "claude-" lib/features/ai`
3. 監査を流す（どちらも報告と修正案を出すだけで、頼むまでファイルは変わらない）
   - `/doctor prompt-audit`：CLAUDE.md・AGENTS.md と `.claude/` のルール・スキル・エージェントの、古いモデル向けの書き方・存在しないパスやコマンド・矛盾。MemoryBank は既定の対象外なので `/doctor prompt-audit .factory/memory` のようにパスを渡す（v2.1.283 以降）
   - `/claude-api prompt-audit`：Claude API のプロンプトとツールの説明（#442 の提供終了したモデルはこれで見つかった）
4. 直すことがあれば Issue にする（`area: ai` か、Claude の仕組みなら Epic #426 の流れ）
