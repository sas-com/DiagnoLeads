/**
 * The reminder to claim an issue when a work branch is created (#886). CLAUDE.md asks a session
 * to tell the others what it took (a comment on the issue, after reading its latest comments and
 * looking for pull requests on it) before working; on #874 to #876 the claim was skipped or came
 * after the work (violations.md). The post tool hook names the issue right after
 * `git checkout -b <type>/<issue>-<description>` succeeds, unless the same command posted the
 * claim already.
 */

import { splitShell } from './guard';

/** Work branches as CLAUDE.md names them: <type>/<issue>-<description> */
const WORK_BRANCH = /^[a-z]+\/(\d{1,7})-[A-Za-z0-9._-]{1,80}$/;

/** Options of each git subcommand that take the name of the branch to create */
const CREATE_OPTIONS: Readonly<Record<string, readonly string[]>> = {
  checkout: ['-b', '-B'],
  switch: ['-c', '-C', '--create', '--force-create'],
  worktree: ['-b', '-B'],
};

/** The branch one simple command creates, or undefined (words as splitShell gives them) */
function createdBranch(words: string[]): string | undefined {
  let at = words.indexOf('git');
  if (at < 0) return undefined;
  at += 1;
  while (words[at] === '-C' || words[at] === '-c') at += 2; // git -C <dir>, git -c <key=value>
  const subcommand = words[at];
  const options = subcommand ? CREATE_OPTIONS[subcommand] : undefined;
  if (!options) return undefined;
  if (subcommand === 'worktree' && words[at + 1] !== 'add') return undefined;
  const rest = words.slice(at + 1);
  const option = rest.findIndex((word) => options.includes(word));
  return option < 0 ? undefined : rest[option + 1];
}

/**
 * The work branches a command line creates, with their issue numbers. splitShell honours quotes
 * and skips here-document bodies, so a commit message or a file written with cat <<EOF that
 * mentions git checkout -b is not taken for a command (and its scan is linear in the length).
 */
export function createdWorkBranches(command: string): { branch: string; issue: string }[] {
  const found: { branch: string; issue: string }[] = [];
  for (const words of splitShell(command)) {
    const branch = createdBranch(words);
    const issue = branch ? WORK_BRANCH.exec(branch)?.[1] : undefined;
    if (branch && issue) found.push({ branch, issue });
  }
  return found;
}

/** Whether the command line also posts a comment on the issue (the claim went with the branch) */
export function postsIssueComment(command: string, issue: string): boolean {
  if (new RegExp(`\\bgh\\s+issue\\s+comment\\s+#?${issue}\\b`).test(command)) return true;
  return (
    new RegExp(`issues/${issue}/comments\\b`).test(command) &&
    /(?:-X|--method)\s+POST\b|\s-[fF]\s+body=/.test(command)
  );
}

/** What Claude is told after the branch is made, or null when there is nothing to remind */
export function claimReminder(command: string): string | null {
  const unclaimed = createdWorkBranches(command).filter(
    ({ issue }) => !postsIssueComment(command, issue)
  );
  if (unclaimed.length === 0) return null;
  return unclaimed
    .map(
      ({ branch, issue }) =>
        `ブランチ ${branch} を作りました。Issue #${issue} に着手の連絡をまだ書いていなければ、実装の前に書いてください（CLAUDE.md「並行するセッションとの連携」）。書くこと：このセッションが担当すること・ブランチ名、#${issue} の最新のコメントまで読んだこと、#${issue} を参照する PR（open なものと、着手のあとにマージされたもの）を確かめたこと。項目が複数ある Issue は、着手する項目も書く。すでに書いたなら、この案内は気にしなくてよい。`
    )
    .join('\n');
}
