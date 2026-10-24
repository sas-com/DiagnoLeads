# DiagnoLeads：AI エージェント向けの入口

このリポジトリのルールは [CLAUDE.md](./CLAUDE.md) にまとめてある。Claude Code 以外のエージェント（Factory Droid など）も、作業の前に全文を読んで従うこと。

- MemoryBank（決定・違反・学び・オーナーの好み）は `.factory/memory/` にある。決定の索引は `bun run memory:index` で出し、作業に関係する決定の本文を読んでから進める
- Claude Code ではフックが機械的に止めていること（bun.lock と `.env*` の編集、`.env*` の読み取り、共有キャッシュとつながった node_modules への書き込み、秘密情報の書き込み）も、ほかのエージェントでは止まらない。CLAUDE.md の「毎回守ること」を自分で守る
- ディレクトリごとの決まり（`.claude/rules/`）と手順（`.claude/skills/`）も、該当する作業の前に読む
