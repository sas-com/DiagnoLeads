# DiagnoLeads：AI エージェント向けの入口

このリポジトリのルールは [CLAUDE.md](./CLAUDE.md) にまとめてある。Claude Code 以外のエージェント（Factory Droid など）も、作業の前に全文を読んで従うこと。

- MemoryBank（決定・違反・学び・オーナーの好み）は `.factory/memory/` にある。決定の索引は `bun run memory:index` で出し、作業に関係する決定の本文を読んでから進める
- Claude Code ではフックが機械的に止めていること（bun.lock と `.env*` の編集、`.env*` の読み取り、共有キャッシュとつながった node_modules への書き込み、秘密情報の書き込み）も、ほかのエージェントでは止まらない。CLAUDE.md の「毎回守ること」を自分で守る
- ディレクトリごとの決まり（`.claude/rules/`）と手順（`.claude/skills/`）も、該当する作業の前に読む
- 下の英語のブロックは `next dev` が管理している（AI エージェントを検知すると、無ければ書き足す）。消さずにコミットしておく。Next.js を上げてブロックが変わったら、`next dev` が書き換えた内容をそのままコミットする

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
