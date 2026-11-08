// @vitest-environment node
/**
 * The reminder to claim an issue after creating a work branch (.claude/hooks/lib/branch-claim.ts,
 * #886): which commands create a work branch, and when the claim went with the same command.
 */
import {
  claimReminder,
  createdWorkBranches,
  postsIssueComment,
} from '@/.claude/hooks/lib/branch-claim';
import { describe, expect, it } from 'vitest';

describe('createdWorkBranches', () => {
  it.each([
    ['git checkout -b feat/886-branch-claim-hook origin/main', 'feat/886-branch-claim-hook', '886'],
    ['git checkout -q -b docs/883-webhook-replay origin/main', 'docs/883-webhook-replay', '883'],
    ['git checkout -B fix/12-x', 'fix/12-x', '12'],
    ['git switch -c test/7-more-cases', 'test/7-more-cases', '7'],
    ['git switch --create chore/40-tidy main', 'chore/40-tidy', '40'],
    ['git worktree add ../wt -b perf/433-leads-indexes origin/main', 'perf/433-leads-indexes', '433'],
    ['git -C /repo checkout -b db/702-qr-scans-stage1', 'db/702-qr-scans-stage1', '702'],
    ['cd /repo && git fetch -q origin main && git checkout -q -b feat/1-a origin/main', 'feat/1-a', '1'],
    ["git checkout -b 'feat/9-quoted'", 'feat/9-quoted', '9'],
  ])('%s creates %s for #%s', (command, branch, issue) => {
    expect(createdWorkBranches(command)).toEqual([{ branch, issue }]);
  });

  it('ignores commands written inside a here-document', () => {
    const command = [
      "cat > notes.md <<'EOF'",
      'git checkout -b feat/1-in-a-file',
      'EOF',
      'git checkout -b feat/2-real',
    ].join('\n');
    expect(createdWorkBranches(command)).toEqual([{ branch: 'feat/2-real', issue: '2' }]);
  });

  it('ignores git checkout -b written inside quotes', () => {
    expect(createdWorkBranches('git commit -m "memo; git checkout -b feat/1-x"')).toEqual([]);
  });

  it('takes no time over a long unterminated here-document', () => {
    const started = performance.now();
    expect(createdWorkBranches(`git status <<A\n${' '.repeat(50_000)}\n`)).toEqual([]);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it.each([
    'git checkout main',
    'git checkout feat/886-branch-claim-hook',
    'git switch feat/886-branch-claim-hook',
    'git checkout -b scratch',
    'git checkout -b feat/no-issue',
    'git branch feat/886-x',
    'echo git checkout -b',
    'git log --oneline -1',
    'git worktree list',
    `git checkout -b feat/${'9'.repeat(21)}-too-long-a-number`,
  ])('%s creates no work branch', (command) => {
    expect(createdWorkBranches(command)).toEqual([]);
  });
});

describe('postsIssueComment', () => {
  it.each([
    'gh api repos/o/r/issues/886/comments -X POST -f body="着手しました"',
    'gh api repos/o/r/issues/886/comments -F body=@claim.md',
    'gh api --method POST repos/o/r/issues/886/comments --input claim.json',
    'gh issue comment 886 --body "着手しました"',
  ])('finds the claim in %s', (command) => {
    expect(postsIssueComment(command, '886')).toBe(true);
  });

  it.each([
    'gh api repos/o/r/issues/886/comments --jq ".[].body"',
    'gh api repos/o/r/issues/8860/comments -X POST -f body=x',
    'gh api repos/o/r/issues/88/comments -X POST -f body=x',
    'gh issue comment 8860 --body x',
  ])('finds no claim on #886 in %s', (command) => {
    expect(postsIssueComment(command, '886')).toBe(false);
  });
});

describe('claimReminder', () => {
  it('names the issue and what to write', () => {
    const reminder = claimReminder('git checkout -b feat/886-branch-claim-hook origin/main');
    expect(reminder).toContain('Issue #886');
    expect(reminder).toContain('feat/886-branch-claim-hook');
    expect(reminder).toContain('最新のコメント');
    expect(reminder).toContain('参照する PR');
  });

  it('stays quiet when the claim went with the branch', () => {
    expect(
      claimReminder(
        'git checkout -q -b feat/886-a origin/main && gh api repos/o/r/issues/886/comments -X POST -f body="着手しました"'
      )
    ).toBeNull();
  });

  it('stays quiet without a work branch', () => {
    expect(claimReminder('git status --short')).toBeNull();
  });
});
